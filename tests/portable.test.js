import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

test("caption controls, dragging and package export/import preserve the current document and open a new draft", async () => {
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
    `<meta name="csrf-token" content="test"><body>${html}<div id="toast"></div></body>`,
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
    "FormData",
  ])
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
      writable: true,
    });
  document.body.dataset.page = "editor";
  const $ = (s) => document.querySelector(s);
  Object.defineProperty($("#canvas-viewport"), "clientWidth", { value: 1100 });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function (value = "") {
    this.returnValue = value;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
  let stored = structuredClone(sample),
    packaged,
    imported = false;
  const original = structuredClone(stored);
  globalThis.fetch = async (path, options = {}) => {
    const body =
      options.body instanceof FormData
        ? options.body
        : options.body
          ? JSON.parse(options.body)
          : null;
    let result;
    if (path === "/api/timelines?editor=1")
      result = [
        { id: "abc", title: stored.title },
        ...(imported ? [{ id: "copy", title: "Imported copy" }] : []),
      ];
    else if (path === "/api/timelines/abc?editor=1")
      result = { document: stored, revision: 1, published: false };
    else if (path === "/api/timelines/abc" && options.method === "PUT") {
      stored = structuredClone(body.document);
      result = { id: "abc", revision: 2 };
    } else if (path === "/api/packages/export") {
      packaged = structuredClone(body);
      return {
        ok: true,
        blob: async () =>
          new Blob(["zip contents"], { type: "application/zip" }),
      };
    } else if (path === "/api/packages/import") {
      assert.ok(body instanceof FormData);
      assert.equal(body.get("file").name, "timeline.chronosmos.zip");
      imported = true;
      result = {
        id: "copy",
        revision: 1,
        document: {
          ...structuredClone(packaged),
          title: "Imported copy",
          slug: "imported-copy",
        },
        mediaCount: 0,
      };
    } else throw new Error("Unexpected API " + path);
    return { ok: true, json: async () => structuredClone(result) };
  };
  await import("../chronosmos/static/app.js");
  const click = async (selector) => {
    assert.ok($(selector), selector);
    await $(selector).onclick?.(new Event("click"));
  };
  const set = (field, value) => {
    const input = $("#field-" + field);
    assert.ok(input, field);
    input.value = String(value);
    input.onchange();
  };
  await click('#layer-list [data-id="egypt"]');
  assert.equal($("#field-captionFontMode").value, "auto");
  set("captionPosition", "right");
  set("captionFontMode", "fixed");
  set("captionFontSize", 26);
  set("captionOffsetX", 30);
  assert.equal(
    $('#canvas [data-id="egypt"] text').getAttribute("clip-path"),
    null,
  );
  assert.equal(
    $('#canvas [data-id="egypt"] text').getAttribute("font-size"),
    "26",
  );
  assert.equal($("#field-showCaption").type, "checkbox");
  assert.equal($("#field-showCaption").checked, true);
  $("#field-showCaption").checked = false;
  $("#field-showCaption").onchange();
  assert.equal($('#canvas [data-id="egypt"] text'), null);
  assert.equal(
    $('#layer-list [data-id="egypt"] strong').textContent,
    sample.bars[0].label,
  );
  await click('[data-tab="overlays"]');
  await click('[data-add="brace"]');
  set("topText", "Beginning");
  set("text", "Middle");
  set("bottomText", "End");
  const translate = (key, value) => {
    const control = $("#language-" + key);
    control.value = "fi";
    control.onchange();
    set(key, value);
  };
  translate("topText", "Alku");
  assert.equal($("#language-text").value, "en");
  assert.equal($("#language-bottomText").value, "en");
  translate("text", "Ryhmä");
  translate("bottomText", "Loppu");
  assert.equal(
    $('#field-anchorBarId option[value="egypt"]').textContent,
    sample.bars[0].label,
  );
  set("anchorBarId", "egypt");
  set("year", -1);
  set("height", 400);
  const bracket = $('#canvas [data-kind="overlays"] .curly-bracket');
  assert.ok(bracket.getAttribute("d").endsWith("0,400"));
  assert.equal(
    $('#canvas [data-brace-caption="top"]').textContent,
    "Beginning",
  );
  await click('[data-tab="events"]');
  await click('#layer-list [data-id="event1"]');
  assert.equal($("#field-dotted").type, "checkbox");
  $("#field-dotted").checked = true;
  $("#field-dotted").onchange();
  assert.equal(
    $('#canvas [data-id="event1"] line').getAttribute("stroke-dasharray"),
    `0 ${Number($("#field-width").value) * 3}`,
  );
  set("labelPosition", "center");
  const oldYear = Number($("#field-year").value);
  const oldY = Number($('#canvas [data-id="event1"] text').getAttribute("y"));
  $("#canvas").setPointerCapture = () => {};
  const pointer = (type, x, y) =>
    new dom.window.MouseEvent(type, {
      clientX: x,
      clientY: y,
      bubbles: true,
      button: 0,
    });
  $('#canvas [data-id="event1"] text').dispatchEvent(
    pointer("pointerdown", 200, 100),
  );
  $("#canvas").dispatchEvent(pointer("pointermove", 230, 140));
  $("#canvas").dispatchEvent(pointer("pointerup", 230, 140));
  assert.equal($("#field-labelPosition").value, "free");
  assert.equal(Number($("#field-labelY").value), oldY + 40);
  assert.equal(Number($("#field-labelOffsetX").value), 37);
  assert.equal(Number($("#field-year").value), oldYear);
  await click("#export-open");
  let download;
  URL.createObjectURL = (blob) => {
    download = blob;
    return "blob:test";
  };
  URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () {};
  await click('[data-export="package"]');
  assert.equal(await download.text(), "zip contents");
  assert.equal(packaged.bars[0].captionPosition, "right");
  assert.equal(packaged.bars[0].captionFontSize, 26);
  assert.equal(packaged.events[0].labelPosition, "free");
  assert.equal(packaged.events[0].dotted, true);
  assert.equal(packaged.bars[0].showCaption, false);
  const brace = packaged.overlays.find((o) => o.type === "brace");
  assert.equal(brace.height, 400);
  assert.deepEqual(brace.translations.fi, {
    topText: "Alku",
    text: "Ryhmä",
    bottomText: "Loppu",
  });
  assert.deepEqual(stored, original); // Export includes edits without saving the original.
  $("#export-dialog").close();
  const file = new dom.window.File(
    ["zip contents"],
    "timeline.chronosmos.zip",
    { type: "application/zip" },
  );
  Object.defineProperty($("#import-file"), "files", { value: [file] });
  const loading = $("#import-file").onchange({ target: $("#import-file") });
  await Promise.resolve();
  $("#confirm-dialog").close("yes");
  await loading;
  assert.equal(location.search, "?timeline=copy&lang=en");
  assert.equal($("#save-status").textContent, "Draft saved");
  assert.equal($("#field-title").value, "Imported copy");
  assert.deepEqual(stored, original);
  dom.window.close();
});
