import { textFor } from "./content.js";
import { barSectionAt, ribbonPath, branchRibbon } from "./geometry.js";
import { wrappedLines } from "./text-layout.js";
export { barSectionAt, wrappedLines };
export const UNIT = 0.45,
  PAD = 64;
export const MAX_YEAR = 1e12;
// Keep geological timelines in a practical SVG coordinate range.
export function pixelsPerYear(d) {
  const span = ordinal(d.end) - ordinal(d.start);
  return UNIT / 10 ** Math.max(0, Math.floor(Math.log10(span)) - 3);
}
export const timeUnitFactor = (unit) =>
  ({ thousands: 1000, millions: 1e6 })[unit] ?? 1;
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function ordinal(year) {
  if (!Number.isInteger(year) || year === 0) throw new Error("No year zero");
  return year < 0 ? year : year - 1;
}
export function historical(value) {
  const n = Math.round(value);
  return n < 0 ? n : n + 1;
}
export function dimensions(d, horizontalScale = 1) {
  const width =
    (ordinal(d.end) - ordinal(d.start)) * pixelsPerYear(d) * horizontalScale +
    PAD * 2;
  return {
    width,
    height: d.height,
    widthMm: (width / pixelsPerYear(d)) * d.mmPerYear,
    heightMm: (d.height / pixelsPerYear(d)) * d.mmPerYear,
  };
}
export const xFor = (d, y, horizontalScale = 1) =>
  PAD + (ordinal(y) - ordinal(d.start)) * pixelsPerYear(d) * horizontalScale;
