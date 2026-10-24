// Rich text from the Rovo MCP server is markdown, except a body holding a panel, a mention, a status
// lozenge or media, which comes back as HTML (`appliedContentFormat: "html"`, design §9.2 "What P2
// found" 4). This turns that HTML into markdown once, at the edge, so the rest of the service and
// hive only ever see markdown. Scripts and styles are dropped; the text is data, never run.
import { NodeHtmlMarkdown } from "node-html-markdown";

const nhm = new NodeHtmlMarkdown(
  { bulletMarker: "-", codeBlockStyle: "fenced", ignore: ["script", "style", "iframe", "object", "embed"] },
  {
    // A task list's checkbox (Jira's action items): `[x] ` / `[ ] `, so acceptance criteria read as such.
    input: ({ node }) => (node.getAttribute("type") === "checkbox" ? { content: node.hasAttribute("checked") ? "[x] " : "[ ] " } : { ignore: true }),
    // A panel is a quote: its text stays, set apart as it was.
    div: ({ node }) => (node.getAttribute("data-panel-type") ? { prefix: "> ", surroundingNewlines: 2 } : {}),
  },
);

/** Markdown for a body the server sent in `format`. */
export function toMarkdown(body: string | null | undefined, format: string | undefined): string {
  if (!body) return "";
  return format === "html" ? nhm.translate(body).trim() : body.trim();
}
