// What each tool's programs print in tools-theme.test.ts, so each tool reaches the states it draws:
// lists with every kind of row, a choice, a failure, its error. It runs in the page beside the tool.
// `gate(name)` holds a run until the test lets it go (`window.release(name)`), for what a tool shows
// while something runs.
const ok = (stdout) => Promise.resolve({ code: 0, stdout, stderr: "" });
const NOT_A_REPO = { code: 128, stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git" };
const gates = {};
const gate = (name, value) => new Promise((resolve) => { gates[name] = () => resolve(value); });
window.release = (name) => { gates[name]?.(); delete gates[name]; };
const US = "\u001f", RS = "\u001e";
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

/** Per tool: its tile kind, settings, saved layout and folder, what its programs print, and what they
 *  print when they fail (by default, git outside a repository). */
export const FIXTURES = {
  "todo-finder": {
    kind: "todo-finder", settings: { pattern: "TODO|FIXME|HACK|XXX" },
    run: () => ok("src/a.ts:3:// TODO: make it fast\nsrc/a.ts:9:// FIXME: it leaks\nlib/b.py:12:# HACK work around the cache\n"),
  },
  "git-history": {
    kind: "git-history", settings: {},
    run: (bin, args) => args[0] === "log"
      ? ok([["a1b2c3d4e5", "a1b2c3d", "Ada", "2 hours ago", "fix: the build"], ["b2c3d4e5f6", "b2c3d4e", "Grace", "3 days ago", "docs: a typo"]].map((r) => r.join(US)).join("\n"))
      : ok("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n"),
  },
  "ci-runs": {
    kind: "ci-runs", settings: { count: 40, branch: "all" },
    run: (bin, args) => {
      if (args[1] === "list") return ok(JSON.stringify([
        { databaseId: 103, displayTitle: "feat: a new page", headBranch: "main", status: "in_progress", conclusion: "", workflowName: "CI", createdAt: ago(2), event: "push", url: "https://example.test/103" },
        { databaseId: 102, displayTitle: "chore: deps", headBranch: "main", status: "queued", conclusion: "", workflowName: "CI", createdAt: ago(1), event: "push", url: "https://example.test/102" },
        { databaseId: 101, displayTitle: "fix: the build", headBranch: "main", status: "completed", conclusion: "failure", workflowName: "CI", createdAt: ago(30), event: "push", url: "https://example.test/101" },
        { databaseId: 100, displayTitle: "docs: a typo", headBranch: "main", status: "completed", conclusion: "success", workflowName: "CI", createdAt: ago(90), event: "push", url: "https://example.test/100" },
        { databaseId: 99, displayTitle: "chore: skip", headBranch: "dev", status: "completed", conclusion: "cancelled", workflowName: "CI", createdAt: ago(900), event: "pull_request", url: "https://example.test/99" },
      ]));
      if (args[1] === "view" && args[2] === "--job") return ok([
        "typecheck\tSet up\t2026-10-07T10:00:00.0000000Z setting up",
        "typecheck\tTypecheck\t2026-10-07T10:00:01.0000000Z src/a.ts(1,1): error TS2345: boom",
        "typecheck\tTypecheck\t2026-10-07T10:00:01.0000000Z ##[error]Process completed with exit code 2.",
        "typecheck\tTypecheck\t2026-10-07T10:00:02.0000000Z cleaning up",
      ].join("\n"));
      if (args[1] === "view") return ok(JSON.stringify({ jobs: [
        { databaseId: 7, name: "lint", status: "completed", conclusion: "success", steps: [{ number: 1, name: "Lint", status: "completed", conclusion: "success" }] },
        { databaseId: 8, name: "typecheck", status: "completed", conclusion: "failure", steps: [{ number: 1, name: "Typecheck", status: "completed", conclusion: "failure" }] },
        { databaseId: 9, name: "e2e", status: "in_progress", conclusion: "", steps: [{ number: 1, name: "Set up", status: "completed", conclusion: "success" }, { number: 2, name: "Run", status: "in_progress", conclusion: "" }] },
      ] }));
      return ok("");
    },
  },
  worktrees: {
    kind: "worktrees", settings: { base: "main" }, repoPath: "/r/app",
    run: (bin, args) => {
      if (args[0] === "worktree") return ok("worktree /r/app\nHEAD aaaa\nbranch refs/heads/main\n\nworktree /r/wt-work\nHEAD bbbb\nbranch refs/heads/feat\n\nworktree /r/wt-merged\nHEAD cccc\nbranch refs/heads/done\n\nworktree /r/gone\nHEAD dddd\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n");
      const at = args[1];
      if (args[2] === "status") return ok(at === "/r/wt-work" ? " M a.ts\n?? new.txt\n" : "");
      if (args[2] === "rev-list") return ok(at === "/r/wt-work" ? "2\t3\n" : "0\t0\n");
      if (args[2] === "log") return ok(`1700000000${US}2 hours ago${US}feat: committed`);
      return ok("diff --git a/a.ts b/a.ts\n");
    },
  },
  "api-explorer": {
    kind: "api-explorer", settings: { baseUrl: "http://127.0.0.1:8000" },
    run: (bin, args) => {
      if (bin === "git") return ok([
        'app/main.py:10:@app.get("/items")', 'app/main.py:14:@app.post("/items")', 'app/main.py:20:@app.put("/items/{id}")',
        'app/main.py:24:@app.patch("/items/{id}")', 'app/main.py:28:@app.delete("/items/{id}")', 'app/main.py:32:@app.websocket("/ws")',
      ].join("\n"));
      const url = args[args.length - 1];
      if (/refused/.test(url)) return Promise.resolve({ code: 7, stdout: "", stderr: "" });
      const status = /500/.test(url) ? "500 Internal Server Error" : /404/.test(url) ? "404 Not Found" : /301/.test(url) ? "301 Moved Permanently" : "200 OK";
      return ok(`HTTP/1.1 ${status}\r\ncontent-type: application/json\r\nx-request-id: 42\r\n\r\n{"ok": true, "items": [1, 2]}`);
    },
  },
  "bundle-size": {
    kind: "bundle-size", settings: { folder: "dist" },
    layout: { baseline: { folder: "dist", at: "2026-10-20T10:00:00.000Z", total: 300000, gzip: 90000, capped: false, files: { "app.js": { bytes: 150000, gzip: 50000 }, "app.css": { bytes: 30000, gzip: 9000 }, "logo.png": { bytes: 20000, gzip: null }, "old.js": { bytes: 9000, gzip: 3000 }, "app.js.map": { bytes: 91000, gzip: 28000 } } } },
    run: (bin) => {
      if (bin === "find") return ok("dist/app.js\ndist/app.css\ndist/logo.png\ndist/font.woff2\ndist/app.js.map\ndist/robots.txt\n");
      // The source map is the largest file, so its bar is the widest.
      if (bin === "wc") return ok("160000 dist/app.js\n 28000 dist/app.css\n 20000 dist/logo.png\n 40000 dist/font.woff2\n195000 dist/app.js.map\n   100 dist/robots.txt\n443100 total\n");
      if (bin === "python3") return ok("52000\tdist/app.js\n8500\tdist/app.css\n29000\tdist/app.js.map\n");
      return ok("");
    },
    // A folder it cannot read is "no folder here"; a program that does not start is its error.
    fail: () => Promise.reject(new Error("find could not start: spawn find ENOENT")),
  },
  "changelog-writer": {
    kind: "changelog-writer", settings: { count: 50, hashes: true },
    run: (bin, args) => {
      if (args[0] === "describe") return ok("v1.2.0\n");
      const c = (hash, subject) => `${hash}${US}${subject}${US}${RS}`;
      return ok([c("a1", "feat(ui)!: drop the old page"), c("a2", "feat(api): a new route"), c("a3", "fix: the build"), c("a4", "perf(db): faster reads"), c("a5", "refactor: tidy"), c("a6", "docs: a typo"), c("a7", "chore: bump")].join(""));
    },
  },
  "dependency-audit": {
    kind: "dependency-audit", settings: {},
    run: (bin, args, opts) => {
      // A second lockfile that does not parse.
      if (bin === "git") return ok("package-lock.json\nweb/package-lock.json\n");
      if (bin === "cat" && args[1] !== "package-lock.json") return ok("this is not a lockfile [[[");
      if (bin === "cat") return ok(JSON.stringify({ name: "web", lockfileVersion: 3, packages: { "": { name: "web" }, "node_modules/lodash": { version: "4.17.15" }, "node_modules/minimist": { version: "1.2.0" }, "node_modules/semver": { version: "5.7.0" }, "node_modules/debug": { version: "2.6.0" }, "node_modules/ws": { version: "7.0.0" } } }));
      const ids = { lodash: ["GHSA-crit", "GHSA-hi"], minimist: ["GHSA-mod"], semver: ["GHSA-low"], debug: ["GHSA-unk"] };
      if (args.some((a) => /querybatch/.test(a))) return ok(JSON.stringify({ results: JSON.parse(opts.stdin).queries.map((q) => ({ vulns: (ids[q.package.name] ?? []).map((id) => ({ id })) })) }));
      const id = decodeURIComponent(args[args.length - 1].split("/").pop());
      const severity = { "GHSA-crit": "CRITICAL", "GHSA-hi": "HIGH", "GHSA-mod": "MODERATE", "GHSA-low": "LOW", "GHSA-unk": "" }[id];
      const pkg = Object.keys(ids).find((p) => ids[p].includes(id));
      return ok(JSON.stringify({ id, aliases: ["CVE-2020-1234"], summary: `A problem in ${pkg}`, database_specific: { severity }, affected: [{ package: { name: pkg }, ranges: [{ events: [{ introduced: "0" }, ...(id === "GHSA-unk" ? [] : [{ fixed: "9.9.9" }])] }] }] }));
    },
  },
  "flaky-tests": {
    kind: "flaky-tests", settings: { command: "bun test", runs: 4 },
    // Four runs: b passes every other one, c always fails, d is missing from the second; the third
    // waits until the test lets it go.
    run: (() => {
      let n = 0;
      return () => {
        const i = n++;
        const out = ["(pass) a > adds", i % 2 ? "(fail) b > waits" : "(pass) b > waits", "(fail) c > breaks", ...(i === 1 ? [] : ["(pass) d > reads"])].join("\n");
        return i === 2 ? gate("run3", { code: 1, stdout: out, stderr: "" }) : ok(out);
      };
    })(),
  },
  "github-prs": {
    kind: "github-prs", settings: { state: "open" }, repoPath: "/r/app",
    run: (bin, args) => {
      if (args[1] === "list") return ok(JSON.stringify([
        { number: 12, title: "Add the page", author: { login: "ada" }, headRefName: "feat/page", isDraft: false, updatedAt: ago(5), reviewDecision: "CHANGES_REQUESTED" },
        { number: 11, title: "Draft work", author: { login: "grace" }, headRefName: "wip", isDraft: true, updatedAt: ago(50), reviewDecision: "" },
      ]));
      return ok(JSON.stringify({ number: 12, title: "Add the page", body: "It adds the page.", author: { login: "ada" }, url: "https://example.test/12", state: "OPEN", comments: [{ author: { login: "grace" }, body: "Looks good" }], reviews: [{ author: { login: "lin" }, state: "CHANGES_REQUESTED", body: "One thing" }], statusCheckRollup: [{ name: "ci", conclusion: "SUCCESS" }], mergeable: "MERGEABLE" }));
    },
  },
  "log-tail": {
    kind: "log-tail", settings: { file: "app.log", lines: 500 },
    run: () => ok([
      "2026-10-25 10:00:00 INFO server started on :8000",
      "2026-10-25 10:00:01 DEBUG cache warm: 120 keys",
      "2026-10-25 10:00:02 WARN slow query took 1200 ms",
      "2026-10-25 10:00:03 ERROR could not reach the database",
      "2026-10-25 10:00:04 plain line without a level",
      '{"level":"error","msg":"json logger failure"}',
    ].join("\n") + "\n"),
  },
  "release-checklist": {
    kind: "release-checklist", settings: { branch: "main", testCommand: "bun test" },
    run: (bin, args) => {
      if (bin === "bun") return gate("tests", { code: 1, stdout: "(fail) a > b\n1 fail", stderr: "" });
      if (args[0] === "describe") return ok("v1.2.0\n");
      if (args[0] === "status") return ok(" M src/a.ts\n");
      if (args[0] === "branch") return ok("main\n");
      if (args[0] === "rev-list") return ok("0\t0\n");
      if (args[0] === "ls-files") return ok("CHANGELOG.md\nsrc/a.ts\n");
      if (bin === "cat") return ok("# Changelog\n\n## [Unreleased]\n\n- A thing\n");
      if (args[0] === "diff") return ok("diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n a\n+// TODO: later\n");
      return ok("");
    },
  },
  "sqlite-browser": {
    kind: "sqlite-browser", settings: {},
    run: (bin, args) => {
      // The steps to the file, each a real folder or file (find -maxdepth 0 prints what it was given).
      if (bin === "find" && args.includes("-maxdepth")) return ok(args.filter((a) => a.startsWith("./")).join("\n") + "\n");
      if (bin === "find") return ok("./data/app.db\n");
      const sql = args[args.length - 1];
      if (/sqlite_schema/.test(sql)) return ok(JSON.stringify([{ name: "items", type: "table" }, { name: "recent", type: "view" }]));
      if (/count/i.test(sql)) return ok(JSON.stringify([{ name: "items", count: 3 }, { name: "recent", count: 1 }]));
      return ok(JSON.stringify([{ id: 1, name: "one", note: null, price: 9.5 }, { id: 2, name: "two", note: "x", price: 12 }]));
    },
    // Its programs fail at the query: the file is there, sqlite3 refuses it.
    fail: (bin, args, opts) => (bin === "sqlite3" ? Promise.resolve({ code: 1, stdout: "", stderr: "Error: in prepare, file is not a database (26)" }) : FIXTURES["sqlite-browser"].run(bin, args, opts)),
  },
};

for (const f of Object.values(FIXTURES)) f.fail ??= () => Promise.resolve(NOT_A_REPO);
