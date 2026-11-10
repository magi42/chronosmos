import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  dimensions,
  ordinal,
  PAD,
  UNIT,
} from "../chronosmos/static/timeline.js";

test("editor adds, edits, saves, publishes, undoes and previews a composition", async () => {
  const sample = JSON.parse(
    readFileSync(
      new URL("../examples/traditions.chronosmos.json", import.meta.url),
    ),
  );
  const html = readFileSync(
    new URL("../chronosmos/templates/editor.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(
    '<meta name="csrf-token" content="test"><body>' +
      html +
      '<div id="toast"></div></body>',
    { url: "http://localhost/manage?timeline=abc" },
  );
  for (const key of [
    "window",
    "document",
    "navigator",
    "localStorage",
    "location",
    "history",
    "Event",
    "FileReader",
    "Image",
    "DOMParser",
    "XMLSerializer",
  ])
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
      writable: true,
    });
  document.body.dataset.page = "editor";
  Object.defineProperty(
    document.querySelector("#canvas-viewport"),
    "clientWidth",
    { value: 1100 },
  );
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function (value = "") {
    this.returnValue = value;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
  let serverDoc = structuredClone(sample),
    revision = 1,
    published = false;
  serverDoc.overlays.push({
    ...sample.overlays[0],
    id: "illustration",
    type: "image",
    mediaId: "a".repeat(32),
  });
  const writes = [];
  globalThis.fetch = async (path, options = {}) => {
    let body;
    if (options.body) body = JSON.parse(options.body);
    if (options.method) writes.push({ path, ...options, body });
    let result;
    if (path === "/api/timelines?editor=1")
      result = [{ id: "abc", title: serverDoc.title }];
    else if (path === "/api/timelines/abc?editor=1")
      result = { id: "abc", document: serverDoc, revision, published };
    else if (path === "/api/timelines/abc" && options.method === "PUT") {
      assert.equal(body.revision, revision);
      serverDoc = structuredClone(body.document);
      result = { id: "abc", revision: ++revision };
    } else if (path === "/api/timelines/abc/publish") {
      assert.equal(body.revision, revision);
      published = body.published;
      result = { revision: ++revision };
    } else if (path === "/media/" + "a".repeat(32) + ".png")
      return {
        ok: true,
        blob: async () =>
          new dom.window.Blob(["test image bytes"], { type: "image/png" }),
      };
    else throw new Error("Unexpected API request " + path);
    return { ok: true, json: async () => result };
  };
  await import("../chronosmos/static/app.js");
  const $ = (s) => document.querySelector(s),
    click = async (s) => {
      const el = $(s);
      assert.ok(el, s);
      await el.onclick?.(new Event("click"));
    };
  assert.equal($("html").lang, "en");
  assert.equal($("#canvas svg title").textContent, sample.title);
  assert.equal(document.querySelectorAll(".layer-row").length, 8);
  const viewport = $("#canvas-viewport");
  Object.defineProperty($("#canvas"), "offsetLeft", { value: 32 });
  const height = $("#canvas svg").style.height;
  const width = () => parseFloat($("#canvas svg").style.width);
  const initialWidth = width();
  viewport.scrollTop = 125;
  await click("#zoom-in");
  assert.ok(
    Math.abs((width() - PAD * 2) / (initialWidth - PAD * 2) - 1.25) < 1e-10,
  );
  assert.equal($("#canvas svg").style.height, height);
  assert.equal(viewport.scrollTop, 125);
  await click("#zoom-out");
  assert.ok(Math.abs(width() - initialWidth) < 1e-10);
  viewport.scrollLeft = 240;
  viewport.dispatchEvent(
    new dom.window.WheelEvent("wheel", {
      ctrlKey: true,
      deltaY: -100,
      clientX: 300,
      clientY: 200,
      cancelable: true,
    }),
  );
  assert.equal($("#canvas svg").style.height, height);
  assert.equal(viewport.scrollTop, 125);
  assert.ok(
    Math.abs(
      viewport.scrollLeft - (32 + PAD + (240 + 300 - 32 - PAD) * 1.12 - 300),
    ) < 1e-10,
  );
  const currentZoom =
    (width() - PAD * 2) / (dimensions(sample).width - PAD * 2);
  $("#canvas").setPointerCapture = () => {};
  const pointer = (type, x, y, shiftKey = false) =>
    new dom.window.MouseEvent(type, {
      clientX: x,
      clientY: y,
      button: 0,
      bubbles: true,
      shiftKey,
    });
  $('#canvas [data-id="egypt"]').dispatchEvent(
    pointer("pointerdown", 200, 100),
  );
  $("#canvas").dispatchEvent(pointer("pointermove", 244, 136));
  $("#canvas").dispatchEvent(pointer("pointerup", 244, 136));
  assert.equal(Number($("#field-y").value), sample.bars[0].y + 36);
  assert.equal(Number($("#field-start").value), sample.bars[0].start);
  await click("#undo");
  await click("#zoom-fit");
  assert.equal($("#canvas svg").style.height, height);
  assert.ok(width() <= viewport.clientWidth - 64 + 1e-10);
  const fitZoom = (width() - PAD * 2) / (dimensions(sample).width - PAD * 2);
  const dragElement = (selector, dx, dy, shift = false) => {
    $(selector).dispatchEvent(pointer("pointerdown", 200, 100, shift));
    $("#canvas").dispatchEvent(
      pointer("pointermove", 200 + dx, 100 + dy, shift),
    );
    $("#canvas").dispatchEvent(pointer("pointerup", 200 + dx, 100 + dy, shift));
  };
  dragElement('#canvas [data-id="egypt"] [data-caption]', 50, 80);
  assert.equal(Number($("#field-start").value), sample.bars[0].start);
  assert.equal(Number($("#field-y").value), sample.bars[0].y);
  assert.equal(
    ordinal(Number($("#field-captionYear").value)) -
      ordinal(sample.bars[0].start),
    Math.round(50 / fitZoom / UNIT),
  );
  const setField = (key, value) => {
    const input = $("#field-" + key);
    input.value = String(value);
    input.onchange();
  };
  assert.equal($("#field-heightAlignment").value, "center");
  setField("heightAlignment", "bottom");
  setField("captionYear", -1);
  await click('[data-tab="overlays"]');
  await click('#layer-list [data-id="note1"]');
  setField("anchorBarId", "egypt");
  assert.equal(Number($("#field-year").value), sample.bars[0].end);
  setField("year", -1);
  setField("offsetY", -30);
  await click('[data-tab="bars"]');
  await click('#layer-list [data-id="egypt"]');
  dragElement('#canvas [data-id="egypt"] path', 2 * UNIT * fitZoom, 40, true);
  assert.equal(Number($("#field-captionYear").value), 2);
  assert.equal(Number($("#field-y").value), sample.bars[0].y + 40);
  await click('[data-tab="overlays"]');
  await click('#layer-list [data-id="note1"]');
  assert.equal($("#field-anchorBarId").value, "egypt");
  assert.equal(Number($("#field-year").value), 2);
  assert.equal(Number($("#field-offsetY").value), -30);
  const anchoredY = Number(
    $('#canvas [data-id="note1"] text').getAttribute("y"),
  );
  setField("anchorBarId", "");
  assert.equal(
    Number($('#canvas [data-id="note1"] text').getAttribute("y")),
    anchoredY,
  );
  setField("anchorBarId", "egypt");
  await click('[data-tab="bars"]');
  await click('#layer-list [data-id="egypt"]');
  setField("end", -500);
  assert.equal(Number($("#field-captionYear").value), 2);
  await click("#undo");
  await click("#delete-element");
  await click('[data-tab="overlays"]');
  await click('#layer-list [data-id="note1"]');
  assert.equal($("#field-anchorBarId").value, "");
  assert.equal(
    Number($('#canvas [data-id="note1"] text').getAttribute("y")),
    anchoredY,
  );
  await click("#undo");
  await click('[data-tab="bars"]');
  await click('[data-add="bar"]');
  assert.equal(document.querySelectorAll(".layer-row").length, 9);
  const label = $("#field-label");
  label.value = "An edited bar";
  label.onchange();
  assert.equal($("#inspector h2").textContent, "An edited bar");
  await click("#save");
  assert.equal(serverDoc.bars.length, 9);
  assert.equal(serverDoc.bars.at(-1).label, "An edited bar");
  assert.equal(serverDoc.bars[0].captionYear, 2);
  assert.equal(serverDoc.overlays[0].anchorBarId, "egypt");
  assert.equal(serverDoc.overlays[0].year, 2);
  assert.ok(writes.every((w) => w.headers["X-CSRF-Token"] === "test"));
  await click("#undo");
  assert.equal($("#field-label").value, "New time bar");
  await click("#redo");
  assert.equal($("#field-label").value, "An edited bar");
  const chooseTextLanguage = (key, locale) => {
    const select = $("#language-" + key);
    assert.ok(select);
    assert.deepEqual(
      [...select.options].map((o) => o.value),
      ["en", "fi"],
    );
    assert.ok(
      select.compareDocumentPosition($("#field-" + key)) &
        dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    );
    select.value = locale;
    select.onchange();
  };
  const savedStatus = $("#save-status").textContent;
  chooseTextLanguage("label", "fi");
  assert.equal($("#field-label").value, "");
  assert.equal($("#field-label").placeholder, "An edited bar");
  assert.equal($("#field-label").lang, "fi");
  assert.equal($("#save-status").textContent, savedStatus);
  chooseTextLanguage("label", "en");
  assert.equal($("#field-label").value, "An edited bar");
  const setTranslation = (key, value) => {
    chooseTextLanguage(key, "fi");
    const input = $("#field-" + key);
    assert.ok(input);
    input.value = value;
    input.onchange();
  };
  setTranslation("label", "Muokattu aikapalkki");
  chooseTextLanguage("label", "en");
  assert.equal($("#field-label").value, "An edited bar");
  await click(".language");
  assert.equal($("#inspector h2").textContent, "Muokattu aikapalkki");
  assert.equal($("#field-label").value, "An edited bar");
  setTranslation("label", " ");
  assert.equal($("#inspector h2").textContent, "An edited bar");
  await click("#undo");
  assert.equal($("#inspector h2").textContent, "Muokattu aikapalkki");
  assert.equal($("#language-label").value, "fi");
  assert.equal($("#field-label").value, "Muokattu aikapalkki");
  await click(".language");
  assert.equal($("#language-label").value, "fi");
  chooseTextLanguage("label", "en");
  await click("#save");
  assert.equal(serverDoc.bars.at(-1).label, "An edited bar");
  assert.equal(
    serverDoc.bars.at(-1).translations.fi.label,
    "Muokattu aikapalkki",
  );
  await click("#preview");
  assert.ok(document.body.classList.contains("preview"));
  assert.equal($("#canvas [data-id]"), null);
  await click("#preview");
  assert.ok($("#canvas [data-id]"));
  const publishing = $("#publish").onclick();
  await new Promise((resolve) => setImmediate(resolve));
  await click("[data-confirm]");
  await publishing;
  assert.equal(published, true);
  assert.equal($("#publication-status").textContent, "Published");
  await click(".language");
  assert.equal(document.documentElement.lang, "fi");
  assert.equal($("#save").textContent, "Tallenna luonnos");
  await click("#document-settings");
  assert.equal($("#language-title").value, "en");
  assert.equal($("#language-description").value, "en");
  assert.equal($("#language-slug"), null);
  chooseTextLanguage("title", "fi");
  $("#field-title").value = "Suomenkielinen aikajana";
  // Switching must keep a pending edit even before the input's change event.
  chooseTextLanguage("title", "en");
  assert.equal($("#field-title").value, sample.title);
  chooseTextLanguage("title", "fi");
  assert.equal($("#field-title").value, "Suomenkielinen aikajana");
  assert.equal($("#language-description").value, "en");
  chooseTextLanguage("description", "fi");
  assert.equal($("#field-description").value, "");
  assert.equal($("#field-description").placeholder, sample.description);
  assert.equal($("#language-title").value, "fi");
  const start = $("#field-start");
  start.value = "0";
  start.onchange();
  assert.notEqual($("#field-start").value, "0");
  assert.match($("#toast").textContent, /Vuotta 0/);
  await click("#export-open");
  assert.ok($("#export-dialog").open);
  assert.ok($('[data-export="svg"]'));
  assert.ok(Number($("#export-zoom").value) > 0);
  $("#export-zoom").value = "1";
  $("#export-zoom").oninput();
  let exported;
  globalThis.URL.createObjectURL = (blob) => {
    exported = blob;
    return "blob:download";
  };
  globalThis.URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () {};
  await click('[data-export="svg"]');
  const svg = await exported.text();
  assert.match(svg, /data:image\/png;base64,/);
  assert.ok(!svg.includes("/media/"));
  assert.ok(!svg.includes("data-id="));
  assert.match(svg, /width="[\d.]+mm"/);
  const exportedSvg = new DOMParser().parseFromString(
    svg,
    "image/svg+xml",
  ).documentElement;
  assert.equal(
    parseFloat(exportedSvg.getAttribute("width")),
    dimensions(sample).widthMm,
  );
  assert.equal(
    parseFloat(exportedSvg.getAttribute("height")),
    dimensions(sample).heightMm,
  );
  assert.match(svg, /Muokattu aikapalkki/);
  await click("[data-close]");
  await click('[data-tab="overlays"]');
  await click('[data-add="text"]');
  assert.equal($("#field-text").value, "Your story here");
  assert.equal($("#language-text").value, "en");
  setTranslation("text", "Uusi teksti");
  chooseTextLanguage("text", "en");
  assert.equal($("#field-text").value, "Your story here");
  await click("#save");
  assert.equal(serverDoc.overlays.at(-1).translations.fi.text, "Uusi teksti");
  chooseTextLanguage("text", "fi");
  $("#field-text").value = "Tallennettu suoraan kentästä";
  await click("#save");
  assert.equal(
    serverDoc.overlays.at(-1).translations.fi.text,
    "Tallennettu suoraan kentästä",
  );
  await click('[data-add="box"]');
  assert.equal($("#language-text").value, "en");
  setTranslation("text", "Laatikon teksti");
  await click('[data-tab="events"]');
  await click('[data-add="event"]');
  assert.equal($("#language-label").value, "en");
  setTranslation("label", "Tapahtuman teksti");
  chooseTextLanguage("label", "en");
  assert.equal($("#field-label").value, "A moment in time");
  await click("#save");
  assert.equal(
    serverDoc.events.at(-1).translations.fi.label,
    "Tapahtuman teksti",
  );
  assert.equal(
    serverDoc.overlays.at(-1).translations.fi.text,
    "Laatikon teksti",
  );
  await click('[data-tab="bars"]');
  await click('#layer-list [data-id="egypt"]');
  await click("#add-height-period");
  const periodHeight = $('[data-period-field="height"]');
  periodHeight.value = "72";
  periodHeight.onchange();
  await click("#save");
  assert.equal(serverDoc.bars[0].heightPeriods[0].height, 72);
  const periodStart = serverDoc.bars[0].heightPeriods[0].start;
  const tabKey = (selector, shiftKey = false) => {
    const control = $(selector);
    control.focus();
    control.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  };
  $('[data-period-field="height"]').value = "74";
  tabKey('[data-period-field="height"]');
  assert.equal(
    document.activeElement.dataset.removePeriod,
    serverDoc.bars[0].heightPeriods[0].id,
  );
  await click("#save");
  assert.equal(serverDoc.bars[0].heightPeriods[0].height, 74);
  await click("[data-remove-period]");
  assert.equal(document.querySelectorAll("[data-height-period]").length, 0);
  await click("#undo");
  assert.equal(document.querySelectorAll("[data-height-period]").length, 1);
  await click('[data-tab="bars"]');
  await click('[data-add="branch"]');
  setField("fromYear", -1);
  setField("toYear", -200);
  await click("#save");
  assert.equal(serverDoc.branches.length, 1);
  assert.equal(serverDoc.branches[0].fromYear, -1);
  const branchId = serverDoc.branches[0].id;
  assert.equal(
    $(`#layer-list [data-id="${branchId}"]`).closest("[data-source-bar]")
      .dataset.sourceBar,
    "egypt",
  );
  assert.ok($('[data-tab="bars"]').classList.contains("active"));
  setField("fromBarId", "jewish");
  assert.equal(
    $(`#layer-list [data-id="${branchId}"]`).closest("[data-source-bar]")
      .dataset.sourceBar,
    "jewish",
  );
  await click('[data-toggle-bar="jewish"]');
  assert.equal($("#branches-jewish").hidden, true);
  await click('[data-toggle-bar="jewish"]');
  await click(`#layer-list [data-id="${branchId}"]`);
  setField("fromBarId", "egypt");
  await click('[data-tab="bars"]');
  await click('#layer-list [data-id="egypt"]');
  await click('[data-tab="events"]');
  await click('#layer-list [data-id="event1"]');
  setField("year", -1);
  setField("endBarId", "egypt");
  assert.equal($("#field-endEdge").value, "center");
  setField("endEdge", "bottom");
  await click('[data-tab="bars"]');
  await click('#layer-list [data-id="egypt"]');
  $("#field-y").value = "250";
  tabKey("#field-y");
  assert.equal(document.activeElement.id, "field-height");
  $("#field-height").value = "32";
  tabKey("#field-height", true);
  assert.equal(document.activeElement.id, "field-y");
  assert.equal($("#field-height").value, "32");
  await click("#document-settings");
  $("#field-labelInterval").value = "1000";
  tabKey("#field-labelInterval");
  assert.equal(document.activeElement.id, "field-minorTickInterval");
  $("#field-minorTickInterval").value = "100";
  tabKey("#field-minorTickInterval");
  assert.equal(document.activeElement.id, "field-majorGrid");
  setField("majorGrid", "true");
  $("#field-title").value = "Pending title via Tab";
  tabKey("#field-title");
  assert.equal(document.activeElement.id, "field-slug");
  tabKey("#field-slug", true);
  assert.equal(document.activeElement.id, "field-title");
  assert.equal($("#field-title").value, "Pending title via Tab");
  tabKey("#field-title", true);
  assert.equal(document.activeElement.id, "language-title");
  tabKey("#language-title");
  assert.equal(document.activeElement.id, "field-title");
  await click('[data-tab="bars"]');
  await click('#layer-list [data-id="egypt"]');
  const oldStart = Number($("#field-start").value);
  dragElement('#canvas [data-id="egypt"] path', 40, 10);
  assert.equal(Number($("#field-start").value), oldStart);
  dragElement('#canvas [data-id="egypt"] path', 2 * UNIT * fitZoom, 5, true);
  await click("#save");
  assert.equal(serverDoc.labelInterval, 1000);
  assert.equal(serverDoc.minorTickInterval, 100);
  assert.equal(serverDoc.majorGrid, true);
  assert.equal(serverDoc.branches[0].fromYear, 2);
  assert.equal(serverDoc.events[0].year, 2);
  assert.equal(serverDoc.events[0].endBarId, "egypt");
  assert.equal(serverDoc.bars[0].heightAlignment, "bottom");
  assert.equal(serverDoc.branches[0].toYear, -200);
  assert.equal(
    ordinal(serverDoc.bars[0].heightPeriods[0].start) - ordinal(periodStart),
    2,
  );
  await click("#delete-element");
  await click("#save");
  assert.equal(serverDoc.branches.length, 0);
  assert.equal(serverDoc.events[0].endBarId, undefined);
  assert.ok(Number.isFinite(serverDoc.events[0].endY));
  await click("#undo");
  await click("#save");
  assert.equal(serverDoc.branches.length, 1);
  await click('[data-tab="events"]');
  await click('#layer-list [data-id="event1"]');
  setField("startBarId", "@top");
  assert.equal($("#field-y"), null);
  setField("endBarId", "@bottom");
  await click("#save");
  assert.equal(serverDoc.events[0].startAxis, "top");
  assert.equal(serverDoc.events[0].endAxis, "bottom");
  assert.equal(serverDoc.events[0].endBarId, undefined);
  assert.equal(
    Number($('#canvas [data-id="event1"] line').getAttribute("y1")),
    55,
  );
  assert.equal(
    Number($('#canvas [data-id="event1"] line').getAttribute("y2")),
    serverDoc.height - 50,
  );
  setField("startBarId", "egypt");
  setField("startEdge", "top");
  setField("endBarId", "jewish");
  setField("endEdge", "bottom");
  await click("#save");
  assert.equal(serverDoc.events[0].startBarId, "egypt");
  assert.equal(serverDoc.events[0].endBarId, "jewish");
  setField("endBarId", "islam");
  assert.equal($("#field-endBarId").value, "jewish");
  const anchoredStart = Number(
    $('#canvas [data-id="event1"] line').getAttribute("y1"),
  );
  const anchoredEnd = Number(
    $('#canvas [data-id="event1"] line').getAttribute("y2"),
  );
  await click('[data-tab="bars"]');
  await click('#layer-list [data-id="egypt"]');
  dragElement(
    '#canvas [data-id="egypt"] path',
    10000 * UNIT * fitZoom,
    0,
    true,
  );
  await click("#save");
  assert.equal(
    serverDoc.events[0].year,
    serverDoc.bars.find((b) => b.id === "jewish").end,
  );
  await click("#undo");
  await click("#delete-element");
  await click("#save");
  assert.equal(serverDoc.events[0].startBarId, undefined);
  assert.equal(serverDoc.events[0].endBarId, "jewish");
  assert.equal(
    Number($('#canvas [data-id="event1"] line').getAttribute("y1")),
    anchoredStart,
  );
  assert.equal(
    Number($('#canvas [data-id="event1"] line').getAttribute("y2")),
    anchoredEnd,
  );
  await click("#undo");
  await click('[data-tab="events"]');
  await click('#layer-list [data-id="event1"]');
  setField("startBarId", "");
  setField("endBarId", "");
  assert.ok($("#field-startY"));
  assert.ok($("#field-endY"));
  dom.window.close();
});
