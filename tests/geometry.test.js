import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  heightAt,
  barSectionAt,
  ribbonPath,
  branchRibbon,
  validHeightPeriods,
} from "../chronosmos/static/geometry.js";
import {
  renderTimeline,
  ordinal,
  xFor,
  wrappedLines,
  UNIT,
  PAD,
} from "../chronosmos/static/timeline.js";
import { textWidth } from "../chronosmos/static/text-layout.js";
const sample = JSON.parse(
  readFileSync(
    new URL("../examples/traditions.chronosmos.json", import.meta.url),
  ),
);
const fixture = () => {
  const doc = structuredClone(sample);
  doc.bars[0].heightPeriods = [
    { id: "p1", start: -100, end: 100, height: 72 },
    { id: "p2", start: 200, end: 300, height: 20 },
  ];
  return doc;
};
test("height changes use smooth cubic interpolation and persist after each period", () => {
  const doc = fixture(),
    bar = doc.bars[0];
  assert.equal(heightAt(bar, ordinal(-200)).height, 28);
  assert.equal(heightAt(bar, ordinal(-100)).height, 28);
  assert.equal(heightAt(bar, (ordinal(-100) + ordinal(100)) / 2).height, 50);
  assert.equal(heightAt(bar, ordinal(100)).height, 72);
  assert.equal(heightAt(bar, ordinal(150)).height, 72);
  assert.equal(heightAt(bar, ordinal(300)).height, 20);
  assert.equal(heightAt(bar, ordinal(100)).dh, 0);
  assert.equal(heightAt(bar, ordinal(200)).dh, 0);
  assert.equal(barSectionAt(doc, bar, 150).y, bar.y);
  assert.equal(validHeightPeriods(bar, bar.heightPeriods), true);
  assert.equal(
    validHeightPeriods(bar, [
      ...bar.heightPeriods,
      { id: "overlap", start: 1, end: 250, height: 40 },
    ]),
    false,
  );
});
test("height ribbons and captions use matching geometry at all horizontal zoom levels", () => {
  const doc = fixture(),
    bar = doc.bars[0];
  bar.captionYear = 150;
  for (const scale of [0.5, 1, 4]) {
    const svg = new JSDOM(
      renderTimeline(doc, { horizontalScale: scale, interactive: true }),
      { contentType: "image/svg+xml" },
    ).window.document;
    assert.match(
      svg.querySelector('[data-id="egypt"] path').getAttribute("d"),
      /C/,
    );
    assert.equal(
      Number(svg.querySelector('[data-id="egypt"] text').getAttribute("y")),
      bar.y + 36,
    );
    assert.equal(
      Number(svg.querySelector("#clip-egypt rect").getAttribute("height")),
      72,
    );
    const path = ribbonPath(
      doc,
      bar,
      (at) => PAD + (at - ordinal(doc.start)) * UNIT * scale,
    ).path;
    assert.ok(!path.includes("NaN"));
  }
});
test("branches attach to changing-height bars, including reverse and equal-year endpoints", () => {
  const doc = fixture();
  const source = doc.bars[0],
    target = doc.bars.find((b) => b.id === "jewish");
  const x = (at) => PAD + (at - ordinal(doc.start)) * UNIT;
  for (const [fromYear, toYear] of [
    [100, 200],
    [300, -300],
    [1, 1],
  ]) {
    const branch = {
      id: "b",
      fromBarId: source.id,
      toBarId: target.id,
      fromYear,
      toYear,
    };
    const ribbon = branchRibbon(doc, branch, x);
    assert.match(ribbon.path, /C/);
    assert.match(ribbon.path, /Z$/);
    assert.ok(!ribbon.path.includes("NaN"));
    assert.ok(
      ribbon.path.startsWith(
        `M${xFor(doc, fromYear)},${barSectionAt(doc, source, fromYear).y}`,
      ),
    );
    if (fromYear === toYear)
      assert.ok(ribbon.path.includes(String(x(ordinal(fromYear)) + 80)));
    doc.branches = [branch];
    const svg = new JSDOM(renderTimeline(doc, { interactive: true }), {
      contentType: "image/svg+xml",
    }).window.document;
    assert.ok(svg.querySelector('[data-id="b"] path'));
    assert.equal(
      svg.querySelector("#branch-b stop:last-child").getAttribute("stop-color"),
      target.background,
    );
  }
});
test("text wrapping uses available measured width and splits long words without discarding text", () => {
  const measure = (text) =>
    [...text].reduce((sum, c) => sum + (c === "i" ? 2 : c === " " ? 3 : 8), 0);
  const text = "iiii iiii WWWW WWWW";
  const lines = wrappedLines(text, 48, 14, measure);
  assert.equal(lines[0], "iiii iiii");
  assert.ok(lines.every((line) => measure(line) <= 48));
  const long = wrappedLines("abcdefghijk", 24, 14, measure);
  assert.equal(long.join(""), "abcdefghijk");
  assert.ok(long.every((line) => measure(line) <= 24));
  assert.deepEqual(wrappedLines("a\n\nb", 48, 14, measure), ["a", "", "b"]);
  assert.ok(textWidth("iiiiiiii", 14) < textWidth("WWWWWWWW", 14));
});
