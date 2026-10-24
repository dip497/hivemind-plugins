// The push queue (design §8.2): what hive changed and still has to tell Jira, in
// `sync/<slug>/queue.jsonl`, so a push survives the service stopping. One line per change to it —
// an item put (merged by its key: the last target wins) or taken away — replayed on start, and
// written over in full once the lines outnumber the items well.
import { promises as fs } from "node:fs";
import path from "node:path";

export type PushKind = "status" | "comment" | "link" | "property";

export interface PushItem {
  /** What it merges by: `<issue id>/<kind>[/<what>]`. */
  key: string;
  kind: PushKind;
  /** hive's id of the issue (its Jira key) and Jira's id of it. */
  issue: string;
  extId: string;
  /** status: the hive status to show in Jira. */
  status?: string;
  /** comment: the activity row to send, as hive has it. */
  row?: { at: string; who: string; message: string };
  /** link: the PR to link. */
  pr?: { repo: string; number: number; url: string; state: string };
  /** property: what the `hivemind` property says. */
  property?: { branch: string | null; pr: { repo: string; number: number } | null };
  /** When it may run (ms since the epoch): 5 s after the last change, later after a failure. */
  due: number;
  attempts: number;
  /** Stopped for the person (a screen to fill, a path to confirm): not retried until it changes. */
  waiting?: { message: string; since: string };
}

type Line = { put: PushItem } | { done: string };

export class PushQueue {
  private items = new Map<string, PushItem>();
  private lines = 0;
  private loaded?: Promise<void>;
  private writing: Promise<unknown> = Promise.resolve();

  constructor(readonly file: string) {}

  /** Read the file once: every item still to push. A torn last line (a kill mid-write) is skipped. */
  load(): Promise<void> {
    this.loaded ??= (async () => {
      let text = "";
      try { text = await fs.readFile(this.file, "utf8"); } catch { /* none yet */ }
      for (const l of text.split("\n")) {
        if (!l.trim()) continue;
        let line: Line;
        try { line = JSON.parse(l) as Line; } catch { continue; }
        this.lines++;
        if ("put" in line && line.put?.key) this.items.set(line.put.key, line.put);
        else if ("done" in line) this.items.delete(line.done);
      }
    })();
    return this.loaded;
  }

  all(): PushItem[] {
    return [...this.items.values()];
  }

  get(key: string): PushItem | undefined {
    return this.items.get(key);
  }

  /** Put an item (replacing the one with its key), kept on disk before this resolves. */
  async put(item: PushItem): Promise<void> {
    await this.load();
    this.items.set(item.key, item);
    await this.append({ put: item });
  }

  async done(key: string): Promise<void> {
    await this.load();
    if (!this.items.delete(key)) return;
    await this.append({ done: key });
  }

  /** The earliest time an item not waiting for the person is due, if any. */
  nextDue(): number | undefined {
    let at: number | undefined;
    for (const i of this.items.values()) if (!i.waiting && (at === undefined || i.due < at)) at = i.due;
    return at;
  }

  private append(line: Line): Promise<void> {
    const run = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      if (this.lines > 2 * this.items.size + 50) {
        // Written over: a temp file renamed into place, so a kill leaves the old or the new.
        const tmp = `${this.file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, [...this.items.values()].map((i) => JSON.stringify({ put: i }) + "\n").join(""), "utf8");
        await fs.rename(tmp, this.file);
        this.lines = this.items.size;
        return;
      }
      await fs.appendFile(this.file, JSON.stringify(line) + "\n", "utf8");
      this.lines++;
    });
    this.writing = run.catch(() => {});
    return run;
  }
}
