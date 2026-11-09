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
  doc.overlays.push({
    ...doc.overlays[0],
    id: "view-image",
    type: "image",
    mediaId: "a".repeat(32),
  });
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
    "FileReader",
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
  Object.defineProperty($("#canvas-viewport"), "clientHeight", { value: 600 });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  globalThis.fetch = async (path) => {
    if (path === "/media/" + "a".repeat(32) + ".png")
      return {
        ok: true,
        blob: async () =>
          new dom.window.Blob(["test image"], { type: "image/png" }),
      };
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
  const viewport = $("#canvas-viewport");
  viewport.setPointerCapture = () => {};
  viewport.scrollLeft = 300;
  viewport.scrollTop = 100;
  const pointer = (type, x, y) =>
    new dom.window.MouseEvent(type, {
      clientX: x,
      clientY: y,
      button: 0,
      bubbles: true,
      cancelable: true,
    });
  $("#canvas").dispatchEvent(pointer("pointerdown", 100, 100));
  viewport.dispatchEvent(pointer("pointermove", 140, 120));
  assert.equal(viewport.scrollLeft, 260);
  assert.equal(viewport.scrollTop, 80);
  viewport.dispatchEvent(pointer("pointerup", 140, 120));
  $("#canvas").dispatchEvent(pointer("pointerdown", 100, 100));
  window.dispatchEvent(pointer("pointerup", 200, 200));
  viewport.dispatchEvent(pointer("pointermove", 180, 180));
  assert.equal(viewport.scrollLeft, 260);
  // Reset the click suppression with another actual drag before checking it.
  $("#canvas").dispatchEvent(pointer("pointerdown", 100, 100));
  viewport.dispatchEvent(pointer("pointermove", 110, 100));
  viewport.dispatchEvent(pointer("pointerup", 110, 100));
  const click = (target) =>
    target.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  click($('[data-view-id="note2"]'));
  assert.equal($("#detail-dialog").open, false);
  click($('[data-view-id="note2"]'));
  assert.equal($("#detail-dialog").open, true);
  assert.equal(
    $("#detail-dialog .detail-text").textContent,
    doc.overlays[1].text,
  );
  click(document.body);
  assert.equal($("#detail-dialog").open, false);
  click($('[data-view-id="view-image"]'));
  assert.equal($("#detail-dialog").open, true);
  assert.match($("#detail-dialog img").src, /media\/a+\.png$/);
  click($("#detail-dialog img"));
  assert.equal($("#detail-dialog").open, false);
  $('[data-view-id="note1"]').dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  assert.equal($("#detail-dialog").open, true);
  document.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.equal($("#detail-dialog").open, false);
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
