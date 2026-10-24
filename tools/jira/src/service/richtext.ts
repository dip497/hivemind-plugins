// Jira Cloud's rich text, ADF, both ways (design jira-sync §6.5): ADF → markdown for descriptions
// and comments read over REST (`mdast-util-from-adf`, then `mdast-util-to-markdown` with GFM), and
// markdown → ADF for comments pushed over REST (`marklassian`). Both live here so one module owns
// how hive's markdown and Jira's ADF meet.
//
// The ADF converter knows the common nodes only and throws on the rest (a status lozenge, an
// extension, inline media), so the document is first brought to what it knows: panels become
// quotes (as they do over MCP, html.ts), lozenges inline code, mentions their name, media a
// plain "(attachment)", and unknown nodes their text. The text is data: nothing in it is run.
import { fromADF } from "mdast-util-from-adf";
import { gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import { markdownToAdf as marklassian } from "marklassian";

interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: AdfNode[];
}

export interface AdfDoc { type: "doc"; version: 1; content: AdfNode[] }

/** Nodes the converter takes as they are. */
const KNOWN = new Set([
  "blockquote", "bulletList", "codeBlock", "date", "decisionItem", "decisionList", "embedCard", "emoji", "expand", "hardBreak", "heading",
  "inlineCard", "layoutColumn", "layoutSection", "listItem", "nestedExpand", "orderedList", "paragraph", "rule",
  "table", "tableCell", "tableHeader", "tableRow", "taskItem", "taskList", "text", "blockCard",
]);
/** Nodes that sit where blocks do, so their stand-in is a paragraph. */
const BLOCK = new Set(["bodiedExtension", "extension", "multiBodiedExtension", "syncBlock", "bodiedSyncBlock"]);

const text = (t: string): AdfNode => ({ type: "text", text: t });
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** `n` as nodes the converter knows. */
function normalise(n: AdfNode): AdfNode[] {
  const kids = () => (n.content ?? []).flatMap(normalise);
  switch (n.type) {
    case "panel": return [{ type: "blockquote", content: kids() }];
    case "status": return [{ type: "text", text: str(n.attrs?.text), marks: [{ type: "code" }] }];
    case "mention": {
      const name = str(n.attrs?.text) || str(n.attrs?.id);
      return [text(name.startsWith("@") ? name : `@${name}`)];
    }
    case "media": case "mediaInline": return [text("(attachment)")];
    // Media wraps hold media nodes alone: as a paragraph of their stand-ins.
    case "mediaSingle": case "mediaGroup": return [{ type: "paragraph", content: kids() }];
    case "placeholder": return [];
    default: {
      if (KNOWN.has(n.type)) return [{ ...n, ...(n.content ? { content: kids() } : {}) }];
      // An extension, a sync block or a node newer than the converter: its text, if it has any.
      if (n.content?.length) return kids();
      const t = str(n.attrs?.text) || str(n.text);
      if (!t) return [];
      return BLOCK.has(n.type) ? [{ type: "paragraph", content: [text(t)] }] : [text(t)];
    }
  }
}

/** Markdown for an ADF document (a description or a comment body); "" for none. */
export function adfToMarkdown(adf: unknown): string {
  if (!adf || typeof adf !== "object") return typeof adf === "string" ? adf.trim() : "";
  const doc = adf as Partial<AdfDoc>;
  if (!Array.isArray(doc.content)) return "";
  const tree = fromADF({ type: "doc", version: 1, content: doc.content.flatMap(normalise) } as never);
  return toMarkdown(tree, { bullet: "-", fences: true, rule: "-", extensions: [gfmToMarkdown()] }).trim();
}

/** An ADF document for markdown written in hive (a comment pushed to Jira). Raw `<adf>` blocks,
 *  which marklassian would pass through as they are, stay text: what is pushed is what was written. */
export function markdownToAdf(md: string): AdfDoc {
  return marklassian(md.replace(/<(\/?adf)\b/gi, "\\<$1")) as AdfDoc;
}
