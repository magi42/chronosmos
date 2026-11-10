export const MAX_STACK_ORDER = 1000000;
export const barStackOrder = (bar) => bar.zIndex ?? 0;
export function orderedBars(doc) {
  return [...doc.bars].sort((a, b) => barStackOrder(a) - barStackOrder(b));
}
// Branches follow their source's layer, below bars on that same layer.
// All-zero documents retain the original branches-first, bars-second paint order.
export function barPaintLayers(doc) {
  const layers = new Map();
  for (const bar of doc.bars) {
    const order = barStackOrder(bar);
    if (!layers.has(order))
      layers.set(order, { order, bars: [], branches: [] });
    layers.get(order).bars.push(bar);
  }
  const bars = new Map(doc.bars.map((bar) => [bar.id, bar]));
  for (const branch of doc.branches ?? []) {
    const source = bars.get(branch.fromBarId);
    if (source) layers.get(barStackOrder(source)).branches.push(branch);
  }
  return [...layers.values()].sort((a, b) => a.order - b.order);
}
export function moveBarToEdge(doc, id, front) {
  const bar = doc.bars.find((b) => b.id === id),
    order = orderedBars(doc);
  if (!bar || (front ? order.at(-1) : order[0]) === bar) return false;
  const values = doc.bars.map(barStackOrder);
  let next =
    (front ? Math.max(...values) : Math.min(...values)) + (front ? 1 : -1);
  if (Math.abs(next) > MAX_STACK_ORDER) {
    const ranks = new Map(
      [...new Set(values)].sort((a, b) => a - b).map((v, i) => [v, i]),
    );
    for (const b of doc.bars) b.zIndex = ranks.get(barStackOrder(b));
    next = front ? ranks.size : -1;
  }
  bar.zIndex = next;
  return true;
}
