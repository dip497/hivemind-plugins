/**
 * The view's own toolbar, a plank of the dock along the bottom: the app's toolbar is off over this
 * view (`"toolbar": "off"`). What it does on the islands, it does itself; the app's menus (views,
 * Add, appearance) it asks the app to open (`hm.commands.openHostMenu`, protocol 1.15), and leaves
 * out on an app that cannot. Settings is the app's own gear in the corner, which it draws over a view
 * whose toolbar is off.
 */
import type { ViewAgent, ViewClient } from "@hivemind/view-sdk";
import type { Isle, Target } from "./start";

export interface BarDeps {
  hm: ViewClient;
  /** Where a new agent goes (null: where the app chooses), and the islands to choose from instead
   *  when that is only a guess. */
  where(): { target: Target | null; choices: Isle[] };
  /** Starts an agent there, as the island's card does: the view goes to it once its tile opens. */
  start(agent: string | null, frameId: string | null): void;
  /** The agents this machine can start. */
  agents(): Promise<ViewAgent[]>;
  nextCaller(): void;
  /** The plank changed height, and with it what keeps clear of it (`--bar-clear`). */
  cleared(): void;
}

const q = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;

export function setupBar(d: BarDeps): { calling(n: number): void } {
  const { hm } = d;
  const start = q<HTMLButtonElement>(".bar .start"), crew = q(".menu.crew");
  const canStart = hm.capabilities.includes("workspace:spawn");
  start.hidden = q(".bar .new-island").hidden = !canStart;

  // Start an agent: which, from the agents installed, on the island in view or one chosen here.
  const close = (focus = false) => {
    if (crew.hidden) return;
    crew.hidden = true;
    start.setAttribute("aria-expanded", "false");
    if (focus) start.focus();
  };
  const open = async () => {
    const agents = await d.agents();
    const { target, choices } = d.where();
    let on: Isle | null = target;
    crew.replaceChildren();
    const head = document.createElement("p");
    head.className = "menu-head";
    const say = () => { head.textContent = on ? `Start on ${on.title}` : "Start an agent"; };
    say();
    crew.append(head);
    // Only a guess, the island in the middle of the view: the islands to start on instead, under the
    // heading, the guess checked. Choosing one changes where the agent goes, not what you look at.
    if (choices.length) {
      const isles = choices.map((isl) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "isle";
        b.setAttribute("role", "menuitemradio");
        b.setAttribute("aria-checked", String(isl.id === on?.id));
        b.textContent = isl.title;
        b.onclick = () => {
          on = isl;
          say();
          for (const other of isles) other.setAttribute("aria-checked", String(other === b));
        };
        return b;
      });
      const group = document.createElement("div");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", "Island to start on");
      group.append(...isles);
      const rule = document.createElement("div");
      rule.className = "menu-rule";
      rule.setAttribute("role", "separator");
      crew.append(group, rule);
    }
    // The person's default first; with no list (an older app), the default alone.
    const list = agents.length ? [...agents].sort((a, b) => Number(b.default) - Number(a.default)) : [{ id: null, label: "Your default agent", default: true }];
    const first = list.map((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = a.label;
      if (a.default && a.id) { const tag = document.createElement("small"); tag.textContent = "default"; b.append(tag); }
      b.onclick = () => { close(true); d.start(a.id, on?.id ?? null); };
      crew.append(b);
      return b;
    })[0];
    const r = start.getBoundingClientRect();
    crew.style.left = `${Math.round(r.left)}px`;
    crew.style.bottom = `${Math.round(innerHeight - r.top + 8)}px`;
    crew.hidden = false;
    start.setAttribute("aria-expanded", "true");
    // On the default agent, as before there were islands to choose: Enter starts it.
    first?.focus();
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
    const views = q(".bar .views");
    views.addEventListener("click", () => {
      const r = views.getBoundingClientRect();
      hm.commands.openHostMenu("views", { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    });
  }

  // Where the plank has no room for every label on one row, they give way to their icons, the new
  // island's first, then the view's name, then the start's, each button keeping its icon and its
  // title; with no room for its icons alone, it takes a second row. Measured, not set by the window's
  // width: the person's or the theme's font decides how wide the labels are. The card, the terminal
  // and the walking line keep as far above it as it sits above the foot (`--bar-clear`). Once when
  // set up, and again when the window is resized or a theme (its font) arrives, never per frame.
  const bar = q(".bar"), labels = [".new-island", ".views", ".start"].map((s) => q(`.bar ${s} span`));
  const buttons = [...bar.querySelectorAll<HTMLElement>(".btn")];
  const below = parseFloat(getComputedStyle(bar).bottom);
  let clear = 0;
  const oneRow = () => {
    const shown = buttons.filter((b) => b.offsetWidth);
    return shown.length < 2 || shown.at(-1)!.offsetTop < shown[0]!.offsetTop + shown[0]!.offsetHeight;
  };
  const fit = () => {
    for (const l of labels) l.hidden = false;
    for (const l of labels) { if (oneRow()) break; l.hidden = true; }
    const now = bar.offsetHeight + 2 * below;
    if (now === clear) return;
    clear = now;
    document.documentElement.style.setProperty("--bar-clear", `${now}px`);
    d.cleared();
  };
  fit();
  addEventListener("resize", fit);
  hm.on("theme", fit);

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
