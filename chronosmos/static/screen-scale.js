import { dimensions, ordinal, pixelsPerYear } from "./timeline.js";
// Screen 100% fits the available width. Physical print scale remains mmPerYear.
export function fittedScreenScale(doc, width, language = "en") {
  const span = ordinal(doc.end) - ordinal(doc.start);
  let lo = 0,
    hi = Math.max(1, width / (span * pixelsPerYear(doc)));
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (dimensions(doc, mid, language).width <= width) lo = mid;
    else hi = mid;
  }
  return Math.max(1e-9, lo);
}
