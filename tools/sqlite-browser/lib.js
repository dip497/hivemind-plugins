// Building the read-only queries and reading sqlite3's JSON. No imports: the tests load it as it is.

/** Database files among `git ls-files` and `find` output, each once, without a leading "./". */
export function databaseFiles(...outputs) {
  const seen = new Set();
  for (const out of outputs) {
    for (const raw of out.split("\n")) {
      const f = raw.trim().replace(/^\.\//, "");
      if (f && /\.(db|sqlite|sqlite3)$/i.test(f) && !/(^|\/)(node_modules|\.git)\//.test(f)) seen.add(f);
    }
  }
  return [...seen].sort();
}

/**
 * The database file an agent named, as the argument sqlite3 is given: only one of `files` (the
 * repository's database files), never an absolute path, a `..` or a leading "-", and always as
 * "./<path>", so sqlite3 can never read it as one of its options. Throws why otherwise.
 */
export function databaseArgument(asked, files) {
  const f = String(asked ?? "").replace(/^\.\//, "");
  if (!f) throw new Error("name a database file");
  if (f.startsWith("/") || /^[A-Za-z]:/.test(f) || f.split(/[\\/]/).includes("..") || f.startsWith("-")) {
    throw new Error(`${asked} is not one of this repository's database files`);
  }
  if (!files.includes(f)) throw new Error(`${asked} is not one of this repository's database files: ${files.join(", ") || "it has none"}`);
  return `./${f}`;
}

/** A name quoted for SQL, so any table name is read as a name. */
export const quoteName = (name) => `"${String(name).replace(/"/g, '""')}"`;

export const TABLES_SQL = "SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name";

/** One query counting the rows of every table. */
export function countSql(tables) {
  return tables.map((t) => `SELECT '${String(t).replace(/'/g, "''")}' AS name, COUNT(*) AS count FROM ${quoteName(t)}`).join(" UNION ALL ");
}

export const rowsSql = (table, limit = 200) => `SELECT * FROM ${quoteName(table)} LIMIT ${limit}`;

/**
 * Why a query is not run, or null. sqlite3 reads an argument starting with "." as one of its own
 * commands, some of which run programs, so those never reach it.
 */
export function refuseQuery(sql) {
  const s = String(sql ?? "").trim();
  if (!s) return "Write a query first.";
  if (s.startsWith(".")) return "Only SQL runs here, not sqlite3's own dot commands.";
  // sqlite3 reads an argument starting with "-" as one of its options, wherever it is.
  if (s.startsWith("-")) return "Start the query with SQL, not a comment or an option.";
  return null;
}

/** sqlite3 -json prints nothing at all for no rows. */
export function parseRows(stdout) {
  const s = stdout.trim();
  return s ? JSON.parse(s) : [];
}

/** The columns of a set of rows, in the order they first appear. */
export function columnsOf(rows) {
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return cols;
}

/** sqlite3's error, without the "Error: in prepare," and "argument" noise it wraps it in. */
export function cleanError(stderr) {
  return stderr.trim().split("\n")[0]
    .replace(/^(Parse error|Runtime error|Error)( in \d+\w* command line argument| near line \d+)?:\s*/i, "")
    .replace(/^in prepare,\s*/i, "") || "sqlite3 failed";
}
