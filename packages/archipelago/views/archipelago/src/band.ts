// The widget cards the app floats over the view, down its left edge (`"widgets": "left"` in
// hivemind-view.json): how wide a strip they take, which the overview, the header, the card and the
// names keep clear of.
import type { ViewWidgetBand } from "@hivemind/view-sdk";

/** One column of cards, from an app that does not say how wide they are (before protocol 1.18): 16 px
 *  in from the edge, 240 px wide, and the 12 px gap after them. */
export const WIDGET_COLUMN = 268;

/** How many px down the left the cards take: as wide as the app says (`widgetBand`), however many
 *  columns they stack into; or, from an app that does not say, one column while any widget sits on a
 *  card. A band along the right edge takes none of the left. */
export function clearLeft(band: ViewWidgetBand | null, cards: boolean): number {
  if (band) return band.edge === "left" ? Math.max(0, band.width) : 0;
  return cards ? WIDGET_COLUMN : 0;
}
