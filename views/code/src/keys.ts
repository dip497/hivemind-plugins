// VS Code's key bindings, as Code answers them while its page has the keyboard: one chord ("mod+p")
// or two in a row ("mod+k mod+t"). `mod` is Cmd on a Mac and Ctrl elsewhere, as in VS Code.

export const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "") || /Mac OS X/.test(globalThis.navigator?.userAgent ?? "");

/** A key event as one chord, in the order mod, ctrl, alt, shift, key: "mod+shift+p". */
export function chordOf(e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, mac = MAC): string {
  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push("mod");
  if (mac && e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  // The key by its place, so shift and a layout's dead keys do not change it: Backquote stays "`".
  const code = e.code ?? "";
  let key = code.startsWith("Key") ? code.slice(3).toLowerCase()
    : code.startsWith("Digit") ? code.slice(5)
    : ({ Backquote: "`", Backslash: "\\", Comma: ",", Period: ".", Slash: "/", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]" } as Record<string, string>)[code]
    ?? e.key.toLowerCase();
  if (key === " ") key = "space";
  if (["control", "meta", "alt", "shift"].includes(key)) return "";
  parts.push(key);
  return parts.join("+");
}

/** A binding as VS Code prints it in its menus: Ctrl+Shift+P, or ⇧⌘P on a Mac. */
export function label(keys: string, mac = MAC): string {
  return keys.split(" ").map((chord) => {
    const parts = chord.split("+");
    const name = (k: string) => ({ mod: mac ? "⌘" : "Ctrl", ctrl: mac ? "⌃" : "Ctrl", alt: mac ? "⌥" : "Alt", shift: mac ? "⇧" : "Shift", pagedown: "PageDown", pageup: "PageUp", escape: "Escape", delete: "Delete", enter: "Enter", tab: "Tab", space: "Space", arrowleft: "LeftArrow", arrowright: "RightArrow" } as Record<string, string>)[k] ?? (k.length === 1 ? k.toUpperCase() : k[0]!.toUpperCase() + k.slice(1));
    if (mac) {
      const order = ["ctrl", "alt", "shift", "mod"];
      const mods = parts.slice(0, -1).sort((a, b) => order.indexOf(a) - order.indexOf(b));
      return mods.map(name).join("") + name(parts[parts.length - 1]!);
    }
    return parts.map(name).join("+");
  }).join(" ");
}

/** Matches key events against bindings, holding the first chord of a two-chord binding for a moment. */
export function createKeymap<T>(bindings: () => readonly { keys?: string; value: T }[]): (chord: string) => { hit: T } | "pending" | null {
  let pending: string | null = null;
  let at = 0;
  return (chord) => {
    if (!chord) return null;
    const now = Date.now();
    const typed = pending && now - at < 2000 ? `${pending} ${chord}` : chord;
    pending = null;
    for (const b of bindings()) if (b.keys && b.keys === typed) return { hit: b.value };
    if (typed !== chord) for (const b of bindings()) if (b.keys === chord) return { hit: b.value };
    if (bindings().some((b) => b.keys?.startsWith(`${chord} `))) { pending = chord; at = now; return "pending"; }
    return null;
  };
}
