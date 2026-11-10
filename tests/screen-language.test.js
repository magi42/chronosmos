import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { dimensions } from "../chronosmos/static/timeline.js";
import { fittedScreenScale } from "../chronosmos/static/screen-scale.js";
import { applyAIProposal } from "../chronosmos/static/ai-apply.js";

const short = () => ({
  version: 1,
  title: "A life",
  description: "",
  slug: "life",
  start: 1902,
  end: 2026,
  mmPerYear: 1,
  height: 400,
  scale: "both",
  background: "#faf8f2",
  translations: { fi: { title: "Elämä" } },
  bars: [
    {
      id: "life",
      label: "Life",
      start: 1902,
      end: 2026,
      y: 120,
      height: 32,
      background: "#526a55",
      foreground: "#ffffff",
      fadeIn: 0,
      fadeOut: 0,
      mergeInto: "",
      mergeYears: 1,
      translations: { fi: { label: "Elämä" } },
    },
  ],
  overlays: [],
  events: [],
});

test("screen 100% fills the width for short, historical and geological ranges without changing physical export geometry", () => {
  for (const [start, end] of [
    [1902, 2026],
    [-1, 1],
    [-1000, 2026],
    [-4500000000, 2026],
  ]) {
    const d = short();
    d.start = start;
    d.end = end;
    const before = dimensions(d),
      scale = fittedScreenScale(d, 1136, "en");
    assert.ok(Math.abs(dimensions(d, scale).width - 1136) < 1e-6);
    assert.equal(dimensions(d, scale).height, 400);
    assert.deepEqual(dimensions(d), before);
  }
});

test("lang URL overrides a saved language, follows navigation, and screen zoom stays relative to responsive fit", async () => {
  const html = readFileSync(
    new URL("../chronosmos/templates/viewer.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(`<body>${html}<div id="toast"></div></body>`, {
    url: "http://localhost/life?lang=fi&keep=yes",
  });
  for (const k of [
    "window",
    "document",
    "navigator",
    "localStorage",
    "location",
    "history",
    "Event",
    "DOMParser",
    "XMLSerializer",
    "FileReader",
  ])
    Object.defineProperty(globalThis, k, {
      value: dom.window[k],
      configurable: true,
      writable: true,
    });
  document.body.dataset.page = "viewer";
  localStorage.setItem("chronosmos-language", "en");
  const $ = (s) => document.querySelector(s),
    doc = short();
  $("#viewer").dataset.timelineId = "life";
  let available = 1200;
  Object.defineProperty($("#canvas-viewport"), "clientWidth", {
    get: () => available,
  });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ document: doc }),
  });
  await import("../chronosmos/static/app.js");
  assert.equal(document.documentElement.lang, "fi");
  assert.equal($("#viewer-title").textContent, "Elämä");
  assert.equal($("#zoom-value").textContent, "100%");
  assert.ok(Math.abs(parseFloat($("#canvas svg").style.width) - 1136) < 1e-6);
  assert.equal(new URL($(".back-link").href).searchParams.get("lang"), "fi");
  const height = $("#canvas svg").style.height;
  $("#export-open").onclick();
  assert.equal($("#export-stretch").value, "100");
  available = 1600;
  window.dispatchEvent(new Event("resize"));
  assert.equal($("#zoom-value").textContent, "100%");
  assert.ok(Math.abs(parseFloat($("#canvas svg").style.width) - 1536) < 1e-6);
  $("#zoom-in").onclick();
  assert.equal($("#zoom-value").textContent, "125%");
  assert.ok(
    Math.abs(
      parseFloat($("#canvas svg").style.width) - (128 + (1536 - 128) * 1.25),
    ) < 1e-6,
  );
  assert.equal($("#canvas svg").style.height, height);
  $("#export-open").onclick();
  assert.equal($("#export-stretch").value, "125");
  $(".language").onclick();
  assert.equal(document.documentElement.lang, "en");
  assert.equal(new URL(location.href).searchParams.get("lang"), "en");
  assert.equal(new URL(location.href).searchParams.get("keep"), "yes");
  $("#zoom-fit").onclick();
  assert.equal($("#zoom-value").textContent, "100%");
  dom.window.close();
});

test("AI apply fills individual missing translations and preserves existing authored translations and base text", () => {
  const d = short();
  d.description = "An English description";
  d.overlays = [
    { id: "note", text: "Base", translations: { fi: { text: "Oma teksti" } } },
  ];
  const p = {
    bars: [],
    events: [],
    joinedPeriods: [],
    translationUpdates: [
      {
        kind: "timeline",
        id: "",
        language: "fi",
        fields: [
          { field: "title", text: "Override" },
          { field: "description", text: "Suomennettu kuvaus" },
        ],
      },
      {
        kind: "overlays",
        id: "note",
        language: "fi",
        fields: [{ field: "text", text: "Override" }],
      },
    ],
  };
  const next = applyAIProposal(d, p);
  assert.equal(next.translations.fi.title, "Elämä");
  assert.equal(next.translations.fi.description, "Suomennettu kuvaus");
  assert.equal(next.overlays[0].translations.fi.text, "Oma teksti");
  assert.equal(next.description, "An English description");
  assert.equal(d.translations.fi.description, undefined);
});
