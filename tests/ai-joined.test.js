import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  dimensions,
  xFor,
  ordinal,
  pixelsPerYear,
  PAD,
} from "../chronosmos/static/timeline.js";
import { moveBars } from "../chronosmos/static/bar-motion.js";

test("AI creates a reviewable draft, adds bars, and joined sections drag both bars with keyboard editing and undo", async () => {
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
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  let stored = null,
    promptCount = 0,
    writes = 0;
  const source = {
    url: "https://example.org/reference",
    title: "Archive chronology",
  };
  const proposal = () => ({
    title: "Researched chronology",
    description: "Dates with evidence",
    model: "gpt-6.1-sol",
    checkedAt: "2026-11-10",
    bars:
      promptCount === 1
        ? [
            {
              label: "First",
              start: -100,
              end: 100,
              note: "Approximate boundary",
              sources: [source],
            },
            {
              label: "Second",
              start: -50,
              end: 150,
              note: "Documented dates",
              sources: [source],
            },
            {
              label: "Unselected",
              start: 1,
              end: 20,
              note: "Review",
              sources: [source],
            },
          ]
        : [
            {
              label: "New bar",
              start: 1,
              end: 120,
              note: "A new interval",
              sources: [source],
            },
          ],
  });
  globalThis.fetch = async (path, options = {}) => {
    let result;
    if (path === "/api/timelines?editor=1")
      result = stored ? [{ id: "created", title: stored.title }] : [];
    else if (path === "/api/ai/status")
      result = { configured: true, model: "gpt-6.1-sol" };
    else if (path === "/api/ai/jobs") {
      promptCount++;
      const input = JSON.parse(options.body);
      assert.equal(input.document === null, promptCount === 1);
      result = { job: "job" + promptCount };
    } else if (path.startsWith("/api/ai/jobs/"))
      result = { status: "completed", proposal: proposal() };
    else if (path === "/api/timelines" || path === "/api/timelines/created") {
      writes++;
      const body = JSON.parse(options.body);
      stored = structuredClone(body.document ?? body);
      result = { id: "created", revision: writes };
    } else throw Error(path);
    return { ok: true, json: async () => result };
  };
  await import("../chronosmos/static/app.js");
  const $ = (s) => document.querySelector(s),
    click = async (s) => {
      assert.ok($(s), s);
      await $(s).onclick(new Event("click"));
    };
  await click("#chooser-ai");
  $("#ai-prompt").value =
    "Research these two historical intervals with sources";
  await $("#ai-form").onsubmit(new Event("submit"));
  assert.equal(writes, 0);
  assert.equal($("#editor-workspace").hidden, true);
  assert.equal(document.querySelectorAll(".ai-bar").length, 3);
  assert.equal($(".research a").href, source.url);
  $('[data-ai-bar="2"]').checked = false;
  await click("#ai-apply");
  assert.equal(document.querySelectorAll(".layer-row").length, 2);
  assert.equal(writes, 0);
  await click("#save");
  assert.equal(stored.title, "Researched chronology");
  assert.equal(stored.bars.length, 2);
  assert.deepEqual(stored.bars[0].research.sources, [source]);
  await click("#ai-open");
  $("#ai-prompt").value = "Add a third researched bar to the timeline";
  await $("#ai-form").onsubmit(new Event("submit"));
  await click("#ai-apply");
  await click("#save");
  assert.equal(stored.bars.length, 3);
  assert.equal(stored.title, "Researched chronology");
  const a = stored.bars[0],
    b = stored.bars[1];
  await click(`#layer-list [data-id="${a.id}"]`);
  await click("#add-joined-period");
  const setJoin = (key, value) => {
    const input = $(`[data-join-field="${key}"]`);
    input.value = value;
    input.onchange();
  };
  setJoin("transitionYears", 5);
  setJoin("start", -20);
  setJoin("end", 50);
  // Tab commits and targets the replacement DOM control, including Shift+Tab.
  $('[data-join-field="start"]').focus();
  $('[data-join-field="start"]').dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(document.activeElement.dataset.joinField, "end");
  document.activeElement.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(document.activeElement.dataset.joinField, "start");
  await click("#save");
  assert.equal(stored.joinedPeriods.length, 1);
  $("#canvas").setPointerCapture = () => {};
  const pointer = (type, x, y, shiftKey = false) =>
    new dom.window.MouseEvent(type, {
      clientX: x,
      clientY: y,
      button: 0,
      bubbles: true,
      shiftKey,
    });
  const drag = (year, dy, years = 0) => {
    const scale =
      (Number.parseFloat($("#canvas svg").style.width) - PAD * 2) /
      ((ordinal(stored.end) - ordinal(stored.start)) * pixelsPerYear(stored));
    const x = xFor(stored, year, scale);
    $(`#canvas [data-id="${a.id}"] path`).dispatchEvent(
      pointer("pointerdown", x, 150, !!years),
    );
    $("#canvas").dispatchEvent(
      pointer(
        "pointermove",
        x + years * pixelsPerYear(stored) * scale,
        150 + dy,
        !!years,
      ),
    );
    $("#canvas").dispatchEvent(
      pointer(
        "pointerup",
        x + years * pixelsPerYear(stored) * scale,
        150 + dy,
        !!years,
      ),
    );
  };
  drag(1, 20);
  await click("#save");
  assert.equal(stored.bars[0].y, a.y + 20);
  assert.equal(stored.bars[1].y, b.y + 20);
  drag(1, 0, 10);
  await click("#save");
  assert.equal(stored.joinedPeriods[0].start, -10);
  assert.equal(stored.joinedPeriods[0].end, 60);
  assert.equal(stored.bars[0].start, -90);
  assert.equal(stored.bars[1].start, -40);
  await click("#undo");
  await click("#save");
  assert.equal(stored.joinedPeriods[0].start, -20);
  // A drag outside the joined span moves only the selected bar.
  const before = structuredClone(stored);
  drag(-80, 10);
  await click("#save");
  assert.equal(stored.bars[0].y, before.bars[0].y + 10);
  assert.equal(stored.bars[1].y, before.bars[1].y);
  await click("#delete-element");
  await click("#save");
  assert.equal(stored.joinedPeriods.length, 0);
  dom.window.close();
});

