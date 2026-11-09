import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  ordinal,
  historical,
  dimensions,
  xFor,
  renderTimeline,
  wrappedLines,
  overlayPosition,
  barSectionAt,
} from "../chronosmos/static/timeline.js";
const sample = JSON.parse(
  readFileSync(
    new URL("../examples/traditions.chronosmos.json", import.meta.url),
  ),
);
const parse = (svg) =>
  new JSDOM(svg, { contentType: "image/svg+xml" }).window.document;

test("historical years have no gap or year zero", () => {
  assert.equal(ordinal(1) - ordinal(-1), 1);
  assert.throws(() => ordinal(0));
  for (const y of [-1000, -2, -1, 1, 2, 2026])
    assert.equal(historical(ordinal(y)), y);
  assert.ok(Math.abs(xFor(sample, 1) - xFor(sample, -1) - 0.45) < 1e-10);
});
test("SVG physical scale is exactly millimeters per historical year", () => {
  const dim = dimensions(sample),
    svg = parse(renderTimeline(sample)).documentElement;
  assert.equal(Number.parseFloat(svg.getAttribute("width")), dim.widthMm);
  assert.equal(
    ((xFor(sample, 101) - xFor(sample, 1)) / dim.width) * dim.widthMm,
    100 * sample.mmPerYear,
  );
});
test("merges are closed cubic ribbons with target-color gradient endpoints", () => {
  const svg = parse(renderTimeline(sample, { interactive: true }));
  const roman = svg.querySelector('[data-id="roman"] path');
  assert.match(roman.getAttribute("d"), /C/);
  assert.match(roman.getAttribute("d"), /Z$/);
  assert.equal(
    svg.querySelector("#grad-roman stop:last-child").getAttribute("stop-color"),
    sample.bars.find((b) => b.id === "christian").background,
  );
});
test("fades start and end with the timeline background", () => {
  const svg = parse(renderTimeline(sample));
  assert.equal(
    svg
      .querySelector("#grad-mithra stop:first-child")
      .getAttribute("stop-color"),
    sample.background,
  );
  assert.equal(
    svg
      .querySelector("#grad-mithra stop:last-child")
      .getAttribute("stop-color"),
    sample.background,
  );
});
test("text and descriptions are XML escaped and never executable", () => {
  const doc = structuredClone(sample);
  doc.title = '<script>alert("x")</script>';
  doc.overlays[0].text = 'Text <img onerror="x"> & more';
  const svg = parse(renderTimeline(doc, { interactive: true }));
  assert.equal(svg.querySelectorAll("script").length, 0);
  assert.equal(svg.querySelector("title").textContent, doc.title);
  assert.match(svg.documentElement.textContent, /<img onerror="x">/);
});
test("timescale supports top, bottom, both and none, with no zero", () => {
  const counts = { top: 1, bottom: 1, both: 2, none: 0 };
  for (const [scale, count] of Object.entries(counts)) {
    const doc = { ...sample, scale, start: -2, end: 2 };
    const svg = parse(renderTimeline(doc, { horizontalScale: 32 }));
    assert.equal(svg.querySelectorAll("g[font-family]").length, count);
    for (const txt of svg.querySelectorAll("g[font-family] text"))
      assert.notEqual(txt.textContent, "0");
  }
});
test("zoom reveals decade and annual ticks", () => {
  const a = parse(
    renderTimeline(sample, { horizontalScale: 1 }),
  ).querySelectorAll("g[font-family] line").length;
  const b = parse(
    renderTimeline(sample, { horizontalScale: 32 }),
  ).querySelectorAll("g[font-family] line").length;
  assert.ok(b > a * 10);
});
test("horizontal zoom expands dates while preserving vertical geometry and content sizes", () => {
  const doc = structuredClone(sample);
  doc.overlays.push({
    ...doc.overlays[0],
    id: "image",
    type: "image",
    mediaId: "a".repeat(32),
  });
  const base = parse(renderTimeline(doc, { interactive: true }));
  const zoomed = parse(
    renderTimeline(doc, { interactive: true, horizontalScale: 2 }),
  );
  const line = '[data-id="event2"] line';
  assert.equal(
    Number(zoomed.querySelector(line).getAttribute("x1")) - 64,
    (Number(base.querySelector(line).getAttribute("x1")) - 64) * 2,
  );
  for (const selector of [
    "#clip-roman rect",
    '[data-id="note2"] rect',
    '[data-id="image"] image',
  ]) {
    for (const attribute of ["y", "height"]) {
      assert.equal(
        zoomed.querySelector(selector).getAttribute(attribute),
        base.querySelector(selector).getAttribute(attribute),
      );
    }
  }
  assert.equal(
    zoomed.querySelector('[data-id="image"] image').getAttribute("width"),
    base.querySelector('[data-id="image"] image').getAttribute("width"),
  );
  assert.equal(
    zoomed.querySelector('[data-id="roman"] text').getAttribute("font-size"),
    base.querySelector('[data-id="roman"] text').getAttribute("font-size"),
  );
  assert.equal(
    zoomed.documentElement.getAttribute("viewBox").split(" ")[3],
    String(doc.height),
  );
  assert.equal(
    zoomed.querySelector("#grad-egypt").innerHTML,
    base.querySelector("#grad-egypt").innerHTML,
  );
  assert.equal(
    Number(zoomed.querySelector("#clip-roman rect").getAttribute("width")),
    Number(base.querySelector("#clip-roman rect").getAttribute("width")) * 2,
  );
});
test("event lines preserve order relative to bars", () => {
  const doc = structuredClone(sample);
  doc.events[1].layer = "over";
  const svg = parse(renderTimeline(doc, { interactive: true }));
  const elements = [...svg.querySelectorAll("[data-id]")].map(
    (e) => e.dataset.id,
  );
  assert.ok(elements.indexOf("event1") < elements.indexOf("egypt"));
  assert.ok(elements.indexOf("event2") > elements.indexOf("islam"));
});
test("image, box and wrapped text overlays retain editable positions", () => {
  const doc = structuredClone(sample);
  doc.overlays.push({
    ...doc.overlays[0],
    id: "img",
    type: "image",
    mediaId: "a".repeat(32),
  });
  const svg = parse(renderTimeline(doc, { interactive: true }));
  assert.equal(
    svg.querySelector('[data-id="img"] image').getAttribute("href"),
    "/media/" + "a".repeat(32) + ".png",
  );
  assert.ok(svg.querySelector('[data-id="note2"] rect'));
  assert.deepEqual(wrappedLines("one two three\nfour", 45, 14), [
    "one",
    "two",
    "three",
    "four",
  ]);
});

