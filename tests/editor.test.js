import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

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
  await click('[data-add="bar"]');
  assert.equal(document.querySelectorAll(".layer-row").length, 9);
  const label = $("#field-label");
  label.value = "An edited bar";
  label.onchange();
  assert.equal($("#inspector h2").textContent, "An edited bar");
  await click("#save");
  assert.equal(serverDoc.bars.length, 9);
  assert.equal(serverDoc.bars.at(-1).label, "An edited bar");
  assert.ok(writes.every((w) => w.headers["X-CSRF-Token"] === "test"));
  await click("#undo");
  assert.equal($("#field-label").value, "New time bar");
  await click("#redo");
  assert.equal($("#field-label").value, "An edited bar");
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
  const start = $("#field-start");
  start.value = "0";
  start.onchange();
  assert.notEqual($("#field-start").value, "0");
  assert.match($("#toast").textContent, /Vuotta 0/);
  await click("#export-open");
  assert.ok($("#export-dialog").open);
  assert.ok($('[data-export="svg"]'));
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
  dom.window.close();
});
