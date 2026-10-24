// The transport contract (design §9.0: "the sync engine never knows which transport it's talking
// to"): one suite, run as it is over the Rovo MCP transport on the fake Rovo server and over the REST
// transport on the fake Jira, on the three Cloud sites. Every expectation comes from the site's model,
// so both transports are held to what Jira has, not to each other. Then the engine on each: scope,
// poll, reconcile and the empty-scope guard.
import { afterEach, expect, test } from "bun:test";
import { CLOUD, ME, account, closeAll, jira, linked, mirrored, restAccount, rovo, signIn } from "./harness";
import type { AccountTransport } from "../../tools/jira/src/service/account";
import { fieldsOf } from "../../tools/jira/src/service/engine/sync";
import { TransportError } from "../../tools/jira/src/service/transport";

afterEach(closeAll);

type Kind = "mcp" | "rest";
const KINDS: Kind[] = ["mcp", "rest"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Model = any;

/** A transport of `kind` on a fresh copy of `site`, and the live model behind it. */
async function open(kind: Kind, site: string, before?: (m: Model) => void): Promise<{ t: AccountTransport; m: Model }> {
  if (kind === "rest") {
    const j = await jira(site);
    before?.(j.site);
    const r = restAccount(j);
    await r.account.init();
    return { t: r.account.transport(), m: j.site };
  }
  const f = await rovo(site);
  before?.(f.site);
  const r = account(f);
  await signIn(r);
  return { t: r.account.transport(), m: f.site };
}

const project = (m: Model) => m.projects[0];
const visible = (m: Model, i: Model) => !i.restricted && !i.deleted && i.project === project(m).key;
const keysOf = (m: Model) => m.issues.filter((i: Model) => visible(m, i)).map((i: Model) => i.key as string).sort();
const byKey = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

for (const kind of KINDS) {
  for (const site of CLOUD) {
    test(`${kind} ${site}: discover reads the project, its types and statuses, its boards, columns and sprints, and me`, async () => {
      const { t, m } = await open(kind, site);
      const p = project(m);
      const d = await t.discover(p.key);
      expect([d.cloudId, d.siteUrl, d.me.accountId, d.project.key, d.project.style]).toEqual([m.cloudId, m.baseUrl.replace(/\/$/, ""), ME, p.key, p.style]);
      expect(d.issueTypes.map((x) => [x.id, x.hierarchyLevel, x.statuses.map((s) => s.id)])).toEqual(
        p.issueTypes.map((x: Model) => [x.id, x.hierarchyLevel, m.workflows[x.workflow].statuses]),
      );
      const boards = m.boards.filter((b: Model) => b.projectKey === p.key);
      expect(d.boards.map((b) => [b.id, b.type])).toEqual(boards.map((b: Model) => [b.id, b.type]));
      const chosen = boards.find((b: Model) => b.type === "scrum") ?? boards[0];
      expect(d.board?.id).toBe(chosen?.id);
      if (chosen) expect(d.board!.columns.filter((c) => c.statuses.length).map((c) => c.statuses)).toEqual(chosen.columns.map((c: Model) => c.statuses).filter((s: string[]) => s.length));
      expect(d.sprints.map((s) => s.id)).toEqual(m.sprints.filter((s: Model) => s.boardId === chosen?.id && s.state !== "closed").map((s: Model) => s.id));
      // The custom fields the pull reads, found by schema whichever way the fields were listed.
      const sprintField = m.fields.find((f: Model) => f.schema?.custom === "com.pyxis.greenhopper.jira:gh-sprint" && (!f.scopeProjectId || f.scopeProjectId === p.id));
      expect(fieldsOf(d).sprintField?.id).toBe(chosen?.type === "scrum" ? sprintField.id : undefined);
    }, 30_000);

    test(`${kind} ${site}: search returns the fields asked for, page by page, until isLast`, async () => {
      // 150 more issues than the fixture has, so paging happens on either transport (pages of 100).
      const { t, m } = await open(kind, site, (s) => {
        const seed = s.issues.find((i: Model) => i.project === s.projects[0].key && !i.restricted && !i.deleted);
        for (let n = 0; n < 150; n++) s.issues.push({ ...structuredClone(seed), id: String(800_000 + n), key: `${seed.project}-${5000 + n}`, previousKeys: [], comments: [], changelog: [] });
      });
      const seen: string[] = [];
      let token: string | undefined;
      let pages = 0;
      do {
        const page = await t.search(`project = ${project(m).key} ORDER BY key ASC`, ["summary", "status"], token);
        pages++;
        for (const i of page.items) {
          expect(typeof i.fields.summary).toBe("string");
          expect((i.fields.status as { id: string }).id).toBe(m.issues.find((x: Model) => x.id === i.id).status);
          expect(i.fields.assignee).toBeUndefined();
          expect(i.descriptionMd).toBeUndefined();
        }
        seen.push(...page.items.map((i) => i.key));
        token = page.isLast ? undefined : page.nextPageToken;
      } while (token);
      expect(pages).toBeGreaterThan(1);
      expect(seen.sort(byKey)).toEqual(keysOf(m).sort(byKey));
    }, 30_000);

    test(`${kind} ${site}: count says how many a JQL finds`, async () => {
      const { t, m } = await open(kind, site);
      expect(await t.count!(`project = ${project(m).key}`)).toBe(keysOf(m).length);
    });

    test(`${kind} ${site}: bulkFetch returns what it can see, leaves out the deleted, restricted and unknown, and puts what it couldn't fetch now in errors`, async () => {
      const { t, m } = await open(kind, site, (s) => {
        const mine = s.issues.filter((i: Model) => i.project === s.projects[0].key && !i.restricted && !i.deleted);
        mine[0].deleted = true;
        mine[1].restricted = true;
      });
      const hidden = m.issues.filter((i: Model) => i.project === project(m).key && (i.deleted || i.restricted)).map((i: Model) => i.id);
      const shown = m.issues.filter((i: Model) => visible(m, i)).map((i: Model) => i.id);
      const got = await t.bulkFetch([...shown, ...hidden, "999999"], ["summary", "status"]);
      expect(got.issues.map((i) => i.id).sort()).toEqual([...shown].sort());
      expect(got.errors).toEqual([]);
      // Jira failing now (a 503) is not "gone": those ids come back as errors, to try again.
      m.faults.push({ name: "down", match: { method: "POST", path: kind === "rest" ? "/rest/api/3/issue/bulkfetch" : "/rest/api/3/search/jql", nth: 1, times: 1 }, status: 503 });
      const failed = await t.bulkFetch(shown.slice(0, 2), ["summary"]);
      expect([failed.issues, failed.errors]).toEqual([[], shown.slice(0, 2)]);
    }, 30_000);

    test(`${kind} ${site}: comments arrive oldest first, as markdown, with their authors`, async () => {
      const { t, m } = await open(kind, site);
      const i = m.issues.filter((x: Model) => visible(m, x)).sort((a: Model, b: Model) => b.comments.length - a.comments.length)[0];
      const got = await t.comments(i.key);
      expect(got.map((c) => c.id)).toEqual(i.comments.map((c: Model) => c.id));
      for (const [n, c] of got.entries()) {
        expect(c.author.accountId).toBe(i.comments[n].author);
        expect(c.bodyMd).not.toMatch(/"type":|<\/?p>/);
        expect(c.bodyMd.length).toBeGreaterThan(0);
      }
    });
  }

  test(`${kind}: transitions name every edge from the issue's status, those a condition hides from this person as unavailable, with their screens' required fields`, async () => {
    const { t, m } = await open(kind, "cloud-scrum-company");
    const met = (x: Model, issue: Model) => !x.condition || (x.condition.kind === "assigneeOnly" ? issue.assignee === ME : x.condition.allow.includes(ME));
    const unavailable: string[] = [];
    // PAY-318's Start is the assignee's alone (it isn't mine); PAY-322's moves have screens.
    for (const key of ["PAY-318", "PAY-322"]) {
      const issue = m.issues.find((i: Model) => i.key === key);
      const wf = m.workflows[project(m).issueTypes.find((x: Model) => x.id === issue.issueType).workflow];
      const expected = wf.transitions.filter((x: Model) => (x.from === "*" ? x.to !== issue.status : x.from.includes(issue.status)));
      const got = await t.transitions(key);
      expect(got.map((x) => [x.id, x.to.id, x.isGlobal, x.hasScreen, x.isAvailable])).toEqual(expected.map((x: Model) => [x.id, x.to, x.from === "*", x.hasScreen, met(x, issue)]));
      unavailable.push(...got.filter((x) => !x.isAvailable).map((x) => `${key}:${x.name}`));
      for (const x of expected) {
        expect(Object.entries(got.find((g) => g.id === x.id)!.fields).filter(([, f]) => f.required).map(([k]) => k)).toEqual(Object.entries(x.fields).filter(([, f]: Model) => f.required).map(([k]) => k));
      }
    }
    expect(unavailable).toEqual(["PAY-318:Start"]);
  });

  test(`${kind}: a project the person can't see is not found, in Jira's words`, async () => {
    const { t } = await open(kind, "cloud-jwm-noboard");
    const err = await t.discover("NOPE").catch((e: unknown) => e) as TransportError;
    expect([err.kind, err.message]).toEqual(["not-found", "no Jira project NOPE that you can see on acme.atlassian.net"]);
  });

  // ── the engine over each transport ────────────────────────────────────────────────────────────

  test(`${kind}: configure pulls the scope, a change in Jira reaches the mirror on the next sync, and a reconcile archives what left with its reason`, async () => {
    const { f, w, root } = await linked("cloud-scrum-company", { kind, scope: { kind: "mine" } });
    const live = async () => (await mirrored(root)).filter((i) => !i.archived).map((i) => i.id);
    expect(await live()).toEqual(["PAY-322", "PAY-323", "PAY-324", "PAY-328", "PAY-330"]);
    const issue = (k: string) => f.site.issues.find((i: Model) => i.key === k);
    issue("PAY-323").summary = "Renamed in Jira";
    issue("PAY-323").updated = "2026-10-24T23:00:00.000+0000";
    issue("PAY-330").restricted = true;
    issue("PAY-328").assignee = null;
    const r = await w.handle("sync-now", { reconcile: true }) as { updated: string[]; archived: string[] };
    expect(r.updated).toContain("PAY-323");
    expect((await mirrored(root)).filter((i) => i.archived).map((i) => [i.id, i.archived])).toEqual([["PAY-328", "left scope"], ["PAY-330", "no access"]]);
  }, 30_000);

  test(`${kind}: rich text (a panel, a mention, a lozenge, a task list, code) is mirrored as markdown, its acceptance criteria as hive's own list`, async () => {
    const { root } = await linked("cloud-scrum-company", { kind, scope: { kind: "mine+unassigned" } });
    const text = await Bun.file(`${root}/mirror/jira-acme-PAY/PAY-318.md`).text();
    expect(text).not.toMatch(/<\/?(p|div|span|ul|li|h3|input)\b|"type":/);
    expect(text).toContain("[the runbook](https://wiki.example.com/runbook)");
    expect(text).toContain("> Do not retry 4xx except 429.");
    expect(text).toMatch(/## Acceptance criteria\s+- \[x\] Retries 5 times with jittered backoff\s+- \[ \] Dead-letters after the last retry/);
    expect(text).toContain("```ts\nawait retry(send, { attempts: 5 })\n```");
    expect(text).toContain("@Jane Doe owns the queue.");
  }, 30_000);

  test(`${kind}: a scope that suddenly finds nothing archives nothing and says so`, async () => {
    const { f, w, root } = await linked("cloud-jwm-noboard", { kind, scope: { kind: "mine" } });
    expect((await mirrored(root)).map((i) => i.id)).toEqual(["MKT-1"]);
    for (const i of f.site.issues) i.assignee = null;
    await w.handle("sync-now", { reconcile: true });
    expect((await mirrored(root)).map((i) => [i.id, i.archived])).toEqual([["MKT-1", null]]);
    expect(((await w.handle("status", {})) as { problems: string[] }).problems.some((p) => p.startsWith("scope returned nothing"))).toBe(true);
  }, 30_000);
}
