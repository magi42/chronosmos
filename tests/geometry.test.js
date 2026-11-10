import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  heightAt,
  sectionAt,
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
  doc.bars[0].heightAlignment = "top";
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
      assert.ok(
        Math.max(...ribbon.samples.map((s) => s.x)) > x(ordinal(fromYear)) + 50,
      );
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
  const edge = branchRibbon(
    doc,
    {
      fromBarId: "jewish",
      toBarId: "islam",
      fromYear: doc.end,
      toYear: doc.end,
    },
    x,
    4,
  );
  assert.ok(
    Math.min(...edge.samples.map((s) => s.x)) < x(ordinal(doc.end)) - 200,
  );
  assert.ok(edge.samples.every((s) => s.x <= x(ordinal(doc.end))));
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

test("height changes default to centered and can preserve the top or bottom edge", () => {
  const doc = fixture(),
    bar = doc.bars[0];
  for (const alignment of [undefined, "center", "top", "bottom"]) {
    if (alignment) bar.heightAlignment = alignment;
    else delete bar.heightAlignment;
    for (const year of [-100, -1, 100, 250, 300]) {
      const section = barSectionAt(doc, bar, year);
      if (!alignment || alignment === "center")
        assert.equal(section.y + section.height / 2, bar.y + bar.height / 2);
      else if (alignment === "top") assert.equal(section.y, bar.y);
      else assert.equal(section.y + section.height, bar.y + bar.height);
      const epsilon = 0.0001;
      const at = ordinal(year);
      const a = sectionAt(doc, bar, at - epsilon),
        b = sectionAt(doc, bar, at + epsilon);
      assert.ok(Math.abs((b.y - a.y) / (2 * epsilon) - section.dy) < 0.00001);
    }
  }
});

test("branch thickness is measured across steep curves and smoothly blends endpoint heights", () => {
  const doc = fixture(),
    from = doc.bars[0],
    to = doc.bars.find((bar) => bar.id === "jewish");
  from.heightPeriods = [];
  from.y = 100;
  to.y = 500;
  const x = (at) => 64 + (at - ordinal(doc.start)) * UNIT;
  for (const targetHeight of [from.height, 90]) {
    to.height = targetHeight;
    for (const [fromYear, toYear] of [
      [-1, 10],
      [10, -1],
      [1, 1],
    ]) {
      const ribbon = branchRibbon(
        doc,
        { fromBarId: from.id, toBarId: to.id, fromYear, toYear },
        x,
      );
      assert.ok(!ribbon.path.includes("NaN"));
      const first = ribbon.samples[0],
        last = ribbon.samples.at(-1);
      assert.equal(first.height, from.height);
      assert.equal(last.height, targetHeight);
      assert.equal(first.upper.y, from.y);
      assert.deepEqual(
        [last.upper.y, last.lower.y].sort((a, b) => a - b),
        [to.y, to.y + to.height],
      );
      for (const s of ribbon.samples) {
        assert.ok(
          Math.abs(
            Math.hypot(s.upper.x - s.lower.x, s.upper.y - s.lower.y) - s.height,
          ) < 1e-8,
        );
        assert.ok(
          s.height >= Math.min(from.height, targetHeight) &&
            s.height <= Math.max(from.height, targetHeight),
        );
      }
      assert.equal(ribbon.samples[32].height, (from.height + targetHeight) / 2);
    }
  }
});

test("joined periods smoothly share a seam and half heights, then resume their original shape", () => {
  const d = structuredClone(sample),
    a = d.bars[0],
    b = d.bars.find((b) => b.id === "jewish");
  a.heightPeriods = [{ id: "height", start: -80, end: 80, height: 60 }];
  d.joinedPeriods = [
    {
      id: "joined",
      fromBarId: a.id,
      toBarId: b.id,
      start: -100,
      end: 100,
      transitionYears: 30,
    },
  ];
  const plain = { ...d, joinedPeriods: [] };
  for (const year of [-200, -100, 100, 200])
    assert.deepEqual(barSectionAt(d, a, year), barSectionAt(plain, a, year));
  for (const year of [-70, -1, 1, 70]) {
    const sa = barSectionAt(d, a, year),
      sb = barSectionAt(d, b, year);
    assert.ok(Math.abs(sa.y + sa.height - sb.y) < 1e-9);
    assert.equal(sa.height, barSectionAt(plain, a, year).height / 2);
    assert.equal(sb.height, barSectionAt(plain, b, year).height / 2);
    assert.ok(Math.abs(sa.dy + sa.dh - sb.dy) < 1e-9);
  }
  for (const at of [
    ordinal(-100),
    ordinal(-100) + 30,
    ordinal(100) - 30,
    ordinal(100),
  ]) {
    const left = sectionAt(d, a, at - 1e-5),
      right = sectionAt(d, a, at + 1e-5);
    assert.ok(Math.abs(left.y - right.y) < 0.001);
    assert.ok(Math.abs(left.dy - right.dy) < 0.001);
  }
  const s1 = barSectionAt(d, a, -85),
    s2 = barSectionAt(plain, a, -85);
  assert.ok(s1.height < s2.height && s1.height > s2.height / 2);
  for (const scale of [0.5, 1, 4]) {
    const svg = new JSDOM(renderTimeline(d, { horizontalScale: scale }), {
      contentType: "image/svg+xml",
    }).window.document;
    const path =
      svg.querySelector(`[data-id="${a.id}"] path`) ??
      svg.querySelector("path");
    assert.ok(path);
    assert.doesNotMatch(svg.documentElement.outerHTML, /NaN|Infinity/);
    assert.ok(ribbonPath(d, a, (at) => at * scale).path.includes("C"));
  }
});
