import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  pixelsPerYear,
  dimensions,
  ordinal,
  PAD,
} from "../chronosmos/static/timeline.js";

test("manage opens a chooser without auto-loading, creates and saves geological timelines, and returns after deletion", async () => {
  const html = readFileSync(
    new URL("../chronosmos/templates/editor.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(
    `<meta name="csrf-token" content="test"><body>${html}<div id="toast"></div></body>`,
    { url: "http://localhost/manage" },
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
  let stored = null,
    deleted = false;
  const calls = [];
  globalThis.fetch = async (path, options = {}) => {
    calls.push(path);
    let result;
    if (path === "/api/timelines?editor=1")
      result = deleted
        ? []
        : [
            {
              id: "first",
              title: "First timeline",
              slug: "first",
              published: true,
            },
            {
              id: "draft",
              title: "Private <draft>",
              slug: "draft",
              published: false,
            },
          ];
    else if (path === "/api/timelines" && options.method === "POST") {
      stored = JSON.parse(options.body);
      result = { id: "created", revision: 1 };
    } else if (
      path === "/api/timelines/created" &&
      options.method === "DELETE"
    ) {
      deleted = true;
      result = { ok: true };
    } else throw new Error(`Unexpected request: ${path}`);
    return { ok: true, json: async () => structuredClone(result) };
  };
  await import("../chronosmos/static/app.js");
  const $ = (s) => document.querySelector(s);
  assert.equal($("#timeline-chooser").hidden, false);
  assert.equal($("#editor-workspace").hidden, true);
  assert.deepEqual(calls, ["/api/timelines?editor=1"]);
  assert.equal(document.querySelectorAll(".managed-timeline").length, 2);
  assert.equal(
    $(".managed-timeline").getAttribute("href"),
    "/manage?timeline=first",
  );
  assert.equal(
    document.querySelectorAll(".managed-timeline")[1].querySelector("strong")
      .textContent,
    "Private <draft>",
  );
  await $("#create-timeline").onclick();
  assert.equal(location.search, "?timeline=new");
  assert.equal($("#timeline-chooser").hidden, true);
  assert.equal($("#editor-workspace").hidden, false);
  const set = (key, value) => {
    const input = $("#field-" + key);
    input.value = String(value);
    input.onchange();
  };
  set("title", "Earth history");
  set("start", -65000000);
  set("timeUnit", "millions");
  set("mmPerYear", 10);
  assert.equal($("#field-mmPerYear").value, "10");
  assert.match($("#field-mmPerYear").parentElement.textContent, /per million/);
  await $("#save").onclick();
  assert.equal(stored.title, "Earth history");
  assert.equal(stored.start, -65000000);
  assert.equal(stored.timeUnit, "millions");
  assert.equal(stored.mmPerYear, 0.00001);
  assert.equal(location.search, "?timeline=created");
  assert.ok(parseFloat($("#canvas svg").style.width) < 10000);
  assert.equal(parseFloat($("#canvas svg").style.height), 820);
  $("#field-labelInterval").focus();
  $("#field-labelInterval").dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(document.activeElement.id, "field-minorTickInterval");
  assert.equal($("#save-status").textContent, "Draft saved");
  set("timeUnit", "years");
  assert.equal(Number($("#field-mmPerYear").value), 0.00001);
  await $('[data-add="bar"]').onclick();
  const oldStart = Number($("#field-start").value);
  const zoom =
    (parseFloat($("#canvas svg").style.width) - PAD * 2) /
    (dimensions(stored).width - PAD * 2);
  const dx = pixelsPerYear(stored) * zoom * 1000000;
  $("#canvas").setPointerCapture = () => {};
  const pointer = (type, x, y) =>
    new dom.window.MouseEvent(type, {
      clientX: x,
      clientY: y,
      bubbles: true,
      button: 0,
      shiftKey: true,
    });
  $("#canvas [data-kind=bars] path").dispatchEvent(
    pointer("pointerdown", 200, 100),
  );
  $("#canvas").dispatchEvent(pointer("pointermove", 200 + dx, 110));
  $("#canvas").dispatchEvent(pointer("pointerup", 200 + dx, 110));
  assert.equal(
    ordinal(Number($("#field-start").value)) - ordinal(oldStart),
    1000000,
  );
  assert.equal(Number($("#field-y").value), 140);
  await $("#document-settings").onclick();
  const deletion = $("#delete-timeline").onclick();
  await Promise.resolve();
  $("#confirm-dialog").close("yes");
  await deletion;
  assert.equal(location.search, "");
  assert.equal($("#timeline-chooser").hidden, false);
  assert.equal($("#editor-workspace").hidden, true);
  assert.equal(document.querySelectorAll(".managed-timeline").length, 0);
  assert.match($("#managed-timelines").textContent, /first timeline/);
  dom.window.close();
});