export function clampYearToBar(bar, year) {
  return historical(
    Math.max(ordinal(bar.start), Math.min(ordinal(bar.end), ordinal(year))),
  );
}
export function overlayPosition(d, overlay) {
  const bar = d.bars.find((b) => b.id === overlay.anchorBarId);
  return {
    year: overlay.year,
    y: bar
      ? barSectionAt(d, bar, overlay.year).y + (overlay.offsetY ?? 0)
      : overlay.y,
  };
}
export function yearLabel(y, lang = "en", unit = "auto") {
  const magnitude = Math.abs(y);
  const selected =
    unit === "auto" ? (magnitude >= 1e6 ? "millions" : "years") : unit;
  const factor = magnitude === 1 ? 1 : timeUnitFactor(selected);
  const number = String(Number((magnitude / factor).toPrecision(10)));
  const suffix =
    factor === 1e6
      ? lang === "fi"
        ? " milj."
        : " M"
      : factor === 1000
        ? lang === "fi"
          ? " tuhatta"
          : " k"
        : "";
  return number + suffix + (y < 0 ? ` ${lang === "fi" ? "eaa." : "BCE"}` : "");
}
export const axisY = (d, axis) => (axis === "top" ? 55 : d.height - 50);
export function eventEndpointY(d, event, side) {
  const axis = event[side + "Axis"];
  if (axis) return axisY(d, axis);
  const bar = d.bars.find((b) => b.id === event[side + "BarId"]);
  if (bar) {
    const section = barSectionAt(d, bar, event.year);
    return (
      section.y +
      section.height *
        { top: 0, center: 0.5, bottom: 1 }[event[side + "Edge"] ?? "center"]
    );
  }
  return (
    event[side + "Y"] ?? (side === "start" ? event.y : event.y + event.height)
  );
}
export const eventStartY = (d, event) => eventEndpointY(d, event, "start");
export const eventEndY = (d, event) => eventEndpointY(d, event, "end");
export function eventYearRange(d, event) {
  const bars = d.bars.filter(
    (b) => b.id === event.startBarId || b.id === event.endBarId,
  );
  return {
    start: Math.max(-MAX_YEAR, ...bars.map((b) => ordinal(b.start))),
    end: Math.min(MAX_YEAR - 1, ...bars.map((b) => ordinal(b.end))),
  };
}
const niceInterval = (desired) => {
  const power = 10 ** Math.floor(Math.log10(Math.max(1, desired)));
  return [1, 2, 5, 10].find((n) => n * power >= desired) * power;
};
function intervalYears(d, interval, boundaries = false, minimumYears = 1) {
  // Bound both automatic and authored intervals on geological timelines.
  const stride = Math.max(
    1,
    Math.ceil((ordinal(d.end) - ordinal(d.start)) / interval / 12000),
    Math.ceil(minimumYears / interval),
  );
  const step = interval * stride;
  const years = new Set(boundaries ? [d.start, d.end] : []);
  if (d.start <= 1 && d.end >= 1) years.add(1);
  for (let year = Math.ceil(d.start / step) * step; year <= d.end; year += step)
    if (year !== 0) years.add(year);
  return [...years].sort((a, b) => a - b);
}
export function axisTicks(d, horizontalScale = 1, pixelScale = 1) {
  const unit = pixelsPerYear(d) * horizontalScale * pixelScale;
  const span = ordinal(d.end) - ordinal(d.start);
  const minor =
    d.minorTickInterval || niceInterval(Math.max(1, 6 / unit, span / 12000));
  const major =
    d.labelInterval || niceInterval(Math.max(1, 75 / unit, span / 12000));
  return {
    minor: intervalYears(d, minor, true, 6 / unit),
    major: intervalYears(d, major, !d.labelInterval, 12 / unit),
  };
}
export function renderTimeline(
  d,
  {
    selected = null,
    language = "en",
    interactive = false,
    viewing = false,
    horizontalScale = 1,
    pixelScale = 1,
  } = {},
) {
  const { width, height, widthMm, heightMm } = dimensions(d, horizontalScale),
    x = (y) => xFor(d, y, horizontalScale),
    xOrdinal = (at) =>
      PAD + (at - ordinal(d.start)) * pixelsPerYear(d) * horizontalScale,
    defs = [];
  const select = (kind, o) =>
    interactive
      ? ` data-kind="${kind}" data-id="${esc(o.id)}" tabindex="0" role="button" aria-label="${esc(textFor(o, "label", language) || textFor(o, "text", language) || o.type || "Element")}"`
      : "";
  const outline = (kind, o, xx, yy, w, h) =>
    selected?.kind === kind && selected.id === o.id
      ? `<rect x="${xx - 4}" y="${yy - 4}" width="${Math.max(w + 8, 12)}" height="${h + 8}" fill="none" stroke="#315d50" stroke-width="1.5" stroke-dasharray="5 3" pointer-events="none"/>`
      : "";
  const ticks = axisTicks(d, horizontalScale, pixelScale);
  const majorYears = new Set(ticks.major);
  function ruler(y, bottom) {
    let out = `<g class="time-axis ${bottom ? "bottom-axis" : "top-axis"}" fill="#69685f" stroke="#c4c0b4" font-family="Arial, sans-serif" font-size="11"><line class="axis-line" x1="${PAD}" x2="${width - PAD}" y1="${y}" y2="${y}"/>`;
    const years = [...new Set([...ticks.minor, ...ticks.major])].sort(
      (a, b) => a - b,
    );
    let lastLabel = -Infinity;
    for (const year of years) {
      const xx = x(year),
        major = majorYears.has(year);
      const len = major ? 11 : year % 10 === 0 ? 8 : 4;
      out += `<line class="${major ? "major-tick" : "minor-tick"}" data-year="${year}" x1="${xx}" x2="${xx}" y1="${y}" y2="${y + (bottom ? -len : len)}"/>`;
      if (major && (xx - lastLabel >= 75 / pixelScale || year === 1)) {
        out += `<text data-year="${year}" x="${xx}" y="${y + (bottom ? 23 : -15)}" text-anchor="middle" stroke="none">${esc(yearLabel(year, language, d.timeUnit))}</text>`;
        lastLabel = xx;
      }
    }
    return out + "</g>";
  }
  function event(e) {
    const xx = x(e.year),
      start = eventStartY(d, e),
      end = eventEndY(d, e),
      labelY = e.startAxis === "top" ? start + 26 : start - 9;
    return `<g${select("events", e)} style="${interactive ? "cursor:move" : ""}"><line x1="${xx}" x2="${xx}" y1="${start}" y2="${end}" stroke="${e.color}" stroke-width="${e.width}"/>${interactive ? `<line x1="${xx}" x2="${xx}" y1="${start}" y2="${end}" stroke="transparent" stroke-width="12"/>` : ""}<text x="${xx + 7}" y="${labelY}" fill="${e.color}" font-size="11">${esc(textFor(e, "label", language))}</text>${outline("events", e, xx, Math.min(start, end), 1, Math.abs(end - start))}</g>`;
  }
  let content = `<rect width="${width}" height="${height}" fill="${d.background}"/>`;
  if (d.majorGrid) {
    const top = axisY(d, "top"),
      bottom = axisY(d, "bottom");
    content += `<g class="major-grid" stroke="#d8d5ca" stroke-width="0.75" aria-hidden="true">${ticks.major.map((year) => `<g data-year="${year}"><line class="major-grid-line" x1="${x(year)}" x2="${x(year)}" y1="${top}" y2="${bottom}"/><line x1="${x(year)}" x2="${x(year)}" y1="${top - 8}" y2="${top}"/><line x1="${x(year)}" x2="${x(year)}" y1="${bottom}" y2="${bottom + 8}"/></g>`).join("")}</g>`;
  }
  content += d.events
    .filter((e) => e.layer === "under")
    .map(event)
    .join("");
  for (const branch of d.branches ?? []) {
    const ribbon = branchRibbon(d, branch, xOrdinal, horizontalScale);
    if (!ribbon) continue;
    const id = "branch-" + branch.id;
    const a = barSectionAt(d, ribbon.from, branch.fromYear),
      b = barSectionAt(d, ribbon.to, branch.toYear);
    defs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${ribbon.ax}" x2="${ribbon.bx}" y1="${a.y}" y2="${b.y}"><stop offset="0%" stop-color="${ribbon.from.background}"/><stop offset="100%" stop-color="${ribbon.to.background}"/></linearGradient>`,
    );
    content += `<g${select("branches", { ...branch, label: textFor(ribbon.from, "label", language) + " → " + textFor(ribbon.to, "label", language) })}><path d="${ribbon.path}" fill="url(#${id})"/>${outline("branches", branch, Math.min(ribbon.ax, ribbon.bx), ribbon.top, Math.abs(ribbon.bx - ribbon.ax), ribbon.bottom - ribbon.top)}</g>`;
  }
  for (const b of d.bars) {
    const a = x(b.start),
      z = x(b.end),
      len = z - a,
      target = d.bars.find((t) => t.id === b.mergeInto),
      merge = target
        ? Math.min(b.mergeYears * pixelsPerYear(d) * horizontalScale, len)
        : 0,
      m = z - merge;
    const fi =
        Math.min(b.fadeIn * pixelsPerYear(d) * horizontalScale, len) / len,
      fo = Math.min(b.fadeOut * pixelsPerYear(d) * horizontalScale, len) / len,
      stops = [];
    if (fi > 0)
      stops.push(
        [0, d.background],
        [Math.min(fi, target ? 1 - merge / len : 1), b.background],
      );
    else stops.push([0, b.background]);
    if (target)
      stops.push(
        [Math.max(fi, 1 - merge / len), b.background],
        [1, target.background],
      );
    else if (fo > 0)
      stops.push([Math.max(fi, 1 - fo), b.background], [1, d.background]);
    else stops.push([1, b.background]);
    const grad = "grad-" + b.id,
      clip = "clip-" + b.id;
    const ribbon = ribbonPath(d, b, xOrdinal);
    defs.push(
      `<linearGradient id="${grad}" gradientUnits="userSpaceOnUse" x1="${a}" x2="${z}" y1="0" y2="0">${stops.map(([p, c]) => `<stop offset="${p * 100}%" stop-color="${c}"/>`).join("")}</linearGradient><clipPath id="${clip}"><rect x="${a}" y="${ribbon.top}" width="${len}" height="${ribbon.bottom - ribbon.top}"/></clipPath>`,
    );
    const path = ribbon.path;
    const captionYear = b.captionYear ?? b.start;
    const caption = barSectionAt(d, b, captionYear);
    content += `<g${select("bars", b)} style="${interactive ? "cursor:move" : ""}"><path d="${path}" fill="url(#${grad})"/><text ${interactive ? 'data-caption="true" style="cursor:ew-resize"' : ""} x="${x(captionYear) + 10}" y="${caption.y + caption.height / 2}" dominant-baseline="central" fill="${b.foreground}" font-size="${Math.min(14, b.height * 0.65)}" clip-path="url(#${clip})">${esc(textFor(b, "label", language))}</text>${outline("bars", b, a, ribbon.top, len, ribbon.bottom - ribbon.top)}</g>`;
  }
  for (const stored of d.overlays) {
    const o = {
      ...stored,
      ...overlayPosition(d, stored),
      text: textFor(stored, "text", language),
    };
    const xx = x(o.year);
    let body = "";
    if (o.type === "image")
      body = `<image href="/media/${esc(o.mediaId)}.png" x="${xx}" y="${o.y}" width="${o.width}" height="${o.height}" preserveAspectRatio="xMidYMid meet"/>`;
    else {
      if (o.type === "box")
        body = `<rect x="${xx}" y="${o.y}" width="${o.width}" height="${o.height}" fill="${o.fill}" rx="3"/>`;
      const inset = o.type === "box" ? 8 : 0;
      body += `<text x="${xx + inset}" y="${o.y + o.fontSize + inset}" fill="${o.color}" font-size="${o.fontSize}">${wrappedLines(
        o.text,
        o.width - inset * 2,
        o.fontSize,
      )
        .map(
          (l, i) =>
            `<tspan x="${xx + inset}" dy="${i ? o.fontSize * 1.4 : 0}">${esc(l)}</tspan>`,
        )
        .join("")}</text>`;
    }
    const viewAttributes = viewing
      ? ` data-view-id="${esc(o.id)}" tabindex="0" role="button" aria-label="${esc(textFor(o, "text", language) || o.type)}"`
      : "";
    content += `<g${select("overlays", o)}${viewAttributes} style="${interactive ? "cursor:move" : viewing ? "cursor:zoom-in" : ""}">${interactive || viewing ? `<rect x="${xx}" y="${o.y}" width="${o.width}" height="${o.height}" fill="transparent"/>` : ""}${body}${outline("overlays", o, xx, o.y, o.width, o.height)}</g>`;
  }
  content += d.events
    .filter((e) => e.layer === "over")
    .map(event)
    .join("");
  if (d.scale === "top" || d.scale === "both")
    content += ruler(axisY(d, "top"), false);
  if (d.scale === "bottom" || d.scale === "both")
    content += ruler(axisY(d, "bottom"), true);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(textFor(d, "title", language))}" font-family="Arial, sans-serif"><title>${esc(textFor(d, "title", language))}</title><desc>${esc(textFor(d, "description", language))}</desc><defs>${defs.join("")}</defs>${content}</svg>`;
}
