import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { textFor } from "../chronosmos/static/content.js";
import {
  yearLabel,
  eventEndY,
  pixelsPerYear,
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
test("translated fields fall back individually to English, including blank and missing translations", () => {
  const item = {
    title: "English title",
    description: "English description",
    translations: {
      fi: { title: "Suomenkielinen otsikko", description: "  " },
      en: { title: "Ignored override" },
    },
  };
  assert.equal(textFor(item, "title"), "English title");
  assert.equal(textFor(item, "title", "en-US"), "English title");
  assert.equal(textFor(item, "title", "fi-FI"), "Suomenkielinen otsikko");
  assert.equal(textFor(item, "description", "fi"), "English description");
  assert.equal(textFor(item, "title", "sv"), "English title");
  assert.equal(textFor({}, "text", "fi"), "");
});
test("all timeline text renders in the selected language with escaped English fallback", () => {
  const doc = structuredClone(sample);
  doc.translations = { fi: { title: "Perinteiden aikajana" } };
  doc.bars[0].translations = { fi: { label: "Egyptiläiset perinteet" } };
  doc.overlays[0].translations = {
    fi: { text: "Teksti <script> & lisäteksti" },
  };
  doc.overlays[1].translations = { fi: { text: " " } };
  doc.events[0].translations = { fi: { label: "Vuosi yksi" } };
  const fi = parse(renderTimeline(doc, { language: "fi", interactive: true }));
  assert.equal(fi.querySelector("title").textContent, "Perinteiden aikajana");
  assert.equal(fi.querySelector("desc").textContent, doc.description);
  assert.equal(
    fi.querySelector('[data-id="egypt"] text').textContent,
    "Egyptiläiset perinteet",
  );
  assert.equal(
    fi.querySelector('[data-id="event1"] text').textContent,
    "Vuosi yksi",
  );
  assert.equal(
    fi.querySelector('[data-id="event2"] text').textContent,
    doc.events[1].label,
  );
  assert.match(
    fi.querySelector('[data-id="note1"] text').textContent,
    /<script>/,
  );
  assert.equal(fi.querySelectorAll("script").length, 0);
  assert.match(
    fi.querySelector('[data-id="note2"] text').textContent,
    /Ideas travel/,
  );
  const en = parse(renderTimeline(doc));
  assert.equal(en.querySelector("title").textContent, doc.title);
  assert.match(en.documentElement.textContent, /Egyptian traditions/);
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

test("million-year scales remain bounded, keep print distances exact, and localize labels", () => {
  for (const [start, end] of [
    [-65000000, 1],
    [-4500000000, 2026],
    [-1e12, 1e12],
  ]) {
    const doc = {
      ...sample,
      start,
      end,
      timeUnit: "millions",
      mmPerYear: 0.00001,
      bars: [],
      overlays: [],
      events: [],
    };
    const dim = dimensions(doc);
    assert.ok(dim.width < 5000 && dim.width > 128);
    const years = 1000000;
    assert.ok(
      Math.abs(
        ((xFor(doc, start + years) - xFor(doc, start)) / dim.width) *
          dim.widthMm -
          years * doc.mmPerYear,
      ) < 1e-5,
    );
    const svg = parse(renderTimeline(doc, { horizontalScale: 32 }));
    assert.ok(svg.querySelectorAll("line").length < 25000);
    assert.ok(!svg.documentElement.outerHTML.includes("NaN"));
    assert.ok(
      [...svg.querySelectorAll("text")].every((e) => e.textContent !== "0"),
    );
    assert.ok(pixelsPerYear(doc) < 0.45);
  }
  assert.equal(yearLabel(-65000000, "en", "millions"), "65 M BCE");
  assert.equal(yearLabel(-65000000, "fi", "millions"), "65 milj. eaa.");
  assert.equal(yearLabel(1, "en", "millions"), "1");
  assert.equal(yearLabel(-1000, "en", "thousands"), "1 k BCE");
});

test("event endpoints attach to the actual bar section, follow movement, and allow upward lines", () => {
  const doc = structuredClone(sample),
    bar = doc.bars.find((b) => b.id === "greek");
  bar.heightPeriods = [{ id: "grow", start: -400, end: -100, height: 70 }];
  const event = { ...doc.events[0], year: -200, y: 600, endBarId: bar.id };
  doc.events = [event];
  for (const [edge, fraction] of [
    ["top", 0],
    ["center", 0.5],
    ["bottom", 1],
  ]) {
    event.endEdge = edge;
    const section = barSectionAt(doc, bar, event.year);
    assert.equal(eventEndY(doc, event), section.y + section.height * fraction);
    for (const horizontalScale of [0.5, 4]) {
      const svg = parse(
        renderTimeline(doc, { horizontalScale, interactive: true }),
      );
      const line = svg.querySelector(`[data-id="${event.id}"] line`);
      assert.equal(Number(line.getAttribute("y2")), eventEndY(doc, event));
      assert.ok(
        Number(line.getAttribute("y2")) < Number(line.getAttribute("y1")),
      );
    }
  }
  const before = eventEndY(doc, event);
  doc.bars.find((b) => b.id === "roman").y += 20;
  assert.ok(eventEndY(doc, event) > before);
  const absolute = eventEndY(doc, event);
  delete event.endBarId;
  event.endY = absolute;
  assert.equal(eventEndY(doc, event), absolute);
});
