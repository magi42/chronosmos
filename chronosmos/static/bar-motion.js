import { joinedPeriodIssue } from "./geometry.js";
// Apply one constrained gesture from an immutable snapshot, including attachments.
import { ordinal, historical, MAX_YEAR } from "./timeline.js";
export function moveBars(doc, before, ids, dy, delta) {
  const moving = new Set(ids),
    bars = before.bars.filter((b) => moving.has(b.id));
  let low = -Infinity,
    high = Infinity,
    top = -Infinity,
    bottom = Infinity;
  for (const b of bars) {
    low = Math.max(low, -MAX_YEAR - ordinal(b.start));
    high = Math.min(high, MAX_YEAR - 1 - ordinal(b.end));
    top = Math.max(top, 60 - b.y);
    bottom = Math.min(bottom, doc.height - 60 - b.y);
    if (b.captionYear !== undefined) {
      low = Math.max(low, -MAX_YEAR - ordinal(b.captionYear));
      high = Math.min(high, MAX_YEAR - 1 - ordinal(b.captionYear));
    }
  }
  for (const event of before.events) {
    const ends = [event.startBarId, event.endBarId].filter(Boolean);
    if (!ends.some((id) => moving.has(id))) continue;
    for (const id of ends.filter((id) => !moving.has(id))) {
      const b = before.bars.find((b) => b.id === id);
      low = Math.max(low, ordinal(b.start) - ordinal(event.year));
      high = Math.min(high, ordinal(b.end) - ordinal(event.year));
    }
  }
  for (const p of before.joinedPeriods ?? []) {
    if (joinedPeriodIssue(before, p)) continue;
    const pair = [p.fromBarId, p.toBarId];
    if (
      !pair.some((id) => moving.has(id)) ||
      pair.every((id) => moving.has(id))
    )
      continue;
    const b = bars.find((b) => pair.includes(b.id));
    // A single-bar time move keeps the shared interval at its existing dates.
    low = Math.max(low, ordinal(p.end) - ordinal(b.end));
    high = Math.min(high, ordinal(p.start) - ordinal(b.start));
    if (b.mergeInto)
      low = Math.max(low, ordinal(p.end) - ordinal(b.end) + b.mergeYears);
  }
  delta = Math.max(low, Math.min(high, delta));
  dy = Math.round(Math.max(top, Math.min(bottom, dy)));
  const shift = (y) => historical(ordinal(y) + delta);
  for (const b of bars) {
    const target = doc.bars.find((v) => v.id === b.id);
    Object.assign(target, {
      y: b.y + dy,
      start: shift(b.start),
      end: shift(b.end),
    });
    if (b.captionYear !== undefined) target.captionYear = shift(b.captionYear);
    if (b.heightPeriods)
      target.heightPeriods = b.heightPeriods.map((p) => ({
        ...p,
        start: shift(p.start),
        end: shift(p.end),
      }));
  }
  for (const o of before.overlays.filter((o) => moving.has(o.anchorBarId)))
    doc.overlays.find((v) => v.id === o.id).year = shift(o.year);
  for (const e of before.events.filter(
    (e) => moving.has(e.startBarId) || moving.has(e.endBarId),
  ))
    doc.events.find((v) => v.id === e.id).year = shift(e.year);
  for (const b of before.branches ?? []) {
    const target = doc.branches.find((v) => v.id === b.id);
    if (moving.has(b.fromBarId)) target.fromYear = shift(b.fromYear);
    if (moving.has(b.toBarId)) target.toYear = shift(b.toYear);
  }
  for (const p of before.joinedPeriods ?? []) {
    if (joinedPeriodIssue(before, p)) continue;
    if ([p.fromBarId, p.toBarId].every((id) => moving.has(id)))
      Object.assign(
        doc.joinedPeriods.find((v) => v.id === p.id),
        { start: shift(p.start), end: shift(p.end) },
      );
  }
}