test("captions can move to a year without moving their bar or scaling vertically", () => {
  const doc = structuredClone(sample);
  doc.bars[0].captionYear = 1;
  for (const horizontalScale of [0.5, 1, 3]) {
    const svg = parse(
      renderTimeline(doc, { interactive: true, horizontalScale }),
    );
    const text = svg.querySelector('[data-id="egypt"] [data-caption]');
    assert.equal(
      Number(text.getAttribute("x")),
      xFor(doc, 1, horizontalScale) + 10,
    );
    assert.equal(
      Number(text.getAttribute("y")),
      doc.bars[0].y + doc.bars[0].height / 2,
    );
    assert.equal(
      svg.querySelector("#clip-egypt rect").getAttribute("x"),
      String(xFor(doc, doc.bars[0].start, horizontalScale)),
    );
  }
});

test("anchored text, boxes and illustrations follow bar positions in views and exports", () => {
  const doc = structuredClone(sample);
  const bar = doc.bars.find((b) => b.id === "jewish");
  for (const [i, type] of ["text", "box", "image"].entries()) {
    const overlay = {
      ...doc.overlays[0],
      id: "anchor-" + type,
      type,
      year: i === 0 ? -1 : 1,
      anchorBarId: bar.id,
      offsetY: -40 + i * 30,
      mediaId: "a".repeat(32),
    };
    doc.overlays.push(overlay);
    const before = overlayPosition(doc, overlay);
    bar.y += 20;
    assert.equal(overlayPosition(doc, overlay).y, before.y + 20);
    for (const horizontalScale of [1, 4]) {
      const svg = parse(
        renderTimeline(doc, { interactive: true, horizontalScale }),
      );
      const group = svg.querySelector('[data-id="' + overlay.id + '"]');
      const graphic = group.querySelector(
        type === "image" ? "image" : type === "box" ? "rect[rx]" : "text",
      );
      assert.equal(
        Number(graphic.getAttribute("y")),
        bar.y + overlay.offsetY + (type === "text" ? overlay.fontSize : 0),
      );
      assert.equal(
        Number(graphic.getAttribute("x")),
        xFor(doc, overlay.year, horizontalScale),
      );
    }
  }
  const exported = parse(renderTimeline(doc));
  assert.ok(!exported.querySelector("[data-caption]"));
  const image = exported.querySelector("image");
  assert.equal(
    Number(image.getAttribute("y")),
    overlayPosition(doc, doc.overlays.at(-1)).y,
  );
});

test("anchors follow the same cubic merge ribbon as the displayed time bar", () => {
  const doc = structuredClone(sample);
  const bar = doc.bars.find((b) => b.id === "greek");
  assert.equal(barSectionAt(doc, bar, -400).y, bar.y);
  assert.ok(
    Math.abs(
      barSectionAt(doc, bar, -200).y -
        (bar.y + doc.bars.find((b) => b.id === "roman").y) / 2,
    ) < 1e-6,
  );
  const overlay = {
    ...doc.overlays[0],
    anchorBarId: bar.id,
    year: -200,
    offsetY: -25,
  };
  assert.ok(Math.abs(overlayPosition(doc, overlay).y - 217.5) < 1e-6);
});
