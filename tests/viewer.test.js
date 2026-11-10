import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { dimensions } from "../chronosmos/static/timeline.js";

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
  doc.overlays.push({
    ...doc.overlays[0],
    id: "brace1",
    type: "brace",
    year: 1,
    y: 200,
    width: 240,
    height: 320,
    text: "Group",
    topText: "Top",
    bottomText: "Bottom",
    braceWidth: 24,
    strokeWidth: 2,
    translations: {
      fi: { topText: "Alku", text: "Ryhmä", bottomText: "Loppu" },
    },
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
    if (path === "/api/timelines/example/package")
      return {
        ok: true,
        blob: async () =>
          new Blob(["public package"], { type: "application/zip" }),
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
  $("#zoom-in").onclick();
  $("#zoom-in").onclick();
  const canvasWidth = $("#canvas svg").getAttribute("viewBox").split(" ")[2];
  const canvasHeight = $("#canvas svg").getAttribute("viewBox").split(" ")[3];
  $("#export-open").onclick();
  const defaultFactor = Number($("#export-zoom").value);
  assert.equal(String(dimensions(doc, defaultFactor, "fi").width), canvasWidth);
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
  const parseSvg = (source) =>
    new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
  const initialSvg = parseSvg(svg);
  assert.equal(initialSvg.getAttribute("viewBox").split(" ")[2], canvasWidth);
  assert.equal(initialSvg.getAttribute("viewBox").split(" ")[3], canvasHeight);
  const zoomInput = $("#export-zoom");
  zoomInput.value = "2.5";
  zoomInput.oninput();
  const chosen = dimensions(doc, 2.5, "fi");
  assert.equal(
    $("#export-dimensions").textContent,
    `${chosen.widthMm.toFixed(1)} × ${chosen.heightMm.toFixed(1)} mm`,
  );
  await $('[data-export="svg"]').onclick();
  const chosenSvg = parseSvg(await exported.text());
  assert.equal(parseFloat(chosenSvg.getAttribute("width")), chosen.widthMm);
  assert.equal(
    parseFloat(chosenSvg.getAttribute("height")),
    dimensions(doc, 1, "fi").heightMm,
  );
  assert.equal(
    chosenSvg.querySelector("image").getAttribute("height"),
    initialSvg.querySelector("image").getAttribute("height"),
  );
  assert.equal(
    $("#canvas svg").getAttribute("viewBox").split(" ")[2],
    canvasWidth,
  );

  let raster;
  globalThis.Image = class {
    set src(value) {
      queueMicrotask(() => this.onload());
    }
  };
  dom.window.HTMLCanvasElement.prototype.getContext = function () {
    raster = this;
    return { drawImage() {} };
  };
  dom.window.HTMLCanvasElement.prototype.toBlob = function (callback) {
    callback(new Blob(["png output"], { type: "image/png" }));
  };
  await $('[data-export="png"]').onclick();
  assert.equal(raster.width, Math.ceil((chosen.widthMm * 96) / 25.4));
  assert.equal(raster.height, Math.ceil((chosen.heightMm * 96) / 25.4));
  assert.equal(await exported.text(), "png output");

  zoomInput.value = "0.75";
  zoomInput.oninput();
  const printSize = dimensions(doc, 0.75, "fi");
  let printed;
  window.print = () => {
    const area = $("#print-area");
    printed = area.querySelector("svg").outerHTML;
    assert.match(
      area.querySelector("style").textContent,
      new RegExp(`size: ${printSize.widthMm}mm ${printSize.heightMm}mm`),
    );
  };
  await $('[data-export="print"]').onclick();
  assert.equal(
    parseFloat(parseSvg(printed).getAttribute("width")),
    printSize.widthMm,
  );
  assert.equal($("#print-area"), null);
  const previous = exported;
  for (const invalid of ["0", "33", ""]) {
    zoomInput.value = invalid;
    zoomInput.oninput();
    assert.equal($("#export-dimensions").textContent, "—");
    await $('[data-export="svg"]').onclick();
    assert.equal(exported, previous);
  }
  $("#export-dialog").close();
  $("#zoom-in").onclick();
  $("#export-open").onclick();
  assert.ok(Number($("#export-zoom").value) > defaultFactor);
  assert.notEqual($("#export-zoom").value, "0.75");
  click($('[data-view-id="brace1"]'));
  assert.ok($("#detail-dialog svg .curly-bracket"));
  assert.match($("#detail-dialog").textContent, /Alku/);
  assert.match($("#detail-dialog").textContent, /Ryhmä/);
  assert.match($("#detail-dialog").textContent, /Loppu/);
  click($("#detail-dialog svg path"));
  assert.equal($("#detail-dialog").open, false);
  await $('[data-export="package"]').onclick();
  assert.equal(await exported.text(), "public package");
  dom.window.close();
});
