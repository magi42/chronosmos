// Geometry uses continuous historical ordinals: -1 (1 BCE) is followed by 0 (1 CE).
const atYear = (year) => (year < 0 ? year : year - 1);
export function validHeightPeriods(bar, periods) {
  if (!Array.isArray(periods) || periods.length > 50) return false;
  let end = atYear(bar.start);
  for (const p of [...periods].sort(
    (a, b) => atYear(a.start) - atYear(b.start),
  )) {
    if (
      ![p.start, p.end].every((v) => Number.isInteger(v) && v !== 0) ||
      !Number.isFinite(p.height) ||
      p.height < 4 ||
      p.height > 160 ||
      atYear(p.start) < end ||
      atYear(p.start) >= atYear(p.end) ||
      atYear(p.end) > atYear(bar.end)
    )
      return false;
    end = atYear(p.end);
  }
  return true;
}
export function heightAt(bar, at) {
  let height = bar.height;
  for (const p of [...(bar.heightPeriods ?? [])].sort(
    (a, b) => atYear(a.start) - atYear(b.start),
  )) {
    const start = atYear(p.start),
      end = atYear(p.end);
    if (at < start) break;
    if (at < end) {
      const t = (at - start) / (end - start);
      return {
        height: height + (p.height - height) * t * t * (3 - 2 * t),
        dh: ((p.height - height) * 6 * t * (1 - t)) / (end - start) || 0,
      };
    }
    height = p.height;
  }
  return { height, dh: 0 };
}
function baseSectionAt(d, bar, at, seen = new Set()) {
  const base = heightAt(bar, at);
  const factor = { top: 0, center: 0.5, bottom: 1 }[
    bar.heightAlignment ?? "center"
  ];
  const own = {
    y: bar.y + factor * (bar.height - base.height),
    height: base.height,
    dy: -factor * base.dh,
    dh: base.dh,
  };
  const target = d.bars.find((b) => b.id === bar.mergeInto);
  const duration = target
    ? Math.min(bar.mergeYears, atYear(bar.end) - atYear(bar.start))
    : 0;
  const progress = duration
    ? (at - (atYear(bar.end) - duration)) / duration
    : 0;
  if (!target || progress <= 0 || seen.has(bar.id)) return own;
  const visited = new Set(seen);
  visited.add(bar.id);
  const to = sectionAt(d, target, atYear(bar.end), visited);
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 40; i++) {
    const t = (lo + hi) / 2;
    if (1.5 * t - 1.5 * t * t + t * t * t < Math.min(1, progress)) lo = t;
    else hi = t;
  }
  const t = (lo + hi) / 2,
    blend = t * t * (3 - 2 * t);
  const derivative = (6 * t * (1 - t)) / (duration * (1.5 - 3 * t + 3 * t * t));
  return {
    y: own.y + (to.y - own.y) * blend,
    height: base.height + (to.height - base.height) * blend,
    dy: own.dy * (1 - blend) + (to.y - own.y) * derivative,
    dh: base.dh * (1 - blend) + (to.height - base.height) * derivative,
  };
}
// A joined pair shares a seam; each ribbon contributes half of its own height.
export function joinedPeriodAt(d, barId, at) {
  return (d.joinedPeriods ?? []).find(
    (p) =>
      (p.fromBarId === barId || p.toBarId === barId) &&
      at > atYear(p.start) &&
      at < atYear(p.end),
  );
}
export function sectionAt(d, bar, at, seen = new Set()) {
  const own = baseSectionAt(d, bar, at, seen);
  const join = joinedPeriodAt(d, bar.id, at);
  if (!join || seen.has(bar.id)) return own;
  const other = d.bars.find(
    (b) => b.id === (join.fromBarId === bar.id ? join.toBarId : join.fromBarId),
  );
  if (!other) return own;
  const visited = new Set(seen);
  visited.add(bar.id);
  visited.add(other.id);
  const peer = baseSectionAt(d, other, at, visited);
  const duration = join.transitionYears;
  const incoming = at - atYear(join.start),
    outgoing = atYear(join.end) - at;
  const t = Math.max(0, Math.min(1, Math.min(incoming, outgoing) / duration));
  const w = t * t * (3 - 2 * t),
    dw =
      t < 1
        ? ((6 * t * (1 - t)) / duration) * (incoming < outgoing ? 1 : -1)
        : 0;
  // Keep ordering stable even when height-alignment or end merges change y.
  const upper = bar.y < other.y || (bar.y === other.y && bar.id < other.id);
  const seam = (own.y + own.height / 2 + peer.y + peer.height / 2) / 2;
  const ds = (own.dy + own.dh / 2 + peer.dy + peer.dh / 2) / 2;
  const targetY = seam - (upper ? own.height / 2 : 0);
  const targetDy = ds - (upper ? own.dh / 2 : 0);
  return {
    y: own.y + (targetY - own.y) * w,
    dy: own.dy * (1 - w) + targetDy * w + (targetY - own.y) * dw,
    height: own.height * (1 - w / 2),
    dh: own.dh * (1 - w / 2) - (own.height * dw) / 2,
  };
}
export function validJoinedPeriods(d) {
  const occupied = new Map();
  return (d.joinedPeriods ?? []).every((p) => {
    const a = atYear(p.start),
      z = atYear(p.end);
    if (
      ![p.start, p.end].every((v) => Number.isInteger(v) && v !== 0) ||
      a >= z ||
      !Number.isFinite(p.transitionYears) ||
      p.transitionYears < 0.01 ||
      p.transitionYears > (z - a) / 2 ||
      p.fromBarId === p.toBarId
    )
      return false;
    return [p.fromBarId, p.toBarId].every((id) => {
      const b = d.bars.find((b) => b.id === id),
        spans = occupied.get(id) ?? [];
      if (
        !b ||
        a < atYear(b.start) ||
        z > atYear(b.end) ||
        (b.mergeInto && z > atYear(b.end) - b.mergeYears) ||
        spans.some(([s, e]) => a < e && z > s)
      )
        return false;
      occupied.set(id, [...spans, [a, z]]);
      return true;
    });
  });
}
export function barSectionAt(d, bar, year) {
  return sectionAt(d, bar, atYear(year));
}
export function ribbonPath(d, bar, x) {
  const start = atYear(bar.start),
    end = atYear(bar.end);
  const target = d.bars.find((b) => b.id === bar.mergeInto);
  const merge = target ? Math.min(bar.mergeYears, end - start) : 0;
  const knots = new Set([start, end]);
  for (const p of bar.heightPeriods ?? []) {
    knots.add(atYear(p.start));
    knots.add(atYear(p.end));
  }
  if (merge) knots.add(end - merge);
  const joins = (d.joinedPeriods ?? []).filter(
    (p) => p.fromBarId === bar.id || p.toBarId === bar.id,
  );
  for (const p of joins) {
    for (const at of [
      atYear(p.start),
      atYear(p.start) + p.transitionYears,
      atYear(p.end) - p.transitionYears,
      atYear(p.end),
    ])
      knots.add(at);
    const peer = d.bars.find(
      (b) => b.id === (p.fromBarId === bar.id ? p.toBarId : p.fromBarId),
    );
    for (const h of peer?.heightPeriods ?? []) {
      knots.add(atYear(h.start));
      knots.add(atYear(h.end));
    }
  }
  const ordered = [...knots]
    .filter((v) => v >= start && v <= end)
    .sort((a, b) => a - b);
  // Exact cubics for height-only intervals; subdivided Hermite cubics keep merged
  // height changes continuous in position and tangent at every interval boundary.
  const points = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const count =
      joins.length || (merge && ordered[i + 1] > end - merge) ? 8 : 1;
    for (let j = 0; j < count; j++)
      points.push(ordered[i] + ((ordered[i + 1] - ordered[i]) * j) / count);
  }
  points.push(end);
  const samples = points.map((at) => ({
    at,
    x: x(at),
    ...sectionAt(d, bar, at),
  }));
  const commands = (list, bottom) =>
    list
      .slice(1)
      .map((b, i) => {
        const a = list[i],
          span = (b.at - a.at) / 3;
        return `C${a.x + (b.x - a.x) / 3},${a.y + (bottom ? a.height : 0) + (a.dy + (bottom ? a.dh : 0)) * span} ${b.x - (b.x - a.x) / 3},${b.y + (bottom ? b.height : 0) - (b.dy + (bottom ? b.dh : 0)) * span} ${b.x},${b.y + (bottom ? b.height : 0)}`;
      })
      .join(" ");
  // Preserve the original exact merge spline for bars without height changes.
  let path;
  if (!bar.heightPeriods?.length && !joins.length) {
    const a = x(start),
      z = x(end),
      m = x(end - merge),
      to = target ? sectionAt(d, target, end) : sectionAt(d, bar, end);
    path = `M${a},${bar.y} H${m}`;
    if (target) {
      const c = (m + z) / 2;
      path += ` C${c},${bar.y} ${c},${to.y} ${z},${to.y} L${z},${to.y + to.height} C${c},${to.y + to.height} ${c},${bar.y + bar.height} ${m},${bar.y + bar.height}`;
    } else path += ` V${bar.y + bar.height}`;
    path += ` H${a} Z`;
  } else {
    const a = samples[0],
      z = samples.at(-1);
    path = `M${a.x},${a.y} ${commands(samples, false)} L${z.x},${z.y + z.height} ${commands([...samples].reverse(), true)} Z`;
  }
  return {
    path,
    top: Math.min(...samples.map((s) => s.y)),
    bottom: Math.max(...samples.map((s) => s.y + s.height)),
  };
}
export function branchRibbon(
  d,
  branch,
  x,
  horizontalScale = 1,
  includePath = true,
) {
  const from = d.bars.find((b) => b.id === branch.fromBarId),
    to = d.bars.find((b) => b.id === branch.toBarId);
  if (!from || !to) return null;
  const a = barSectionAt(d, from, branch.fromYear),
    b = barSectionAt(d, to, branch.toYear);
  const ax = x(atYear(branch.fromYear)),
    bx = x(atYear(branch.toYear));
  const startX = x(atYear(d.start)),
    endX = x(atYear(d.end));
  const bend = Math.min(
    80 * horizontalScale,
    Math.max(16, (endX - startX) / 2),
  );
  const c =
    ax === bx ? ax + (ax > (startX + endX) / 2 ? -bend : bend) : (ax + bx) / 2;
  const ay = a.y + a.height / 2,
    by = b.y + b.height / 2;
  const direction = Math.sign(c - ax) || Math.sign(bx - ax) || 1;
  const point = (t) => {
    const u = 1 - t;
    const xx =
      u * u * u * ax + 3 * u * u * t * c + 3 * u * t * t * c + t * t * t * bx;
    const yy = ay + (by - ay) * t * t * (3 - 2 * t);
    const dx = 3 * u * u * (c - ax) + 3 * t * t * (bx - c);
    const dy = 6 * t * u * (by - ay);
    const speed = Math.hypot(dx, dy);
    const height = a.height + (b.height - a.height) * t * t * (3 - 2 * t);
    const nx = speed ? (-direction * dy) / speed : 0;
    const ny = speed ? (direction * dx) / speed : 1;
    return {
      x: xx,
      y: yy,
      height,
      upper: { x: xx - (nx * height) / 2, y: yy - (ny * height) / 2 },
      lower: { x: xx + (nx * height) / 2, y: yy + (ny * height) / 2 },
    };
  };
  const samples = Array.from({ length: 65 }, (_, i) => point(i / 64));
  // Cubic outlines of a ribbon measured perpendicular to its center curve.
  // Equal endpoint heights stay constant through steep bends; unequal heights
  // use the same smoothstep interpolation as bar height periods.
  const edge = (side, reverse = false) => {
    const list = (reverse ? [...samples].reverse() : samples).map(
      (s) => s[side],
    );
    return list
      .slice(1)
      .map((b, i) => {
        const a = list[i],
          prev = list[Math.max(0, i - 1)],
          next = list[Math.min(list.length - 1, i + 2)];
        const ax = i === 0 ? (b.x - a.x) / 3 : (b.x - prev.x) / 6;
        const ay = i === 0 ? 0 : (b.y - prev.y) / 6;
        const bx = i + 2 >= list.length ? (b.x - a.x) / 3 : (next.x - a.x) / 6;
        const by = i + 2 >= list.length ? 0 : (next.y - a.y) / 6;
        return `C${a.x + ax},${a.y + ay} ${b.x - bx},${b.y - by} ${b.x},${b.y}`;
      })
      .join(" ");
  };
  let path = !includePath
    ? ""
    : `M${samples[0].upper.x},${samples[0].upper.y} ${edge("upper")} L${samples.at(-1).lower.x},${samples.at(-1).lower.y} ${edge("lower", true)} Z`;
  if (includePath && ax === bx && ay === by) {
    // Coincident centers form a flat loop, avoiding a zero tangent normal.
    path = `M${ax},${a.y} C${c},${a.y} ${c},${b.y} ${bx},${b.y} L${bx},${b.y + b.height} C${c},${b.y + b.height} ${c},${a.y + a.height} ${ax},${a.y + a.height} Z`;
  }
  return {
    minX: Math.min(...samples.flatMap((s) => [s.upper.x, s.lower.x])),
    maxX: Math.max(...samples.flatMap((s) => [s.upper.x, s.lower.x])),
    path,
    ax,
    bx,
    from,
    to,
    samples,
    top: Math.min(...samples.flatMap((s) => [s.upper.y, s.lower.y])),
    bottom: Math.max(...samples.flatMap((s) => [s.upper.y, s.lower.y])),
  };
}

// Fixed-width curls and stretchable straight arms avoid distorting a font glyph.
export function bracePath(width, height) {
  const arm = width / 2,
    curl = Math.min(18, height / 4),
    mid = height / 2;
  return `M0,0 C${arm},0 ${arm},${curl / 2} ${arm},${curl} L${arm},${mid - curl} C${arm},${mid - curl / 2} ${arm},${mid} ${width},${mid} C${arm},${mid} ${arm},${mid + curl / 2} ${arm},${mid + curl} L${arm},${height - curl} C${arm},${height - curl / 2} ${arm},${height} 0,${height}`;
}
