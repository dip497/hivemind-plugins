// The workspace as the host tells it: frames, tiles, their names and states, who else is here, the
// widget cards' band and a log of what happened. One subscription per tile, dropped with the tile.
import type { StatusInfo, ViewClient, ViewEvent, ViewFrame, ViewParticipant, ViewPresence, ViewTile } from "@hivemind/view-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Seen } from "./model";

export interface LogLine { at: number; tileId: string | null; text: string; kind: ViewEvent["kind"] }

export interface World {
  /** Whether the host has said what is in the workspace yet: nothing is pruned before it has. */
  known: boolean;
  frames: ViewFrame[];
  tiles: ViewTile[];
  byId: Map<string, ViewTile>;
  frameById: Map<string, ViewFrame>;
  seen: Map<string, Seen>;
  participants: ViewParticipant[];
  presence: ViewPresence | null;
  band: { edge: "left" | "right"; width: number };
  log: LogLine[];
}

/** The Output panel keeps this much, as VS Code's output channels drop their oldest lines. */
const LOG_MAX = 500;

const WHY: Record<string, string> = { permission: "wants permission", question: "asked a question", review: "has something to review", approval: "wants approval", input: "waits for input" };

/** An event as a line of the Output panel. Never text an agent wrote: the host sends none. */
function lineOf(e: ViewEvent, name: (id: string) => string): string | null {
  switch (e.kind) {
    case "turn": return `${name(e.tileId)}: turn ${e.outcome && e.outcome !== "done" ? e.outcome : "finished"}`;
    case "needsInput": return `${name(e.tileId)} ${WHY[e.reason] ?? "needs you"}`;
    case "subagents": return `${name(e.tileId)}: ${e.active} helper${e.active === 1 ? "" : "s"} running`;
    case "tileOpened": return `${name(e.tileId)} opened${e.agent ? ` (${e.agent})` : ""}`;
    case "tileClosed": return `${name(e.tileId)} closed${e.failed ? " after a failure" : ""}`;
    default: return null;
  }
}

export function useWorld(hm: ViewClient): World {
  const [version, setVersion] = useState(0);
  const w = useRef({
    known: false, frames: [] as ViewFrame[], tiles: [] as ViewTile[], names: new Map<string, string>(), seen: new Map<string, Seen>(),
    watching: new Map<string, () => void>(), participants: [] as ViewParticipant[], presence: null as ViewPresence | null,
    band: { edge: "right" as "left" | "right", width: 0 }, log: [] as LogLine[],
  }).current;

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const offs: (() => void)[] = [];
    offs.push(hm.on("structure", (s) => {
      w.known = true;
      w.frames = s.frames;
      w.tiles = s.tiles;
      for (const t of s.tiles) {
        w.names.set(t.id, t.name);
        if (!w.watching.has(t.id)) {
          w.watching.set(t.id, hm.subscribeStatus(t.id, (status, info?: StatusInfo) => {
            w.seen.set(t.id, { status, since: info?.since, agent: info?.agent });
            bump();
          }));
        }
      }
      for (const [id, stop] of w.watching) if (!s.tiles.some((t) => t.id === id)) { stop(); w.watching.delete(id); w.seen.delete(id); w.names.delete(id); }
      bump();
    }));
    offs.push(hm.on("names", ({ names }) => { for (const [id, v] of Object.entries(names)) w.names.set(id, v); bump(); }));
    if (hm.supports("participants")) offs.push(hm.onParticipants((p) => { w.participants = p; bump(); }));
    if (hm.supports("presence")) offs.push(hm.onPresence((p) => { w.presence = p; bump(); }));
    if (hm.supports("widgetBand")) offs.push(hm.onWidgetBand((b) => { w.band = b; bump(); }));
    // An app before 1.18 floats cards and does not say the band: one column while a card floats.
    else if (hm.supports("widgets") && !hm.device.compact) offs.push(hm.onWidgets((ws) => {
      w.band = { edge: "right", width: ws.some((x) => x.card && x.placement === "screen") ? 268 : 0 };
      bump();
    }));
    if (hm.supports("events")) {
      const name = (id: string) => w.names.get(id) ?? id;
      offs.push(hm.onEvents(["turn", "needsInput", "subagents", "tileOpened", "tileClosed"], (e) => {
        const text = lineOf(e, name);
        if (!text) return;
        w.log = [...w.log.slice(-(LOG_MAX - 1)), { at: e.at, tileId: "tileId" in e ? e.tileId : null, text, kind: e.kind }];
        bump();
      }, { replaySince: Date.now() - 60 * 60_000 }));
    }
    return () => { for (const off of offs) off(); for (const stop of w.watching.values()) stop(); w.watching.clear(); };
  }, [hm, w]);

  return useMemo(() => {
    const tiles = w.tiles.map((t) => (w.names.get(t.id) && w.names.get(t.id) !== t.name ? { ...t, name: w.names.get(t.id)! } : t));
    return {
      known: w.known, frames: w.frames, tiles,
      byId: new Map(tiles.map((t) => [t.id, t])), frameById: new Map(w.frames.map((f) => [f.id, f])),
      seen: new Map(w.seen), participants: w.participants, presence: w.presence, band: w.band, log: w.log,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
}
