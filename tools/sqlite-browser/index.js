// The repository's SQLite files (`find`, regular files only), opened with
// `sqlite3 -readonly -safe -nofollow -json` through host.run: tables with their row counts, a table's
// first rows, and any query you write. -readonly refuses writes, -safe refuses sqlite3's commands
// that run programs or attach files, and -nofollow refuses a path through a symbolic link, so a file
// swapped for a link after it was listed is not opened.
import React, { useCallback, useEffect, useMemo, useState } from "hm-plugin://host/react.js";
import { Button, Loading, useTileState } from "hm-plugin://host/sdk.js";
import { TABLES_SQL, cleanError, columnsOf, countSql, databaseArgument, databaseFiles, findStepsArgs, parseRows, pathSteps, refuseQuery, rowsSql, stepsAreReal } from "./lib.js";

const h = React.createElement;
// Inks made from the colours the app gives a tool, so they read in every preset, light or dark, on
// the tile (--color-bg2) and on a header or chosen row (--color-bg3): words at 4.5:1, measured.
const PENCIL = "color-mix(in oklab, var(--color-fg3) 50%, var(--color-fg))";
const ERR_TEXT = "color-mix(in oklab, var(--color-err) 55%, var(--color-fg))";
const muted = { color: PENCIL, fontSize: 11 };
const mono = { fontFamily: "var(--font-mono)" };
const LIMIT = 200;
const FIND_DATABASES = [".", "(", "-name", "node_modules", "-o", "-name", ".git", "-o", "-name", "target", ")", "-prune", "-o",
  "-type", "f", "(", "-name", "*.db", "-o", "-name", "*.sqlite", "-o", "-name", "*.sqlite3", ")", "-print"];
// `file` is "./<path>" of one of the repository's database files (databaseArgument).
async function sqlite(host, file, sql) {
  const refused = refuseQuery(sql);
  if (refused) throw new Error(refused);
  // Right before opening it: no folder on the way and not the file itself is a link, so the file is
  // the one listed, inside the repository. -nofollow refuses a link that appears after this check.
  const steps = pathSteps(file);
  const real = await host.run("find", findStepsArgs(steps));
  if (!stepsAreReal(steps, real.stdout)) throw new Error(`${file.slice(2)} is no longer a database file in this repository`);
  const r = await host.run("sqlite3", ["-readonly", "-safe", "-nofollow", "-json", file, sql.trim()]);
  // Without -safe a query's own functions (writefile, load_extension) can still write files.
  if (r.code !== 0 && /-(safe|nofollow)/.test(r.stderr) && /unknown option/i.test(r.stderr)) throw new Error("This sqlite3 has no -safe (it came in 3.37); install a newer sqlite3 to browse here.");
  if (r.code !== 0) throw new Error(cleanError(r.stderr));
  return parseRows(r.stdout);
}

async function tablesOf(host, file) {
  const list = await sqlite(host, file, TABLES_SQL);
  if (!list.length) return [];
  const counts = await sqlite(host, file, countSql(list.map((t) => t.name))).catch(() => []);
  return list.map((t) => ({ ...t, count: counts.find((c) => c.name === t.name)?.count ?? null }));
}

function Cell({ value }) {
  if (value === null) return h("span", { style: { color: PENCIL, fontStyle: "italic" } }, "null");
  if (typeof value === "number") return h("span", { style: { color: PENCIL } }, String(value));
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > 120 ? h("span", { title: s }, `${s.slice(0, 120)}…`) : s;
}

