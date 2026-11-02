// What floats over the workbench: menus (the menu bar's, a context menu), the quick input (Go to
// File, the Command Palette, a pick) and a dialog. Each carries `data-overlay`: App keeps live
// terminals out from under it, since the host draws them above the view.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { label as keyLabel } from "./keys";
import { Icon } from "./Icon";
import { highlight } from "./model";
import type { IconName } from "./icons";

export type MenuItem = { label: string; keys?: string; run?: () => void; disabled?: boolean; checked?: boolean } | "-";

/** A menu at a point: arrows move, Enter runs, Escape or a click elsewhere closes. */
export function Menu({ items, at, onClose, label, onDrawn }: { items: readonly MenuItem[]; at: { x: number; y: number }; onClose: () => void; label: string; onDrawn?: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const [on, setOn] = useState(-1);
  const live = items.map((it, i) => (it !== "-" && !it.disabled ? i : -1)).filter((i) => i >= 0);
  useLayoutEffect(() => {
    const b = el.current!.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(at.x, innerWidth - b.width - 4)), y: Math.max(4, Math.min(at.y, innerHeight - b.height - 4)) });
    el.current!.focus();
  }, [at.x, at.y]);
  // Where it is now decides which terminals it would cover.
  useLayoutEffect(() => onDrawn?.());
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!el.current?.contains(e.target as Node)) onClose(); };
    const blur = () => onClose();
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("blur", blur);
    return () => { document.removeEventListener("pointerdown", away, true); window.removeEventListener("blur", blur); };
  }, [onClose]);
  const run = (i: number) => {
    const it = items[i];
    if (!it || it === "-" || it.disabled) return;
    onClose();
    it.run?.();
  };
  return (
    <div ref={el} className="menu" role="menu" aria-label={label} tabIndex={-1} data-overlay style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => {
        const k = live.indexOf(on);
        if (e.key === "ArrowDown") { e.preventDefault(); setOn(live[(k + 1) % live.length] ?? -1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setOn(live[(k - 1 + live.length) % live.length] ?? -1); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(on); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
        else if (e.key === "Tab") e.preventDefault();
      }}>
      {items.map((it, i) => it === "-" ? <hr key={i} /> : (
        <div key={i} role="menuitem" aria-disabled={it.disabled || undefined} className={`item${on === i ? " on" : ""}${it.disabled ? " disabled" : ""}`}
          onPointerEnter={() => !it.disabled && setOn(i)} onPointerLeave={() => setOn(-1)} onClick={() => run(i)}>
          {it.checked && <span className="check"><Icon name="check" /></span>}
          <span>{it.label}</span>
          {it.keys && <span className="keys">{keyLabel(it.keys)}</span>}
        </div>
      ))}
    </div>
  );
}

export interface QuickItem {
  id: string;
  label: string;
  /** Matched letters of the label, drawn bold. */
  at?: readonly number[];
  desc?: string;
  icon?: ReactNode;
  keys?: string;
  /** Words at the end of the row ("recently opened"), as VS Code's separators carry. */
  tag?: string;
  run: () => void;
}

export interface QuickSource {
  placeholder: string;
  items: (value: string) => QuickItem[];
  /** What it says when nothing matches. */
  none: string;
}

/**
 * The quick input: a field above a list. `source(value)` decides from what is typed what to offer,
 * so ">" turns Go to File into the Command Palette, as in VS Code.
 */
export function QuickInput({ initial, source, onClose, onDrawn }: { initial: string; source: (value: string) => QuickSource; onClose: () => void; onDrawn?: () => void }) {
  const [value, setValue] = useState(initial);
  const [on, setOn] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const src = source(value);
  const items = useMemo(() => src.items(value), [src, value]);
  useEffect(() => { setOn(0); }, [value]);
  useLayoutEffect(() => { const f = field.current!; f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, []);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [onClose]);
  useLayoutEffect(() => { list.current?.querySelector(".item.on")?.scrollIntoView({ block: "nearest" }); }, [on]);
  // As the list grows and shrinks with what is typed, the terminals it covers change.
  useLayoutEffect(() => onDrawn?.());
  const run = (i: number) => { const it = items[i]; if (!it) return; onClose(); it.run(); };
  return (
    <div ref={box} className="quick" data-overlay role="dialog" aria-label="Quick input">
      <input ref={field} className="field" value={value} placeholder={src.placeholder} aria-label={src.placeholder} spellCheck={false}
        role="combobox" aria-expanded="true" aria-controls="quick-list" aria-activedescendant={items[on] ? `quick-${on}` : undefined}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOn((o) => (items.length ? (o + 1) % items.length : 0)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setOn((o) => (items.length ? (o - 1 + items.length) % items.length : 0)); }
          else if (e.key === "PageDown") { e.preventDefault(); setOn((o) => Math.min(items.length - 1, o + 15)); }
          else if (e.key === "PageUp") { e.preventDefault(); setOn((o) => Math.max(0, o - 15)); }
          else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); run(on); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
        }} />
      <div ref={list} className="items" id="quick-list" role="listbox">
        {items.length ? items.map((it, i) => (
          <div key={it.id} id={`quick-${i}`} role="option" aria-selected={i === on} className={`item${i === on ? " on" : ""}`}
            onPointerMove={() => i !== on && setOn(i)} onClick={() => run(i)}>
            {it.icon !== undefined && <span className="ico">{it.icon}</span>}
            <span className="label">{highlight(it.label, it.at ?? []).map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : p.text))}</span>
            {it.desc && <span className="desc">{it.desc}</span>}
            {it.keys ? <span className="keys">{keyLabel(it.keys).split(" ").map((c, k) => <kbd key={k}>{c}</kbd>)}</span> : it.tag ? <span className="tag">{it.tag}</span> : null}
          </div>
        )) : <div className="none">{src.none}</div>}
      </div>
    </div>
  );
}

export interface DialogSpec {
  title: string;
  detail: string;
  icon?: IconName;
  /** The first is the default, as VS Code's dialogs put it; Escape is the last. */
  buttons: { label: string; run?: () => void }[];
}

/** A modal question, as VS Code asks before deleting a file. Escape cancels; Tab stays inside. */
export function Dialog({ spec, onClose }: { spec: DialogSpec; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { first.current?.focus(); }, []);
  const pick = (i: number) => { onClose(); spec.buttons[i]?.run?.(); };
  return (
    <div className="dialog-shade" data-overlay onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={spec.title}>
        <span className="ico"><Icon name={spec.icon ?? "warning"} size={32} /></span>
        <h2>{spec.title}</h2>
        <p>{spec.detail}</p>
        <div className="buttons">
          {spec.buttons.map((b, i) => (
            <button key={b.label} ref={i === 0 ? first : undefined} className={`button${i ? " secondary" : ""}`} onClick={() => pick(i)}
              onKeyDown={(e) => { if (e.key === "Tab") { e.preventDefault(); const all = [...(e.currentTarget.parentElement?.querySelectorAll("button") ?? [])]; all[(all.indexOf(e.currentTarget) + (e.shiftKey ? all.length - 1 : 1)) % all.length]?.focus(); } }}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
