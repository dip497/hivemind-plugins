// A codicon, or a tile's own mark: an agent's as the app draws it (the host sends it as one <svg>
// in currentColor), else one for its kind. The status marks are the app's (STATUS_MARKS).
import { STATUS_MARKS, type ViewTile } from "@hivemind/view-sdk";
import { ICONS, type IconName } from "./icons";

export function Icon({ name, size = 16, title }: { name: IconName; size?: number; title?: string }) {
  return (
    <svg className="icon" width={size} height={size} viewBox={`0 0 ${ICONS[name][0]} ${ICONS[name][0]}`} aria-hidden={title ? undefined : true} role={title ? "img" : undefined}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title.replace(/[<&]/g, "")}</title>` : "") + ICONS[name][1] }} />
  );
}

const KIND_ICONS: Record<string, IconName> = {
  shell: "terminal", terminal: "terminal", editor: "fileCode", file: "fileCode", browser: "globe", note: "note",
  tree: "listTree", diff: "diff", issues: "issues", planReview: "preview", image: "preview", video: "preview",
};

/** The icon a tile shows in the explorer, its tab, the quick open and the breadcrumbs. */
export function TileIcon({ tile }: { tile: ViewTile }) {
  // The host's own mark for an agent: one <svg> in currentColor, from the app, never from the view's data.
  if (tile.icon && tile.icon.trimStart().startsWith("<svg")) return <span className="tile-icon" style={{ display: "grid", width: 16, height: 16 }} dangerouslySetInnerHTML={{ __html: tile.icon }} />;
  return <Icon name={tile.agent ? "sparkle" : KIND_ICONS[tile.kind] ?? "file"} />;
}

export type Tone = keyof typeof STATUS_MARKS;

/** A state as the app marks it everywhere: its shape in the host's status colour. */
export function Mark({ tone, size = 8, title }: { tone: Tone; size?: number; title?: string }) {
  const m = (STATUS_MARKS as Partial<typeof STATUS_MARKS> | undefined)?.[tone];
  return (
    <svg viewBox="0 0 10 10" width={size} height={size} className={m?.pulse ? "waits" : undefined} style={{ flex: "none", color: `var(--hm-status-${tone})` }} role="img" aria-label={title ?? m?.word ?? tone}>
      <path d={m?.path ?? "M5 0.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9Z"} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/** The workbench's mark, where VS Code has its own: the hive's hexagon, drawn here. */
export function Logo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ display: "block" }}>
      <path fill="currentColor" d="M8 .8l6.2 3.6v7.2L8 15.2 1.8 11.6V4.4L8 .8zm0 1.7L3.3 5.2v5.6L8 13.5l4.7-2.7V5.2L8 2.5z" />
      <path fill="currentColor" d="M8 5.2l2.4 1.4v2.8L8 10.8 5.6 9.4V6.6L8 5.2z" />
    </svg>
  );
}