function Grid({ rows }) {
  const cols = useMemo(() => columnsOf(rows), [rows]);
  if (!rows.length) return h("p", { style: { ...muted, padding: 16 } }, "No rows.");
  const cell = { padding: "5px 10px", borderBottom: "1px solid var(--color-line)", borderRight: "1px solid var(--color-line)", whiteSpace: "nowrap", textAlign: "left" };
  return h("table", { "data-grid": true, style: { ...mono, fontSize: 11.5, borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" } },
    h("thead", null, h("tr", null,
      h("th", { style: { ...cell, ...muted, position: "sticky", top: 0, background: "var(--color-bg3)", textAlign: "right" } }, "#"),
      cols.map((c) => h("th", { key: c, style: { ...cell, position: "sticky", top: 0, background: "var(--color-bg3)", fontWeight: 600 } }, c)))),
    h("tbody", null, rows.map((r, i) => h("tr", { key: i },
      h("td", { style: { ...cell, ...muted, textAlign: "right" } }, i + 1),
      cols.map((c) => h("td", { key: c, style: { ...cell, textAlign: typeof r[c] === "number" ? "right" : "left" } }, h(Cell, { value: r[c] ?? null })))))));
}

function Browser({ hm, host }) {
  const [files, setFiles] = useState(null);
  const [file, setFile] = useTileState(hm, "file", null);
  const [table, setTable] = useTileState(hm, "table", null);
  const [sql, setSql] = useTileState(hm, "sql", "");
  const [tables, setTables] = useState(null);
  const [rows, setRows] = useState(null);
  const [shown, setShown] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // find lists regular files and never goes through a symbolic link, so every file here is inside the repository.
    host.run("find", FIND_DATABASES, { maxAgeMs: 10_000 }).then((found) => {
      const list = databaseFiles(found.stdout);
      setFiles(list);
      if (!file || !list.includes(file)) setFile(list[0] ?? null);
    }, (e) => setError(e.message));
  }, [host]);

  useEffect(() => {
    if (!file || !files) return;
    setTables(null); setError(null);
    Promise.resolve().then(() => tablesOf(host, databaseArgument(file, files))).then((t) => {
      setTables(t);
      if (!table || !t.some((x) => x.name === table)) setTable(t[0]?.name ?? null);
    }, (e) => { setTables([]); setError(e.message); });
  }, [host, file, files]);

  const browse = useCallback((name) => {
    setTable(name); setRows(null); setError(null);
    const began = Date.now();
    Promise.resolve().then(() => sqlite(host, databaseArgument(file, files), rowsSql(name, LIMIT))).then((r) => { setRows(r); setShown({ what: name, ms: Date.now() - began }); }, (e) => { setRows([]); setError(e.message); });
  }, [host, file, files, setTable]);
  useEffect(() => { if (file && table && tables) browse(table); }, [file, tables]);

  const runQuery = () => {
    setRows(null); setError(null);
    const began = Date.now();
    Promise.resolve().then(() => sqlite(host, databaseArgument(file, files), sql)).then((r) => { setRows(r); setShown({ what: "query", ms: Date.now() - began }); }, (e) => { setRows([]); setError(e.message); });
  };

  // An agent names a file only from the list the tile shows.
  const agentsFile = useCallback((args) => {
    if (files === null) throw new Error("still looking for the database files; ask again in a moment");
    const f = args?.file ?? file;
    if (!f) throw new Error("no database file here");
    return { f, arg: databaseArgument(f, files) };
  }, [files, file]);
  useEffect(() => hm.onCommand("tables", async (args) => {
    const { f, arg } = agentsFile(args);
    return { file: f, tables: await tablesOf(host, arg) };
  }), [hm, host, agentsFile]);
  useEffect(() => hm.onCommand("query", async (args) => {
    const { f, arg } = agentsFile(args);
    if (typeof args?.sql !== "string") throw new Error('pass { "sql": "SELECT …" }');
    const r = await sqlite(host, arg, args.sql);
    return { file: f, rows: r.length, result: r.slice(0, 1000) };
  }), [hm, host, agentsFile]);

  if (error && files === null) return h("p", { role: "alert", style: { color: ERR_TEXT, padding: 16 } }, error);
  if (files === null) return h(Loading, { label: "Looking for databases" });
  if (!files.length) {
    return h("div", { style: { padding: 24, textAlign: "center", color: "var(--color-fg)" } },
      h("div", { style: { fontSize: 13 } }, "No SQLite file in this repository."),
      h("div", { style: muted }, "It looks for .db, .sqlite and .sqlite3 files git tracks, and any within three folders of the top."));
  }
  const current = tables?.find((t) => t.name === table);
  return h("div", { style: { display: "flex", flexDirection: "column", height: "100%", color: "var(--color-fg)" } },
    h("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--color-line)" } },
      h("select", {
        value: file ?? "", onChange: (e) => { setFile(e.target.value); setTable(null); }, "aria-label": "Database file",
        style: { ...mono, fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--color-line)", background: "var(--color-bg)", color: "var(--color-fg)" },
      }, files.map((f) => h("option", { key: f, value: f }, f))),
      h("span", { style: muted }, tables ? `${tables.length} table${tables.length === 1 ? "" : "s"} · read-only` : "…"),
      h("span", { style: { flex: 1 } }),
      shown && rows && h("span", { style: muted }, `${rows.length}${shown.what !== "query" && rows.length === LIMIT ? `+ (first ${LIMIT})` : ""} rows · ${shown.ms} ms`)),
    h("div", { style: { flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "220px 1fr" } },
      h("div", { style: { overflow: "auto", borderRight: "1px solid var(--color-line)", padding: "6px 0" } },
        tables === null ? h(Loading, { label: "Reading tables" })
          : tables.map((t) => h("button", {
            key: t.name, onClick: () => browse(t.name), "data-table": t.name, "aria-current": t.name === table && shown?.what !== "query" ? true : undefined,
            style: {
              display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 12px", border: 0, cursor: "pointer", textAlign: "left",
              color: "var(--color-fg)", background: t.name === table && shown?.what !== "query" ? "var(--color-bg3)" : "transparent",
            },
          },
          h("span", { style: { ...mono, fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t.name),
          t.type === "view" && h("span", { style: { ...muted, fontSize: 10 } }, "view"),
          h("span", { style: { ...muted, ...mono } }, t.count === null ? "" : t.count.toLocaleString())))),
      h("div", { style: { display: "flex", flexDirection: "column", minHeight: 0 } },
        h("div", { style: { display: "flex", gap: 8, padding: 8, borderBottom: "1px solid var(--color-line)" } },
          h("textarea", {
            value: sql, onChange: (e) => setSql(e.target.value), spellCheck: false, rows: 3, "aria-label": "SQL",
            placeholder: current ? `SELECT * FROM ${current.name} WHERE …   (Ctrl+Enter runs it)` : "SELECT …",
            onKeyDown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runQuery(); } },
            style: { ...mono, flex: 1, fontSize: 12, padding: "6px 8px", borderRadius: 6, resize: "vertical", border: "1px solid var(--color-line)", background: "var(--color-bg)", color: "var(--color-fg)" },
          }),
          h(Button, { size: "xs", variant: "default", disabled: !sql.trim(), onClick: runQuery }, "Run")),
        error && h("div", { role: "alert", style: { ...mono, padding: "6px 12px", fontSize: 12, color: ERR_TEXT, borderBottom: "1px solid var(--color-line)" } }, error),
        h("div", { style: { flex: 1, minHeight: 0, overflow: "auto" } },
          tables && !tables.length && rows === null ? h("p", { style: { ...muted, padding: 16 } }, error ? "" : "This database has no tables.")
            : rows === null ? h(Loading, { label: "Reading rows" }) : h(Grid, { rows })))));
}

export default { tiles: { "sqlite-browser": Browser } };
