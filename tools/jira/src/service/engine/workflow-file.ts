// Writing `.hivemind/workflow.yaml` without taking the person's part of it (design §4.2): their
// comments, the order they put statuses in and their formatting survive a re-discovery. The file is
// edited, not re-serialized: each value the new workflow changes is set in the YAML document where
// it is, a status is matched by its id wherever the person moved it, and anything unchanged is left
// exactly as written.
import { Document, isMap, isScalar, isSeq, parseDocument, type Node, type YAMLMap, type YAMLSeq } from "yaml";
import type { Workflow } from "./workflow.js";

const HEADER = "# Statuses for this workspace. The Jira service rewrites the jira: ones from Jira;\n# hive's own statuses, `local` and colours are yours (design jira-sync §4.2).\n";

type Json = unknown;
const plain = (v: Json): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);
const byIds = (v: Json): v is { id: string }[] => Array.isArray(v) && v.length > 0 && v.every((x) => plain(x) && typeof x.id === "string");

/** Make `node` (held by `parent` under `key`) say `value`, touching only what differs. */
function sync(doc: Document, parent: YAMLMap | YAMLSeq, key: string | number, value: Json): void {
  const node = parent.get(key, true) as Node | undefined;
  if (isMap(node) && plain(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) node.delete(k);
      else sync(doc, node, k, v);
    }
    for (const item of [...node.items]) {
      const k = isScalar(item.key) ? String(item.key.value) : String(item.key);
      if (!(k in value)) node.delete(k);
    }
    return;
  }
  if (isSeq(node) && byIds(value) && node.items.every((n) => isMap(n) && typeof n.get("id") === "string")) {
    syncById(doc, node, value);
    return;
  }
  if (node !== undefined && same(node.toJSON(), value)) return;
  parent.set(key, doc.createNode(value));
}

/** A list of `{id, …}`: items matched by id stay where they are; gone ones go; a new one goes after
 *  the item it follows in `value`. */
function syncById(doc: Document, seq: YAMLSeq, value: { id: string }[]): void {
  const want = new Set(value.map((v) => v.id));
  for (let i = seq.items.length - 1; i >= 0; i--) if (!want.has(String((seq.items[i] as YAMLMap).get("id")))) seq.delete(i);
  const at = (id: string) => seq.items.findIndex((n) => (n as YAMLMap).get("id") === id);
  value.forEach((v, i) => {
    const here = at(v.id);
    if (here >= 0) return sync(doc, seq, here, v);
    const before = value.slice(0, i).reverse().map((p) => at(p.id)).find((x) => x >= 0);
    seq.items.splice(before === undefined ? 0 : before + 1, 0, doc.createNode(v));
  });
}

/** The text of workflow.yaml saying `next`: `text` edited in place, or a new file. */
export function workflowText(text: string | undefined, next: Workflow): string {
  if (!text?.trim()) return HEADER + new Document(next).toString({ lineWidth: 0 });
  const doc = parseDocument(text);
  if (!isMap(doc.contents)) return HEADER + new Document(next).toString({ lineWidth: 0 });
  const root = doc.contents;
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) root.delete(k);
    else sync(doc, root, k, v);
  }
  // The board is Jira's: gone from Jira, gone here. Keys hive doesn't know stay.
  if (next.board === undefined) root.delete("board");
  return doc.toString({ lineWidth: 0 });
}
