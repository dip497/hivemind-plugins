// Search, as VS Code's: the lines holding what is typed, in every folder of the workspace, grouped
// by file, each match marked; Match Case and Use Regular Expression beside the field. A line opens
// its file in the frame's editor at that line. The finding is the app's (fff), a page at a time.
import type { ViewFoundLine } from "@hivemind/view-sdk";
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Bench } from "./App";
import { Icon } from "./Icon";
import { useGrep, type RootHits } from "./finding";

/** A file's lines, as one result group. */
interface FileHits { key: string; frameId: string | null; path: string; lines: ViewFoundLine[] }

function byFile(h: RootHits): FileHits[] {
  const files = new Map<string, FileHits>();
  for (const page of h.pages) for (const l of page.lines) {
    const key = `${h.root.frameId ?? ""}\n${l.path}`;
    let f = files.get(key);
    if (!f) files.set(key, (f = { key, frameId: h.root.frameId, path: l.path, lines: [] }));
    f.lines.push(l);
  }
  return [...files.values()];
}

/** A line's text with its matches marked, the start trimmed so the first match is in sight. */
function Marked({ line }: { line: ViewFoundLine }) {
  const ranges = [...line.ranges].sort((a, b) => a[0] - b[0]);
  const start = Math.max(0, (ranges[0]?.[0] ?? 0) - 24);
  const parts: { text: string; hit: boolean }[] = [];
  let at = start;
  for (const [from, to] of ranges) {
    if (to <= at) continue;
    if (from > at) parts.push({ text: line.text.slice(at, from), hit: false });
    parts.push({ text: line.text.slice(Math.max(from, at), to), hit: true });
    at = to;
  }
  parts.push({ text: line.text.slice(at), hit: false });
  if (start > 0) parts[0] = { ...parts[0]!, text: `…${parts[0]!.text}` };
  else parts[0] = { ...parts[0]!, text: parts[0]!.text.trimStart() };
  return <>{parts.map((p, i) => (p.hit ? <mark key={i} className="find">{p.text}</mark> : p.text))}</>;
}

export function CodeSearch({ b }: { b: Bench }) {
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { field.current?.focus(); }, [b.searchFocus]);
  const [caseSensitive, setCase] = useState(false);
  const [regex, setRegex] = useState(false);
  const [shut, setShut] = useState<ReadonlySet<string>>(new Set());
  const opts = useMemo(() => ({ mode: regex ? "regex" as const : "plain" as const, caseSensitive }), [regex, caseSensitive]);
  const { hits, busy, more } = useGrep(b.hm, b.code.roots, b.query, opts);
  const groups = useMemo(() => hits.map((h) => ({ h, files: byFile(h) })), [hits]);
  // The lines in the order shown, for the keyboard: arrows move, Enter or Space opens.
  const flat = useMemo(() => groups.flatMap(({ files: fs }) => fs.flatMap((f) => (shut.has(f.key) ? [] : f.lines.map((l) => ({ key: `${f.key}\n${l.line}:${l.col}`, f, l }))))), [groups, shut]);
  const [sel, setSel] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { list.current?.querySelector(".row.line.selected")?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const openLine = (x: (typeof flat)[number]) => b.code.openFile(x.f.frameId, x.l.path, { line: x.l.line, col: x.l.col });
  const listKeys = (e: KeyboardEvent) => {
    const at = flat.findIndex((x) => x.key === sel);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = flat[Math.max(0, Math.min(flat.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) setSel(next.key);
    } else if ((e.key === "Enter" || e.key === " ") && at >= 0) { e.preventDefault(); openLine(flat[at]!); }
  };
  const lines = groups.reduce((n, g) => n + g.files.reduce((k, f) => k + f.lines.length, 0), 0);
  const files = groups.reduce((n, g) => n + g.files.length, 0);
  const many = groups.length > 1;
  const note = hits.map((h) => h.pages[0]?.note ?? h.error).find(Boolean);
  const toggle = (on: boolean, set: (v: boolean) => void, label: string, text: string) => (
    <button className={`toggle${on ? " on" : ""}`} aria-pressed={on} aria-label={label} title={label} onClick={() => set(!on)}>{text}</button>
  );
  return (
    <div className="panes">
      <div className="search-box">
        <div className="search-field">
          <input ref={field} className="field" placeholder="Search" aria-label="Search" value={b.query} spellCheck={false} onChange={(e) => b.setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "ArrowDown" && flat[0]) { e.preventDefault(); setSel(flat[0].key); list.current?.focus(); } }} />
          {toggle(caseSensitive, setCase, "Match Case", "Aa")}
          {toggle(regex, setRegex, "Use Regular Expression", ".*")}
        </div>
      </div>
      {b.query.trim() && (
        <div className="summary" data-code-summary>
          {busy ? "Searching…" : lines ? `${lines}${hits.some((h) => h.next !== null) ? "+" : ""} result${lines === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}` : "No results found."}
          {note && <div className="note">{note}</div>}
        </div>
      )}
      <div ref={list} className="list" role="tree" aria-label="Search results" tabIndex={0} style={{ flex: 1, overflowY: "auto" }} onKeyDown={listKeys}>
        {groups.map(({ h, files: fs }, i) => (
          <Fragment key={h.root.frameId ?? ""}>
            {many && fs.length > 0 && (
              <div className="row" style={{ paddingLeft: 8 }} role="treeitem" aria-level={1}>
                <span className="twistie"><Icon name="chevronDown" /></span>
                <span className="ico"><Icon name="folder" /></span>
                <span className="name">{h.root.title}</span>
              </div>
            )}
            {fs.map((f) => {
              const closed = shut.has(f.key);
              const slash = f.path.lastIndexOf("/");
              return (
                <Fragment key={f.key}>
                  <div className="row" style={{ paddingLeft: many ? 16 : 8 }} role="treeitem" aria-level={many ? 2 : 1} aria-expanded={!closed} data-code-file={f.path}
                    onClick={() => setShut((s) => { const n = new Set(s); if (closed) n.delete(f.key); else n.add(f.key); return n; })}>
                    <span className="twistie"><Icon name={closed ? "chevronRight" : "chevronDown"} /></span>
                    <span className="ico"><Icon name="fileCode" /></span>
                    <span className="name">{f.path.slice(slash + 1)}</span>
                    {slash > 0 && <span className="desc">{f.path.slice(0, slash)}</span>}
                    <span className="end"><span className="badge" style={{ background: "var(--selected-quiet)", color: "var(--fg)" }}>{f.lines.length}</span></span>
                  </div>
                  {!closed && f.lines.map((l) => (
                    <div key={`${l.line}:${l.col}`} className={`row line${sel === `${f.key}\n${l.line}:${l.col}` ? " selected" : ""}`} style={{ paddingLeft: many ? 40 : 32 }} role="treeitem" aria-level={many ? 3 : 2}
                      aria-selected={sel === `${f.key}\n${l.line}:${l.col}`} data-code-line={`${l.path}:${l.line}`} title={`${l.path}:${l.line}`}
                      onClick={() => { setSel(`${f.key}\n${l.line}:${l.col}`); b.code.openFile(f.frameId, l.path, { line: l.line, col: l.col }); }}>
                      <span className="name"><Marked line={l} /></span>
                    </div>
                  ))}
                </Fragment>
              );
            })}
            {h.next !== null && (
              <div className="row more" style={{ paddingLeft: many ? 16 : 8 }} role="treeitem" onClick={() => more(i)}>
                <span className="twistie" />
                <span className="name">Show more results{many ? ` in ${h.root.title}` : ""}</span>
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
