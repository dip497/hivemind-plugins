/**
 * Widgets — every widget in the workspace, on a phone or anywhere a board does not fit.
 *
 * It draws what each widget draws, from the same drawing nodes the app uses, and a press here is a
 * press there: the widget's code hears it wherever it runs. What people wrote in a note or a list
 * is shown as it is; writing in one is the board's, so it is not offered here.
 */
import { applyThemeVars, connect, type ViewWidget } from "@hivemind/view-sdk";

const hm = await connect();
applyThemeVars(hm);
const list = document.querySelector<HTMLDivElement>(".w-list")!;
const summary = document.querySelector<HTMLParagraphElement>(".w-summary")!;

type Node = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** One drawing node, as the app draws it; anything it does not know is left out. */
function draw(node: unknown, w: ViewWidget, depth = 0): HTMLElement | null {
  if (depth > 8 || typeof node !== "object" || node === null) return null;
  const n = node as Node;
  const kids = (parent: HTMLElement) => {
    if (Array.isArray(n.children)) for (const c of n.children.slice(0, 50)) { const k = draw(c, w, depth + 1); if (k) parent.append(k); }
    return parent;
  };
  switch (n.type) {
    case "stack": return kids(el("div", "stack"));
    case "row": return kids(el("div", "row"));
    case "text": return el("span", `text${n.size === "large" ? " large" : n.muted ? " muted" : ""}`, str(n.text));
    case "number": {
      const box = el("div", "number");
      box.append(el("b", undefined, str(n.value)));
      if (n.label != null) box.append(el("span", undefined, str(n.label)));
      return box;
    }
    case "meter": {
      const box = el("div", "meter stack");
      if (n.label != null) box.append(el("span", undefined, str(n.label)));
      const bar = el("div", "meter-bar");
      const fill = el("i");
      fill.style.width = `${Math.min(100, Math.max(0, (num(n.value) / Math.max(num(n.max, 1), 1e-9)) * 100))}%`;
      bar.append(fill);
      box.append(bar);
      return box;
    }
    case "button": {
      const b = el("button", undefined, str(n.label));
      b.type = "button";
      b.addEventListener("click", (e) => { e.stopPropagation(); hm.pressWidget(w.id, n.action); });
      return b;
    }
    case "image": {
      const url = w.images[str(n.src)];
      const img = el("img");
      if (url) img.src = url;
      img.alt = str(n.label);
      img.width = Math.min(Math.max(num(n.w, 64), 1), 1024);
      img.height = Math.min(Math.max(num(n.h, 64), 1), 1024);
      img.style.objectFit = "contain";
      return img;
    }
    case "sprite": {
      // The sheet's first frame of its row, at its scale: a phone shows it still.
      const url = w.images[str(n.src)];
      const fw = Math.min(Math.max(num(n.frameW, 32), 1), 1024), fh = Math.min(Math.max(num(n.frameH, 32), 1), 1024);
      const scale = Math.min(Math.max(num(n.scale, 1), 0.25), 8);
      const box = el("div", "sprite");
      box.setAttribute("role", "img");
      box.setAttribute("aria-label", str(n.label) || "animation");
      Object.assign(box.style, { width: `${fw * scale}px`, height: `${fh * scale}px`, backgroundImage: url ? `url("${url}")` : "none",
        backgroundSize: "auto", backgroundPosition: `0 ${-Math.max(0, Math.round(num(n.row))) * fh * scale}px`,
        imageRendering: n.pixelated === false ? "auto" : "pixelated", transform: n.flip ? "scaleX(-1)" : "" });
      return box;
    }
    case "input": case "textarea": {
      const p = el("div", `written${n.size === "large" ? " large" : ""}`, w.text ?? "");
      p.dataset.placeholder = str(n.placeholder);
      return p;
    }
    case "list": {
      const ul = el("ul", "list");
      for (const item of w.items ?? []) {
        const li = el("li", item.done ? "done" : "");
        li.append(el("span", undefined, item.done ? "☑" : "☐"), el("span", undefined, item.text));
        ul.append(li);
      }
      if (!w.items?.length) ul.append(el("li", "done", str(n.placeholder)));
      return ul;
    }
    default: return null;
  }
}

function render(widgets: ViewWidget[]) {
  summary.textContent = widgets.length ? `${widgets.length} in this workspace` : "";
  list.replaceChildren();
  if (!widgets.length) { list.append(el("p", "w-empty", "No widgets here yet. Add one from the app's toolbar.")); return; }
  for (const w of widgets) {
    const card = el("section", `card${w.tint ? ` tinted tint-${w.tint}` : w.card ? "" : " bare"}`);
    card.setAttribute("aria-label", w.name);
    card.append(el("p", "card-name", w.name));
    const drawn = w.tree === null ? el("p", "w-empty", "Waiting for it to draw.") : draw(w.tree, w);
    if (drawn) card.append(drawn);
    card.addEventListener("click", () => hm.clickWidget(w.id));
    list.append(card);
  }
}

if (!hm.supports("widgets")) {
  list.replaceChildren(el("p", "w-empty", "This Hivemind is too old to show widgets here: update it."));
} else {
  hm.onWidgets(render);
}
