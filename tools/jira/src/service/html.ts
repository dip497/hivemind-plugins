// Rich text from the Rovo MCP server is markdown, except a body holding a panel, a mention, a status
// lozenge or media, which comes back as HTML (`appliedContentFormat: "html"`, design §9.2 "What P2
// found" 4). This turns that HTML into markdown once, at the edge, so the rest of the service and
// hive only ever see markdown. Scripts and styles are dropped; the text is data, never run.
import { NodeHtmlMarkdown } from "node-html-markdown";

const nhm = new NodeHtmlMarkdown(
  { bulletMarker: "-", codeBlockStyle: "fenced", ignore: ["script", "style", "iframe", "object", "embed"] },
  {
    // A panel is a quote: its text stays, set apart as it was.
    div: ({ node }) => (node.getAttribute("data-panel-type")
      ? { surroundingNewlines: 2, postprocess: ({ content }) => content.trim().split("\n").map((l) => (l.trim() ? `> ${l}` : ">")).join("\n") }
      : {}),
  },
);

const CHECKED = "\u2063hmchecked\u2063";
const UNCHECKED = "\u2063hmunchecked\u2063";

/** Markdown for a body the server sent in `format`. */
export function toMarkdown(body: string | null | undefined, format: string | undefined): string {
  if (!body) return "";
  if (format !== "html") return body.trim();
  // A task list's checkbox (Jira's action items) becomes `[x] ` / `[ ] `, so acceptance criteria read
  // as such. The converter drops <input> itself, so it is marked in the text first.
  const marked = body.replace(/<input\b([^>]*)>/gi, (_m, attrs: string) => (/type\s*=\s*["']?checkbox/i.test(attrs) ? (/(^|\s)checked(\s|=|$)/i.test(attrs) ? CHECKED : UNCHECKED) : ""));
  return nhm.translate(marked).replaceAll(CHECKED, "[x] ").replaceAll(UNCHECKED, "[ ] ").trim();
}
