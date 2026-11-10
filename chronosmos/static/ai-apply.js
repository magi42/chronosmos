import { ordinal } from "./timeline.js";
// The server compiles proposals to ordinary elements. Applying remains one undo step.
export function applyAIProposal(
  original,
  proposal,
  { newTimeline = false } = {},
) {
  const doc = structuredClone(original),
    existingBars = new Set(doc.bars.map((b) => b.id));
  const allIds = new Set(
    ["bars", "events", "overlays", "branches", "joinedPeriods"].flatMap((k) =>
      (doc[k] ?? []).map((v) => v.id),
    ),
  );
  for (const kind of ["bars", "joinedPeriods", "events"]) {
    const additions = proposal[kind] ?? [];
    if ((doc[kind]?.length ?? 0) + additions.length > 500)
      throw Error("A timeline supports at most 500 elements of each kind.");
    doc[kind] ??= [];
    for (const item of additions) {
      if (!item.id || allIds.has(item.id))
        throw Error(
          "This proposal has already been applied or has conflicting identifiers.",
        );
      allIds.add(item.id);
      doc[kind].push(structuredClone(item));
    }
  }
  const bars = new Set(doc.bars.map((b) => b.id));
  doc.joinedPeriods = doc.joinedPeriods.filter(
    (p) => bars.has(p.fromBarId) && bars.has(p.toBarId),
  );
  doc.events = doc.events.filter(
    (e) =>
      (!e.startBarId || bars.has(e.startBarId)) &&
      (!e.endBarId || bars.has(e.endBarId)),
  );
  if (newTimeline) {
    doc.title = proposal.title || doc.title;
    doc.description = proposal.description || "";
    doc.translations = structuredClone(proposal.translations ?? {});
    if (proposal.bounds?.height) doc.height = proposal.bounds.height;
  }
  for (const p of proposal.translationUpdates ?? []) {
    const target =
      p.kind === "timeline" ? doc : doc[p.kind]?.find((v) => v.id === p.id);
    if (!target) continue;
    target.translations ??= {};
    target.translations[p.language] ??= {};
    for (const f of p.fields)
      if (!target.translations[p.language][f.field]?.trim())
        target.translations[p.language][f.field] = f.text;
  }
  const additions = doc.bars.filter((b) => !existingBars.has(b.id));
  if (additions.length) {
    const bounds = additions.flatMap((b) => [b.start, b.end]);
    if (!newTimeline) bounds.push(doc.start, doc.end);
    doc.start = bounds.reduce((a, b) => (ordinal(a) < ordinal(b) ? a : b));
    doc.end = bounds.reduce((a, b) => (ordinal(a) > ordinal(b) ? a : b));
    doc.height = Math.max(
      doc.height,
      ...additions.map((b) => Math.min(4000, b.y + 100)),
    );
    if (newTimeline)
      doc.mmPerYear = Math.max(
        1e-12,
        Math.min(100, 800 / (ordinal(doc.end) - ordinal(doc.start))),
      );
  }
  return doc;
}
