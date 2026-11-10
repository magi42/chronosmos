import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { textFor } from "../chronosmos/static/content.js";
import {
  yearLabel,
  eventCaption,
  barCaption,
  eventEndY,
  eventStartY,
  axisY,
  axisTicks,
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

test("authored axis intervals control labels, minor ticks and background major lines", () => {
  const doc = {
    ...sample,
    start: -2000,
    end: 2000,
    labelInterval: 1000,
    minorTickInterval: 100,
    majorGrid: true,
  };
  const svg = parse(renderTimeline(doc, { interactive: true }));
  assert.deepEqual(
    [...svg.querySelectorAll(".top-axis text")].map((e) =>
      Number(e.dataset.year),
    ),
    [-2000, -1000, 1, 1000, 2000],
  );
  assert.ok(svg.querySelector('.top-axis .minor-tick[data-year="-1900"]'));
  assert.ok(!svg.querySelector('[data-year="0"]'));
  assert.equal(
    svg.querySelector(".top-axis .axis-line").getAttribute("y1"),
    "55",
  );
  const major = svg.querySelector('.major-grid [data-year="1000"]');
  const lines = [...major.querySelectorAll("line")];
  assert.equal(lines.length, 3);
  assert.equal(Number(lines[0].getAttribute("y1")), 55);
  assert.equal(Number(lines[0].getAttribute("y2")), doc.height - 50);
  assert.equal(Number(lines[1].getAttribute("y1")), 47);
  assert.equal(Number(lines[2].getAttribute("y2")), doc.height - 42);
  assert.ok(
    svg
      .querySelector(".major-grid")
      .compareDocumentPosition(svg.querySelector('[data-id="egypt"]')) & 4,
  );
  const zoomed = parse(renderTimeline(doc, { horizontalScale: 4 }));
  assert.equal(
    zoomed.querySelector(".major-grid-line").getAttribute("y2"),
    lines[0].getAttribute("y2"),
  );
  assert.equal(
    svg.querySelector(".major-grid-line").getAttribute("x1"),
    String(xFor(doc, -2000)),
  );
  assert.equal(
    parse(renderTimeline({ ...doc, majorGrid: false })).querySelector(
      ".major-grid",
    ),
    null,
  );
  for (const year of axisTicks({
    ...doc,
    start: -1e12,
    end: 1e12,
    labelInterval: 1,
    minorTickInterval: 1,
  }).major)
    assert.notEqual(year, 0);
  assert.ok(
    axisTicks({
      ...doc,
      start: -1e12,
      end: 1e12,
      labelInterval: 1,
      minorTickInterval: 1,
    }).minor.length <= 12005,
  );
});

test("event sources and targets independently attach to either axis or a time bar", () => {
  const doc = structuredClone(sample);
  const event = {
    ...doc.events[0],
    year: -1,
    startBarId: "egypt",
    startEdge: "bottom",
    endAxis: "top",
  };
  doc.events = [event];
  const section = barSectionAt(doc, doc.bars[0], -1);
  assert.equal(eventStartY(doc, event), section.y + section.height);
  assert.equal(eventEndY(doc, event), axisY(doc, "top"));
  for (const source of ["top", "bottom"])
    for (const target of ["top", "bottom"]) {
      delete event.startBarId;
      event.startAxis = source;
      event.endAxis = target;
      for (const horizontalScale of [0.5, 3]) {
        const svg = parse(
          renderTimeline(doc, { horizontalScale, interactive: true }),
        );
        const line = svg.querySelector('[data-kind="events"] line');
        assert.equal(Number(line.getAttribute("y1")), axisY(doc, source));
        assert.equal(Number(line.getAttribute("y2")), axisY(doc, target));
      }
    }
  event.startAxis = "bottom";
  delete event.endAxis;
  event.endBarId = "egypt";
  assert.equal(eventEndY(doc, event), section.y + section.height / 2);
});

test("event captions use top, bottom, center and free positions for either line direction", () => {
  for (const [start, end] of [
    [100, 500],
    [500, 100],
  ]) {
    const event = {
      ...sample.events[0],
      y: start,
      endY: end,
      labelOffsetX: 25,
    };
    const doc = { ...sample, events: [event] };
    for (const [position, expected] of [
      ["top", 91],
      ["bottom", 518],
      ["center", 300],
      ["free", 345],
    ]) {
      event.labelPosition = position;
      event.labelY = 345;
      assert.equal(eventCaption(doc, event).y, expected);
      for (const horizontalScale of [0.5, 4]) {
        const svg = parse(
          renderTimeline(doc, { interactive: true, horizontalScale }),
        );
        const text = svg.querySelector('[data-kind="events"] text');
        assert.equal(Number(text.getAttribute("y")), expected);
        assert.equal(
          Number(text.getAttribute("x")),
          xFor(doc, event.year, horizontalScale) + 25,
        );
      }
    }
  }
});

test("outside bar captions are unclipped, sized automatically or explicitly, and get space in the canvas and print export", () => {
  const doc = structuredClone(sample),
    bar = doc.bars[0];
  bar.end = doc.end;
  bar.label = "A longer caption placed to the right of its time bar";
  bar.captionPosition = "right";
  bar.captionFontSize = 24;
  for (const horizontalScale of [0.1, 1, 4]) {
    const dim = dimensions(doc, horizontalScale);
    const svg = parse(
      renderTimeline(doc, { interactive: true, horizontalScale }),
    );
    const caption = svg.querySelector('[data-id="egypt"] text');
    assert.equal(caption.getAttribute("clip-path"), null);
    assert.equal(
      Number(caption.getAttribute("x")),
      xFor(doc, bar.end, horizontalScale) + 10,
    );
    assert.equal(Number(caption.getAttribute("font-size")), 24);
    assert.ok(dim.width > xFor(doc, doc.end, horizontalScale) + 300);
    assert.equal(
      Number(svg.documentElement.getAttribute("viewBox").split(" ")[2]),
      dim.width,
    );
    assert.ok(
      Math.abs(
        ((xFor(doc, 101, horizontalScale) - xFor(doc, 1, horizontalScale)) /
          dim.width) *
          dim.widthMm -
          100 * doc.mmPerYear * horizontalScale,
      ) < 1e-9,
    );
  }
  bar.captionPosition = "left";
  const dim = dimensions(doc);
  const caption = barCaption(doc, bar);
  assert.ok(dim.left > 64);
  assert.equal(caption.anchor, "end");
  bar.captionFontSize = "auto";
  assert.equal(barCaption(doc, bar).size, 14);
  bar.captionPosition = "free";
  bar.captionYear = 2200;
  assert.equal(barCaption(doc, bar).year, 2200);
});

test("dotted event lines use round dots scaled with line width and retain a continuous selection target", () => {
  for (const width of [0.5, 2, 5]) {
    const doc = structuredClone(sample);
    doc.events[0].dotted = true;
    doc.events[0].width = width;
    for (const horizontalScale of [0.5, 4]) {
      const svg = parse(
        renderTimeline(doc, { interactive: true, horizontalScale }),
      );
      const [line, hit] = svg.querySelectorAll('[data-id="event1"] line');
      assert.equal(line.getAttribute("stroke-dasharray"), `0 ${width * 3}`);
      assert.equal(line.getAttribute("stroke-linecap"), "round");
      assert.equal(hit.getAttribute("stroke-dasharray"), null);
      assert.equal(hit.getAttribute("stroke"), "transparent");
    }
    assert.equal(
      parse(renderTimeline(sample, { interactive: true }))
        .querySelector('[data-id="event1"] line')
        .getAttribute("stroke-dasharray"),
      null,
    );
  }
});

test("hidden bar captions keep their names and stop reserving caption margins", () => {
  const doc = structuredClone(sample),
    bar = doc.bars[0];
  bar.captionPosition = "right";
  bar.end = doc.end;
  bar.label =
    "A long descriptive name for selecting a bar without displaying its caption";
  const width = dimensions(doc).width;
  bar.showCaption = false;
  const svg = parse(renderTimeline(doc, { interactive: true }));
  const group = svg.querySelector('[data-id="egypt"]');
  assert.ok(group.querySelector("path"));
  assert.equal(group.querySelector("text"), null);
  assert.equal(group.getAttribute("aria-label"), bar.label);
  assert.ok(dimensions(doc).width < width);
  assert.equal(
    bar.label,
    "A long descriptive name for selecting a bar without displaying its caption",
  );
});

test("curly brackets stretch vertically with three translated captions and preserve geometry under horizontal zoom", () => {
  const doc = structuredClone(sample);
  const brace = {
    ...doc.overlays[0],
    id: "brace1",
    type: "brace",
    year: doc.end,
    y: 100,
    width: 240,
    height: 400,
    braceWidth: 24,
    strokeWidth: 2,
    fontSize: 14,
    text: "Group",
    topText: "Top <script>",
    bottomText: "Bottom",
    translations: { fi: { topText: "Alku", text: "", bottomText: "Loppu" } },
  };
  doc.overlays = [brace];
  for (const height of [80, 400, 1000]) {
    brace.height = height;
    let path;
    for (const horizontalScale of [0.25, 1, 4]) {
      const svg = parse(
        renderTimeline(doc, {
          interactive: true,
          horizontalScale,
          language: "fi",
        }),
      );
      const group = svg.querySelector('[data-id="brace1"]');
      const current = group.querySelector(".curly-bracket").getAttribute("d");
      if (path) assert.equal(current, path);
      else path = current;
      assert.ok(current.endsWith(`0,${height}`));
      assert.equal(
        group.querySelector('[data-brace-caption="top"]').textContent,
        "Alku",
      );
      assert.equal(
        group.querySelector('[data-brace-caption="center"]').textContent,
        "Group",
      );
      assert.equal(
        group.querySelector('[data-brace-caption="bottom"]').textContent,
        "Loppu",
      );
      assert.equal(
        Number(
          group
            .querySelector('[data-brace-caption="center"]')
            .getAttribute("y"),
        ),
        100 + height / 2,
      );
      assert.ok(
        dimensions(doc, horizontalScale, "fi").width >=
          xFor(doc, doc.end, horizontalScale, "fi") + brace.width + 16,
      );
    }
  }
  const en = parse(renderTimeline(doc));
  assert.equal(en.querySelector("script"), null);
  assert.equal(
    en.querySelector('[data-brace-caption="top"]').textContent,
    "Top <script>",
  );
});

test("bar stacking controls merges, joined transitions and source branches in editor, viewer and exports", () => {
  const bar = (id, y, color) => ({
    id,
    label: id,
    start: -100,
    end: 200,
    y,
    height: 32,
    background: color,
    foreground: "#ffffff",
    fadeIn: 0,
    fadeOut: 0,
    mergeInto: "",
    mergeYears: 20,
  });
  const d = {
    version: 1,
    title: "Stacking",
    description: "",
    slug: "stacking",
    start: -100,
    end: 200,
    height: 400,
    scale: "both",
    mmPerYear: 1,
    background: "#ffffff",
    bars: [
      bar("a", 100, "#bb3322"),
      bar("b", 220, "#3355bb"),
      bar("c", 160, "#228855"),
    ],
    overlays: [
      {
        id: "box",
        type: "box",
        year: 1,
        y: 300,
        width: 80,
        height: 40,
        text: "Box",
        fontSize: 12,
        color: "#000000",
        fill: "#ffffff",
      },
    ],
    events: [
      {
        id: "under",
        year: -1,
        y: 55,
        height: 280,
        width: 1,
        color: "#222222",
        label: "Under",
        layer: "under",
      },
      {
        id: "over",
        year: 1,
        y: 55,
        height: 280,
        width: 1,
        color: "#222222",
        label: "Over",
        layer: "over",
      },
    ],
    branches: [
      { id: "ab", fromBarId: "a", toBarId: "b", fromYear: -80, toYear: 150 },
      { id: "cb", fromBarId: "c", toBarId: "b", fromYear: -70, toYear: 170 },
    ],
    joinedPeriods: [
      {
        id: "join",
        fromBarId: "a",
        toBarId: "c",
        start: -50,
        end: 50,
        transitionYears: 20,
      },
    ],
  };
  d.bars[0].end = 100;
  d.bars[0].mergeInto = "b";
  const fills = (svg) =>
    [...parse(svg).querySelectorAll("path[fill]")]
      .map((el) => el.getAttribute("fill"))
      .filter((s) => /^url\(#(?:grad|branch)-/.test(s));
  const before = renderTimeline(d);
  assert.deepEqual(fills(before), [
    "url(#branch-ab)",
    "url(#branch-cb)",
    "url(#grad-a)",
    "url(#grad-b)",
    "url(#grad-c)",
  ]);
  const original = JSON.stringify(d);
  const geometry = Object.fromEntries(
    [...parse(before).querySelectorAll("path[fill]")].map((p) => [
      p.getAttribute("fill"),
      p.getAttribute("d"),
    ]),
  );
  const zero = structuredClone(d);
  zero.bars.forEach((b) => (b.zIndex = 0));
  assert.equal(renderTimeline(zero), before);
  d.bars[0].zIndex = 2;
  for (const mode of [{ interactive: true }, { viewing: true }, {}])
    for (const horizontalScale of [0.5, 1, 4]) {
      const svg = renderTimeline(d, { ...mode, horizontalScale });
      assert.deepEqual(fills(svg), [
        "url(#branch-cb)",
        "url(#grad-b)",
        "url(#grad-c)",
        "url(#branch-ab)",
        "url(#grad-a)",
      ]);
      assert.doesNotMatch(svg, /NaN|Infinity/);
    }
  const svg = parse(renderTimeline(d, { interactive: true }));
  assert.deepEqual(
    [...svg.querySelectorAll("[data-id]")].map((n) => n.dataset.id),
    ["under", "cb", "b", "c", "ab", "a", "box", "over"],
  );
  assert.deepEqual(
    Object.fromEntries(
      [...parse(renderTimeline(d)).querySelectorAll("path[fill]")].map((p) => [
        p.getAttribute("fill"),
        p.getAttribute("d"),
      ]),
    ),
    geometry,
  );
  assert.deepEqual(
    d.bars.map((b) => b.id),
    JSON.parse(original).bars.map((b) => b.id),
  );
  d.bars[1].zIndex = 3;
  assert.equal(fills(renderTimeline(d)).at(-1), "url(#grad-b)");
  d.bars[2].zIndex = 4;
  assert.equal(fills(renderTimeline(d)).at(-1), "url(#grad-c)");
});
