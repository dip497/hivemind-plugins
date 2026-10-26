// ADF ↔ markdown (design §6.5): Jira Cloud's rich text as hive keeps it, and hive's markdown as Jira
// takes it for comments. The fixture's PAY-318 description holds a panel, a mention, a status
// lozenge, an emoji, media, code and a task list — the shapes P-R required both converters to pass.
import { expect, test } from "bun:test";
import { loadSite } from "./harness";
import { adfToMarkdown, markdownToAdf } from "../../tools/jira/src/service/richtext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const doc = (...content: Any[]) => ({ type: "doc", version: 1, content });
const p = (...content: Any[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: Any[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });

test("PAY-318's description reads as markdown: links, the panel as a quote, the task list as checkboxes, code, the mention by name, the lozenge as code, media as a word", () => {
  const adf = loadSite("cloud-scrum-company").issues.find((i: Any) => i.key === "PAY-318").description.adf;
  expect(adfToMarkdown(adf)).toBe([
    "Failed deliveries are dropped. Retry with backoff; see [the runbook](https://wiki.example.com/runbook).",
    "> Do not retry 4xx except 429.",
    "### Acceptance Criteria",
    "- [x] Retries 5 times with jittered backoff\n- [ ] Dead-letters after the last retry",
    "```ts\nawait retry(send, { attempts: 5 })\n```",
    "@Jane Doe owns the queue. `BLOCKED ON INFRA` ⚠️",
    "(attachment)",
  ].join("\n\n"));
});

test("nodes the converter doesn't know never stop a sync: an extension keeps its text, a sync block its content, a bare one is dropped", () => {
  const md = adfToMarkdown(doc(
    { type: "extension", attrs: { extensionKey: "jira-chart", text: "Velocity chart" } },
    { type: "bodiedSyncBlock", content: [p(t("Shared note"))] },
    p(t("before "), { type: "inlineExtension", attrs: { extensionKey: "x" } }, { type: "mediaInline", attrs: { id: "m1" } }, t(" after")),
    { type: "somethingNewer" },
    p({ type: "mention", attrs: { id: "abc", text: "Sam" } }, { type: "placeholder", attrs: { text: "Type here" } }),
  ));
  expect(md).toBe("Velocity chart\n\nShared note\n\nbefore (attachment) after\n\n@Sam");
});

test("empty and missing bodies are empty text; a string body (a v2 shape) is kept as it is", () => {
  expect([adfToMarkdown(null), adfToMarkdown(undefined), adfToMarkdown(doc()), adfToMarkdown("  plain  "), adfToMarkdown({ type: "doc" })]).toEqual(["", "", "", "plain", ""]);
});

test("markdown goes up as ADF: marks, links, lists and task lists, code — and reads back the same", () => {
  const md = "Opened **#42**, *see* [the PR](https://github.com/o/r/pull/42) and `npm test`\n\n- one\n- two\n\nThen:\n\n- [x] done\n- [ ] todo\n\n```ts\nconst x = 1;\n```";
  const adf = markdownToAdf(md);
  expect(adf.type).toBe("doc");
  expect(adf.content.map((n) => n.type)).toEqual(["paragraph", "bulletList", "paragraph", "taskList", "codeBlock"]);
  expect(adf.content[3]!.content!.map((n) => n.attrs?.state)).toEqual(["DONE", "TODO"]);
  expect(adfToMarkdown(adf)).toBe(md);
});

test("a raw <adf> block in hive's markdown is pushed as the text it is, not as ADF nodes (no hidden mentions or macros)", () => {
  const adf = markdownToAdf('Hi\n\n<adf>\n{"type":"mention","attrs":{"id":"5b10a2844c20165700ede21g"}}\n</adf>\n');
  const types = (n: Any): string[] => [n.type, ...(n.content ?? []).flatMap(types)];
  expect(types(adf)).not.toContain("mention");
  expect(adfToMarkdown(adf)).toContain('<adf> {"type":"mention"');
});
