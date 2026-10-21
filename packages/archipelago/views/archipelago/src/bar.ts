/**
 * The view's own toolbar, a plank of the dock along the bottom: the app's toolbar is off over this
 * view (`"toolbar": "off"`). What it does on the islands, it does itself; the app's menus (views,
 * Add, appearance, Settings) it asks the app to open (`hm.commands.openHostMenu`, protocol 1.15),
 * and leaves out on an app that cannot.
 */
import type { ViewClient } from "@hivemind/view-sdk";

export interface BarDeps {
  hm: ViewClient;
  /** Where a new agent goes: the island looked at, or null for the app to choose. */
  island(): { id: string; title: string } | null;
  nextCaller(): void;
}

const q = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;

export function setupBar(d: BarDeps): { calling(n: number): void } {
  const { hm } = d;
  const start = q<HTMLButtonElement>(".bar .start"), crew = q(".menu.crew");
  const canStart = hm.capabilities.includes("workspace:spawn");
  start.hidden = q(".bar .new-island").hidden = !canStart;

  // Start an agent: which, from the agents installed, on the island in view.
  const close = (focus = false) => {
    if (crew.hidden) return;
    crew.hidden = true;
    start.setAttribute("aria-expanded", "false");
    if (focus) start.focus();
  };
  const open = async () => {
    const agents = hm.supports("agents") ? await hm.agents().catch(() => []) : [];
    const isl = d.island();
    crew.replaceChildren();
    const head = document.createElement("p");
    head.className = "menu-head";
    head.textContent = isl ? `Start on ${isl.title}` : "Start an agent";
    crew.append(head);
    const pick = (id: string | null) => { close(true); hm.commands.spawnAgent(id, isl?.id ?? null); };
    // The person's default first; with no list (an older app), the default alone.
    const list = agents.length ? [...agents].sort((a, b) => Number(b.default) - Number(a.default)) : [{ id: null, label: "Your default agent", default: true }];
    for (const a of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = a.label;
      if (a.default && a.id) { const tag = document.createElement("small"); tag.textContent = "default"; b.append(tag); }
      b.onclick = () => pick(a.id);
      crew.append(b);
    }
    const r = start.getBoundingClientRect();
    crew.style.left = `${Math.round(r.left)}px`;
    crew.style.bottom = `${Math.round(innerHeight - r.top + 8)}px`;
    crew.hidden = false;
    start.setAttribute("aria-expanded", "true");
    crew.querySelector<HTMLButtonElement>("button")?.focus();
  };
  start.addEventListener("click", () => { if (crew.hidden) void open(); else close(true); });
  crew.addEventListener("keydown", (e) => {
    const items = [...crew.querySelectorAll<HTMLButtonElement>("button")], at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.stopPropagation(); close(true); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus(); }
  });
  document.addEventListener("pointerdown", (e) => { if (!crew.contains(e.target as Node) && !start.contains(e.target as Node)) close(); });

  q(".bar .new-island").addEventListener("click", () => hm.commands.addFrame());
  const next = q<HTMLButtonElement>(".bar .next");
  next.addEventListener("click", () => d.nextCaller());

  // The app's own menus, where the app can open them.
  if (hm.supports("hostMenu")) {
    q(".bar .host").hidden = false;
    q(".bar .add").addEventListener("click", () => hm.commands.openHostMenu("add"));
    q(".bar .theme").addEventListener("click", () => hm.commands.openHostMenu("appearance"));
    q(".bar .settings").addEventListener("click", () => hm.commands.openHostMenu("settings"));
    const views = q(".bar .views");
    views.addEventListener("click", () => {
      const r = views.getBoundingClientRect();
      hm.commands.openHostMenu("views", { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    });
  }

  const count = q(".bar .next .count");
  return {
    calling(n) {
      next.disabled = n === 0;
      count.hidden = n === 0;
      count.textContent = String(n);
      next.title = n ? `Go to the next agent calling you (N) · ${n} calling` : "Nobody is calling you";
    },
  };
}
