import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

test("compact public header switches translated title, content and exported SVG with English fallback", async () => {
  const doc = JSON.parse(
    readFileSync(
      new URL("../examples/traditions.chronosmos.json", import.meta.url),
    ),
  );
  doc.translations = { fi: { title: "Perinteiden aikajana" } };
  doc.bars[0].translations = { fi: { label: "Egyptiläiset perinteet" } };
  const html = readFileSync(
    new URL("../chronosmos/templates/viewer.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM("<body>" + html + '<div id="toast"></div></body>', {
    url: "http://localhost/traditions",
  });
  for (const key of [
    "window",
    "document",
    "navigator",
    "localStorage",
    "location",
    "history",
    "Event",
    "DOMParser",
    "XMLSerializer",
  ]) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
      writable: true,
    });
  }
  document.body.dataset.page = "viewer";
  localStorage.setItem("chronosmos-language", "fi");
  const $ = (s) => document.querySelector(s);
  $("#viewer").dataset.timelineId = "example";
  Object.defineProperty($("#canvas-viewport"), "clientWidth", { value: 1200 });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  globalThis.fetch = async (path) => {
    assert.equal(path, "/api/timelines/example");
    return { ok: true, json: async () => ({ document: doc }) };
  };
  await import("../chronosmos/static/app.js");
  assert.ok($("header #viewer-title"));
  assert.ok($("header .back-link"));
  assert.equal($("main #viewer-title"), null);
  assert.equal($(".viewer-intro"), null);
  assert.equal($("#viewer-title").textContent, "Perinteiden aikajana");
  assert.equal(document.title, "Perinteiden aikajana · Chronosmos");
  assert.equal($("#viewer-description").textContent, doc.description);
  assert.equal($("#viewer-description").hidden, false);
  assert.match($("#canvas").textContent, /Egyptiläiset perinteet/);
  $(".language").onclick();
  assert.equal($("#viewer-title").textContent, doc.title);
  assert.equal(document.title, doc.title + " · Chronosmos");
  assert.match($("#canvas").textContent, /Egyptian traditions/);
  $(".language").onclick();
  $("#export-open").onclick();
  let exported;
  URL.createObjectURL = (blob) => {
    exported = blob;
    return "blob:test";
  };
  URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () {};
  await $('[data-export="svg"]').onclick();
  const svg = await exported.text();
  assert.match(svg, /<title>Perinteiden aikajana<\/title>/);
  assert.match(svg, /Egyptiläiset perinteet/);
  assert.ok(svg.includes(doc.description));
  dom.window.close();
});
