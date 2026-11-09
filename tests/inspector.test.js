import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { wireInspectorNavigation } from "../chronosmos/static/inspector-focus.js";

test("Tab follows fields added by a commit, skips unavailable controls and can leave Properties in both directions", () => {
  const dom = new JSDOM(
    '<button id="before">Before</button><aside id="inspector"><input id="first" value="old"><input disabled id="disabled"><div hidden><input id="hidden"></div><input id="last"></aside><button id="after">After</button>',
  );
  const $ = (s) => dom.window.document.querySelector(s);
  const inspector = $("#inspector");
  wireInspectorNavigation(inspector);
  let saved;
  const first = $("#first");
  first.onchange = () => {
    saved = first.value;
    inspector.innerHTML = `<input id="first"><textarea id="inserted"></textarea><input disabled><input id="last">`;
    $("#first").value = saved;
  };
  const tab = (selector, shiftKey = false) => {
    $(selector).focus();
    $(selector).dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
    return dom.window.document.activeElement.id;
  };
  first.value = "Pending edit";
  assert.equal(tab("#first"), "inserted");
  assert.equal(saved, "Pending edit");
  assert.equal(tab("#inserted", true), "first");
  assert.equal(tab("#first", true), "before");
  assert.equal(tab("#last"), "after");
  dom.window.close();
});

test("a select change keeps focus through a rebuild so the following Tab reaches the next field", async () => {
  const dom = new JSDOM(
    '<aside id="inspector"><select id="source"><option>Top</option><option>Bottom</option></select><input id="next"></aside>',
  );
  const doc = dom.window.document,
    inspector = doc.querySelector("#inspector");
  wireInspectorNavigation(inspector);
  const select = doc.querySelector("#source");
  select.focus();
  select.onchange = () => {
    inspector.innerHTML =
      '<select id="source"><option>Bottom</option></select><input id="next">';
  };
  select.value = "Bottom";
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await Promise.resolve();
  assert.equal(doc.activeElement.id, "source");
  doc.activeElement.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(doc.activeElement.id, "next");
  dom.window.close();
});