test("paired moves shift dates, height periods, anchors, events and branches once, preserving year-zero semantics", () => {
  const bar = (id, y) => ({
    id,
    start: -10,
    end: 10,
    y,
    height: 32,
    captionYear: -1,
    heightPeriods: [{ id: "height", start: -2, end: 2, height: 50 }],
  });
  const before = {
    height: 400,
    bars: [bar("a", 100), bar("b", 200), bar("c", 280)],
    overlays: [{ id: "o", anchorBarId: "b", year: -1 }],
    events: [{ id: "e", year: -1, startBarId: "a", endBarId: "b" }],
    branches: [
      { id: "branch", fromBarId: "a", toBarId: "b", fromYear: -1, toYear: 1 },
    ],
    joinedPeriods: [
      {
        id: "join",
        fromBarId: "a",
        toBarId: "b",
        start: -2,
        end: 2,
        transitionYears: 1,
      },
    ],
  };
  const d = structuredClone(before);
  moveBars(d, before, ["a", "b"], 25, 1);
  assert.equal(d.bars[0].captionYear, 1);
  assert.equal(d.bars[1].y, 225);
  assert.equal(d.overlays[0].year, 1);
  assert.equal(d.events[0].year, 1);
  assert.equal(d.branches[0].fromYear, 1);
  assert.equal(d.branches[0].toYear, 2);
  assert.equal(d.joinedPeriods[0].start, -1);
  assert.equal(d.joinedPeriods[0].end, 3);
  assert.equal(d.bars[0].heightPeriods[0].start, -1);
  assert.equal(d.bars[2].start, -10);
  const single = structuredClone(before);
  moveBars(single, before, ["a"], 0, 100);
  assert.equal(single.bars[0].start, -2);
  assert.deepEqual(single.joinedPeriods, before.joinedPeriods);
});
