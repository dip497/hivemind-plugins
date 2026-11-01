// Which tests a change needs, as the parts test.yml runs side by side.
//
//   node .github/test-plan.mjs [base] [head]  base: what the change is against (a pull request's
//                                             base, a push's before); none for the whole suite.
//                                             head: the change (HEAD)
//
// Prints `parts=<json>` and `any=<bool>` for $GITHUB_OUTPUT, and why on stderr.
//
// A plugin's folder is tested by the files that name it (its folder's name as a word) and by the
// files that walk every folder of its kind ("tools", "views", "widgets" as a string, as in
// path.join(ROOT, "views")). An agent's manifest has no test here; HiveHub checks it when it is
// published. A changed test file runs. Anything else (the tests' helpers, types/, build.mjs, the
// lockfile, the workflows) can touch every test, so it runs them all, and so does a plugin folder
// no test names: nothing says what covers it. Documents outside the plugins need none.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const base = process.argv[2] ?? "";
const head = process.argv[3] || "HEAD";
const say = (s) => process.stderr.write(`${s}\n`);

const TESTS = readdirSync("tests").filter((f) => f.endsWith(".test.ts")).sort().map((f) => `tests/${f}`);
const SLOW = "tests/views-theme.test.ts";
/** views-theme's tests by name: together every one of them (see test.yml). */
const VIEW_PARTS = [
  { name: "archipelago terminals", views: "^Archipelago, a terminal" },
  { name: "archipelago by night", views: "^Archipelago: by night" },
  { name: "archipelago other", views: "^Archipelago(?!, a terminal|: by night)" },
  { name: "island", views: "^Island" },
  { name: "other views", views: "^(?!Archipelago|Island)" },
];
const text = Object.fromEntries(TESTS.map((f) => [f, readFileSync(f, "utf8")]));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The test files that name `word` as a word, and those that walk a kind's folder `kind`. */
const naming = (word) => TESTS.filter((f) => new RegExp(`(^|[^\\w-])${escape(word)}([^\\w-]|$)`).test(text[f]));
const walking = (kind) => TESTS.filter((f) => new RegExp(`["']${kind}["']`).test(text[f]));

function plan() {
  if (!/^[0-9a-f]{7,40}$/.test(base) || /^0+$/.test(base)) return { all: `no base to compare with (${base || "none"})` };
  let changed;
  try {
    changed = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return { all: `${base} is not in this checkout's history` };
  }
  const files = new Set();
  for (const path of changed) {
    const [top, name, sub] = path.split("/");
    if (path.startsWith("tests/")) {
      if (path.endsWith(".test.ts") && !path.slice(6).includes("/")) files.add(path);
      else return { all: `${path} is shared by the tests` };
    } else if (top === "agents" && name) {
      // No test reads an agent's manifest.
    } else if (["tools", "views", "widgets", "packages"].includes(top) && name) {
      const kind = top === "packages" && ["views", "widgets", "tools"].includes(sub) ? sub : top;
      const by = [...naming(name), ...(kind === "packages" ? [] : walking(kind))];
      if (!by.length) return { all: `no test names ${top}/${name}` };
      for (const f of by) files.add(f);
    } else if (!path.includes("/") && /\.(md|txt)$|^LICENSE/.test(path)) {
      // A document.
    } else return { all: `${path} can touch every test` };
  }
  return { files: [...files].sort(), changed: changed.length };
}

const p = plan();
const run = p.all ? TESTS : p.files;
if (p.all) say(`every test: ${p.all}`);
else say(`${p.changed} files changed; tests that cover them: ${run.join(", ") || "none"}`);
const others = run.filter((f) => f !== SLOW);
const parts = [
  ...(run.includes(SLOW) ? VIEW_PARTS : []),
  // Up to four files in one part; more in two, every other file in each.
  ...(others.length > 4 ? [0, 1].map((k) => ({ name: `other files ${k + 1}`, files: others.filter((_, i) => i % 2 === k).join(" ") })) : others.length ? [{ name: "other files", files: others.join(" ") }] : []),
];
process.stdout.write(`parts=${JSON.stringify(parts)}\nany=${parts.length > 0}\n`);
