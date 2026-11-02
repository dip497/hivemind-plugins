// A sash: the 4px edge between two parts that the pointer drags to resize them, as VS Code's. While
// it drags, live terminals let the pointer through (App makes their surfaces inert), so a drag over
// one does not stop.
import { useRef, useState } from "react";
import type { Bench } from "./App";

export function Sash({ dir, b, onMove, onReset }: { dir: "v" | "h"; b: Bench; onMove: (delta: number, total: number) => void; onReset?: () => void }) {
  const last = useRef(0);
  const [dragging, setDragging] = useState(false);
  return (
    <div className={`sash ${dir}${dragging ? " dragging" : ""}`} role="separator" aria-orientation={dir === "v" ? "vertical" : "horizontal"}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = dir === "v" ? e.clientX : e.clientY;
        setDragging(true);
        b.drag.resizing(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const at = dir === "v" ? e.clientX : e.clientY;
        const delta = at - last.current;
        if (!delta) return;
        last.current = at;
        onMove(delta, b.editorsRef.current?.clientWidth ?? 0);
      }}
      onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); b.drag.resizing(false); }}
      onPointerCancel={() => { setDragging(false); b.drag.resizing(false); }} />
  );
}
