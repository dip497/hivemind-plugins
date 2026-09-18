// Every file index.json lists exists with the hash it claims, and no plugin carries a file
// the index does not cover. The app enforces the same hashes at install, so a failure here
// is an install that would fail for someone.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const walk = (dir, base = dir) => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full, base) : [path.relative(base, full)];
});
const { plugins } = JSON.parse(readFileSync(path.join(root, "index.json"), "utf8"));
const problems = [];
const ids = new Set();
for (const p of plugins) {
  if (ids.has(p.id)) problems.push(`${p.id}: listed twice`);
  ids.add(p.id);
  const dir = path.join(root, p.path);
  if (!existsSync(dir)) { problems.push(`${p.id}: ${p.path} is missing`); continue; }
  for (const f of p.files) {
    const file = path.join(dir, f.path);
    if (!existsSync(file)) { problems.push(`${p.id}: ${f.path} is listed but missing`); continue; }
    if (createHash("sha256").update(readFileSync(file)).digest("hex") !== f.sha256) problems.push(`${p.id}: ${f.path} does not match its hash`);
  }
  for (const f of walk(dir)) if (!p.files.some((l) => l.path === f)) problems.push(`${p.id}: ${f} is not in the index`);
}
for (const type of ["agents", "views"]) {
  if (!existsSync(path.join(root, type))) continue;
  for (const id of readdirSync(path.join(root, type))) {
    if (!plugins.some((p) => p.path === `${type}/${id}`)) problems.push(`${type}/${id} is not in the index`);
  }
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`index.json is consistent: ${plugins.length} plugins, every file hashed`);
