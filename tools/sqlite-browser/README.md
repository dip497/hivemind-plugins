# SQLite browser

The repository's SQLite files in a tile, read-only. Choose a file: its tables and views are listed
with their row counts; choose one to see its first 200 rows in a grid (numbers right-aligned, nulls
marked). Write any query in the box and run it with the button or Ctrl+Enter.

It finds the `.db`, `.sqlite` and `.sqlite3` files in the repository (outside `node_modules`,
`.git` and `target`), git-ignored ones too, as regular files only: `find` never follows a symbolic
link. It opens them with `sqlite3 -readonly -safe -nofollow -json`: `-readonly` refuses every
write, `-safe` refuses sqlite3's commands that run programs or attach other files, and `-nofollow`
refuses a path through a symbolic link. Right before each query it checks again that no folder on
the way to the file, nor the file, is a link, so a file or folder replaced by a link after it was
listed is refused. A query starting with `.` or `-` is not sent at all. An agent names a database only from
the files the tile lists, never a path outside the repository.

```bash
hive plugins install @dip497/sqlite-browser
hive plugins enable @dip497/sqlite-browser
hive ctl open-tool @dip497/sqlite-browser/browser
```

An agent asks it, while its tile is open:

```bash
hive ctl plugin call @dip497/sqlite-browser tables
hive ctl plugin call @dip497/sqlite-browser query '{"sql":"SELECT status, COUNT(*) FROM orders GROUP BY status"}'
hive ctl plugin call @dip497/sqlite-browser query '{"sql":"SELECT * FROM users LIMIT 5","file":"data/app.db"}'
```

It needs `sqlite3` 3.37 or newer (for `-safe`). It asks for no permissions.

## How it was made

Built by a coding agent (Claude) from the tool-plugin contract (the brief
`hive plugins new tool` writes, and the tool plugin guide). It uses `host.run` of `git ls-files`, `find`
and `sqlite3`, and `useTileState` to keep the chosen file, table and query. Building the queries
and reading sqlite3's answers are in `lib.js`, tested against a real database.
