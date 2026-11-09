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
    const svg = parse(renderTimeline(doc, { zoom: 32 }));
    assert.equal(svg.querySelectorAll("g[font-family]").length, count);
    for (const txt of svg.querySelectorAll("g[font-family] text"))
      assert.notEqual(txt.textContent, "0");
  }
});
test("zoom reveals decade and annual ticks", () => {
  const a = parse(renderTimeline(sample, { zoom: 1 })).querySelectorAll(
    "g[font-family] line",
  ).length;
  const b = parse(renderTimeline(sample, { zoom: 32 })).querySelectorAll(
    "g[font-family] line",
  ).length;
  assert.ok(b > a * 10);
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
