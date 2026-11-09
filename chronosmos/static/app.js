import { t, language, translate, toggleLanguage } from "./i18n.js";
import {
  renderTimeline,
  dimensions,
  ordinal,
  historical,
  yearLabel,
  UNIT,
  PAD,
  esc,
} from "./timeline.js";

const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const page = document.body.dataset.page;
let doc = null,
  ident = null,
  revision = 0,
  published = false,
  publishedSlug = null,
  projects = [],
  selected = null,
  tab = "bars",
  zoom = 1,
  savedRaw = "",
  undoStack = [],
  redoStack = [],
  busy = false,
  preview = false;
let toastTimer;
function toast(message, error = false) {
  const e = $("#toast");
  e.textContent = message;
  e.classList.toggle("error", error);
  e.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => e.classList.remove("visible"),
    error ? 12000 : 4000,
  );
}
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        ...(!(options.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        "X-CSRF-Token": $('meta[name="csrf-token"]')?.content || "",
        ...options.headers,
      },
    });
  } catch {
    throw new Error(t("networkError"));
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      response.status === 401 ? t("sessionExpired") : body.error || t("error"),
    );
  return body;
}
const action =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      toast(e.message, true);
    }
  };
async function transaction(fn) {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  try {
    await fn();
  } finally {
    busy = false;
    document.body.classList.remove("busy");
    updateStatus();
  }
}
const raw = () => JSON.stringify(doc),
  dirty = () => doc && raw() !== savedRaw;
const uid = () => crypto.randomUUID().replaceAll("-", "");
function checkpoint() {
  if (!doc) return;
  undoStack.push(raw());
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
}
function change(fn) {
  checkpoint();
  fn();
  renderEditor();
}
function updateStatus() {
  if (page !== "editor") return;
  $("#save-status").textContent = busy
    ? t("saving")
    : dirty()
      ? t("unsaved")
      : doc
        ? t("saved")
        : "";
  $("#save-status").classList.toggle("dirty", !!dirty());
  $("#publication-status").textContent = published ? t("live") : t("draft");
  $("#publication-status").classList.toggle("published", published);
  $("#undo").disabled = !undoStack.length;
  $("#redo").disabled = !redoStack.length;
  ["#save", "#publish", "#export-open", "#preview"].forEach(
    (s) => ($(s).disabled = !doc || busy),
  );
}
function yearRange(d) {
  return `${yearLabel(d.start, language)} — ${yearLabel(d.end, language)}`;
}
function resizeCanvas() {
  if (!doc) return;
  const svg = $("#canvas svg");
  if (!svg) return;
  const dim = dimensions(doc, zoom);
  svg.style.width = `${dim.width}px`;
  svg.style.height = `${dim.height}px`;
  $("#zoom-value").textContent = `${Math.round(zoom * 100)}%`;
}
function fit() {
  if (!doc) return;
  zoom = Math.min(
    2,
    Math.max(
      0.05,
      ($("#canvas-viewport").clientWidth - 64 - PAD * 2) /
        (dimensions(doc).width - PAD * 2),
    ),
  );
  renderCanvas();
}
function setZoom(value, anchor = null) {
  if (!doc) return;
  const viewport = $("#canvas-viewport"),
    old = zoom,
    oldScrollLeft = viewport.scrollLeft;
  zoom = Math.min(32, Math.max(0.05, value));
  renderCanvas();
  if (anchor) {
    const origin = $("#canvas").offsetLeft + PAD;
    viewport.scrollLeft =
      origin + ((oldScrollLeft + anchor.x - origin) * zoom) / old - anchor.x;
  }
}
function renderCanvas() {
  if (!doc) {
    $("#canvas").innerHTML = "";
    return;
  }
  $("#canvas").innerHTML = renderTimeline(doc, {
    selected: page === "editor" && !preview ? selected : null,
    language,
    interactive: page === "editor" && !preview,
    horizontalScale: zoom,
  });
  resizeCanvas();
}
function wireZoom() {
  if (!$("#canvas-viewport")) return;
  $("#zoom-in").onclick = () => setZoom(zoom * 1.25);
  $("#zoom-out").onclick = () => setZoom(zoom / 1.25);
  $("#zoom-fit").onclick = fit;
  $("#canvas-viewport").addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), {
          x: e.clientX - r.left,
        });
      }
    },
    { passive: false },
  );
}
function button(label, attrs = "") {
  return `<button ${attrs}>${esc(t(label))}</button>`;
}
function closeButton() {
  return button(
    "close",
    'class="dialog-close" data-close aria-label="' + esc(t("close")) + '"',
  );
}
function wireDialog(el) {
  el.querySelectorAll("[data-close]").forEach(
    (b) => (b.onclick = () => el.close()),
  );
  el.onclick = (e) => {
    if (e.target === el) {
      const r = el.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        el.close();
    }
  };
}
async function confirmAction(message) {
  const dialog = $("#confirm-dialog");
  dialog.innerHTML = `${closeButton()}<h2>${esc(message)}</h2><div class="dialog-actions">${button("cancel", "data-cancel")}${button("confirm", 'class="primary" data-confirm')}</div>`;
  return new Promise((resolve) => {
    dialog.onclose = () => resolve(dialog.returnValue === "yes");
    wireDialog(dialog);
    dialog.querySelector("[data-cancel]").onclick = () => dialog.close("no");
    dialog.querySelector("[data-confirm]").onclick = () => dialog.close("yes");
    dialog.returnValue = "no";
    dialog.showModal();
  });
}

async function initGallery() {
  const items = await api("/api/timelines");
  $("#timeline-count").textContent = String(items.length).padStart(2, "0");
  $("#gallery").innerHTML = items.length
    ? items
        .map(
          (item, i) =>
            `<a class="timeline-card" href="/${esc(item.slug)}"><div class="card-art art-${i % 3}"><span class="card-number">${String(i + 1).padStart(2, "0")}</span><div class="art-band band-a"></div><div class="art-band band-b"></div><div class="art-band band-c"></div><div class="art-band band-d"></div><div class="art-line"></div><span class="art-year">${esc(yearLabel(item.start, language))}</span><span class="art-year end">${esc(yearLabel(item.end, language))}</span></div><div class="card-body"><div class="eyebrow">${esc(yearRange(item))} <span>· ${item.bars} ${esc(t("barCount"))}</span></div><h2>${esc(item.title)}</h2><p>${esc(item.description)}</p><span class="card-link">${esc(t("openTimeline"))} <span>↗</span></span></div></a>`,
        )
        .join("")
    : `<div class="empty-state">${esc(t("noTimelines"))}</div>`;
}
async function initViewer() {
  const data = await api("/api/timelines/" + $("#viewer").dataset.timelineId);
  doc = data.document;
  $("#viewer-title").textContent = doc.title;
  document.title = doc.title + " · Chronosmos";
  $("#viewer-description").textContent = doc.description;
  $("#viewer-range").textContent = yearRange(doc);
  renderCanvas();
  fit();
}
async function refreshProjects() {
  projects = await api("/api/timelines?editor=1");
  renderProjectPicker();
}
function renderProjectPicker() {
  const picker = $("#project-select");
  picker.innerHTML =
    `<option value="">${esc(t("chooseTimeline"))}</option>` +
    projects
      .map((p) => `<option value="${p.id}">${esc(p.title)}</option>`)
      .join("");
  if (doc && !ident)
    picker.insertAdjacentHTML(
      "beforeend",
      `<option value="new">${esc(doc.title)} *</option>`,
    );
  picker.value = ident || (doc ? "new" : "");
}
async function loadProject(id) {
  if (dirty() && !(await confirmAction(t("leaveQuestion")))) {
    renderProjectPicker();
    return;
  }
  if (!id || id === "new") {
    renderProjectPicker();
    return;
  }
  const data = await api(`/api/timelines/${id}?editor=1`);
  doc = data.document;
  ident = id;
  revision = data.revision;
  published = data.published;
  publishedSlug = data.publishedSlug;
  savedRaw = raw();
  undoStack = [];
  redoStack = [];
  selected = null;
  renderEditor();
  fit();
  history.replaceState(null, "", "#" + id);
}
async function newProject() {
  if (dirty() && !(await confirmAction(t("leaveQuestion")))) return;
  doc = {
    version: 1,
    title: t("nameNew"),
    description: "",
    slug: t("newPath") + "-" + uid().slice(0, 6),
    start: -1000,
    end: 2026,
    mmPerYear: 0.35,
    height: 820,
    scale: "both",
    background: "#faf8f2",
    bars: [],
    overlays: [],
    events: [],
  };
  ident = null;
  revision = 0;
  published = false;
  publishedSlug = null;
  savedRaw = "";
  undoStack = [];
  redoStack = [];
  selected = null;
  renderProjectPicker();
  renderEditor();
  fit();
}
function selectedItem() {
  return selected && doc?.[selected.kind]?.find((o) => o.id === selected.id);
}
function renderEditor() {
  renderProjectPicker();
  $("#empty-canvas").hidden = !!doc;
  $("#element-count").textContent = doc
    ? doc.bars.length + doc.overlays.length + doc.events.length
    : "";
  $("#canvas-range").textContent = doc ? yearRange(doc) : "";
  renderCanvas();
  renderLayers();
  renderInspector();
  updateStatus();
}
function renderLayers() {
  const list = $("#layer-list");
  $$("[data-tab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab),
  );
  const items = doc?.[tab] || [];
  list.innerHTML = items.length
    ? items
        .map(
          (item, i) =>
            `<button class="layer-row ${selected?.id === item.id ? "selected" : ""}" data-id="${item.id}"><span class="layer-swatch ${tab === "overlays" ? "overlay-swatch" : ""}" style="background:${item.background || item.color || "#d5d1c5"}">${tab === "overlays" ? (item.type === "text" ? "T" : item.type === "box" ? "□" : "▧") : ""}</span><span class="layer-detail"><strong>${esc(item.label || item.text?.split("\n")[0] || t(item.type) || t("event"))}</strong><small>${tab === "bars" ? esc(yearLabel(item.start, language) + " — " + yearLabel(item.end, language)) : esc(yearLabel(item.year, language))}</small></span><span class="layer-index">${String(i + 1).padStart(2, "0")}</span></button>`,
        )
        .join("")
    : `<p class="subtle empty-layers">${esc(t("noLayers"))}</p>`;
  list.querySelectorAll("[data-id]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = { kind: tab, id: b.dataset.id };
        renderEditor();
      }),
  );
  $("#add-controls").innerHTML = !doc
    ? ""
    : tab === "bars"
      ? button("addBar", 'data-add="bar" class="add-layer"')
      : tab === "events"
        ? button("addEvent", 'data-add="event" class="add-layer"')
        : button("addText", 'data-add="text"') +
          button("addBox", 'data-add="box"') +
          button("addImage", 'data-add="image"');
  $$("[data-add]").forEach(
    (b) =>
      (b.onclick = action(() =>
        b.dataset.add === "image" ? openMedia(true) : addElement(b.dataset.add),
      )),
  );
}
function field(key, label, type = "text", value = "", options = {}) {
  const id = "field-" + key;
  let control;
  if (type === "select")
    control = `<select id="${id}" data-field="${key}">${options.choices.map(([v, l]) => `<option value="${esc(v)}" ${String(value) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  else if (type === "textarea")
    control = `<textarea id="${id}" data-field="${key}" rows="${options.rows || 3}" maxlength="${options.maxLength || 4000}">${esc(value)}</textarea>`;
  else
    control = `<input id="${id}" data-field="${key}" type="${type}" value="${esc(value)}" ${options.min !== undefined ? `min="${options.min}"` : ""} ${options.max !== undefined ? `max="${options.max}"` : ""} ${type === "number" ? `step="${options.step || 1}"` : ""} ${type === "text" ? `maxlength="${options.maxLength || 250}"` : ""}>`;
  return `<label class="field ${type === "color" ? "color-field" : ""}" for="${id}"><span>${esc(t(label))}</span>${control}${options.hint ? `<small>${esc(options.hint)}</small>` : ""}</label>`;
}
function renderInspector() {
  const el = $("#inspector");
  if (!doc) {
    el.innerHTML = `<div class="empty-inspector">${esc(t("emptyLibrary"))}</div>`;
    return;
  }
  const o = selectedItem();
  let html = "";
  const number = (k, l, v, min, max, step) =>
    field(k, l, "number", v, { min, max, step });
  const color = (k, l, v) => field(k, l, "color", v);
  if (!o) {
    html =
      `<h2>${esc(t("settings"))}</h2>` +
      field("title", "title", "text", doc.title, { maxLength: 160 }) +
      field("slug", "path", "text", doc.slug, {
        maxLength: 160,
        hint: t("pathHint").replace("{slug}", doc.slug),
      }) +
      field("description", "description", "textarea", doc.description) +
      `<div class="field-pair">${number("start", "start", doc.start, -100000, 100000)}${number("end", "end", doc.end, -100000, 100000)}</div><p class="field-note">${esc(t("dateHint"))}</p><div class="inspector-divider"></div>` +
      number("mmPerYear", "mmPerYear", doc.mmPerYear, 0.01, 100, 0.01) +
      `<p class="field-note">${esc(t("printHint"))}</p>` +
      number("height", "height", doc.height, 200, 4000) +
      field("scale", "scale", "select", doc.scale, {
        choices: ["top", "bottom", "both", "none"].map((v) => [v, t(v)]),
      }) +
      color("background", "background", doc.background) +
      `<div class="inspector-divider"></div>${published ? `<a class="public-link" href="/${esc(publishedSlug)}" target="_blank" rel="noopener">/${esc(publishedSlug)} ↗</a>${button("unpublish", 'id="unpublish" class="danger-text"')}` : ""}${button("deleteTimeline", 'id="delete-timeline" class="danger-text"')}`;
  } else {
    const kind = selected.kind;
    html = `<div class="eyebrow">${esc(t(kind === "bars" ? "timeBar" : kind === "events" ? "event" : o.type))}</div><h2>${esc(o.label || o.text?.split("\n")[0] || t(o.type))}</h2>`;
    if (kind === "bars") {
      html +=
        field("label", "label", "text", o.label) +
        `<div class="field-pair">${number("start", "start", o.start, -100000, 100000)}${number("end", "end", o.end, -100000, 100000)}</div><p class="field-note">${esc(t("dateHint"))}</p>` +
        number("y", "y", o.y, 60, doc.height - 60) +
        number("height", "height", o.height, 4, 160) +
        `<div class="field-pair">${color("background", "background", o.background)}${color("foreground", "foreground", o.foreground)}</div><div class="inspector-divider"></div>` +
        number("fadeIn", "fadeIn", o.fadeIn, 0, 100000) +
        number("fadeOut", "fadeOut", o.fadeOut, 0, 100000) +
        field("mergeInto", "mergeInto", "select", o.mergeInto, {
          choices: [
            ["", t("none")],
            ...doc.bars
              .filter((b) => b.id !== o.id)
              .map((b) => [b.id, b.label || t("timeBar")]),
          ],
        }) +
        (o.mergeInto
          ? number(
              "mergeYears",
              "mergeYears",
              o.mergeYears,
              1,
              Math.max(1, ordinal(o.end) - ordinal(o.start)),
            )
          : "");
    } else if (kind === "overlays") {
      if (o.type !== "image") html += field("text", "text", "textarea", o.text);
      else
        html += `<img class="inspector-image" src="/media/${o.mediaId}.png" alt="${esc(t("selectedMedia"))}">${button("changeImage", 'id="change-image"')}`;
      html +=
        number("year", "year", o.year, -100000, 100000) +
        number("y", "y", o.y, 0, doc.height) +
        `<div class="field-pair">${number("width", "width", o.width, 10, 2000)}${number("height", "height", o.height, 10, 2000)}</div>`;
      if (o.type !== "image")
        html +=
          number("fontSize", "fontSize", o.fontSize, 6, 120) +
          color("color", "color", o.color);
      if (o.type === "box") html += color("fill", "fill", o.fill);
    } else
      html +=
        field("label", "label", "text", o.label) +
        number("year", "year", o.year, -100000, 100000) +
        number("y", "y", o.y, 0, doc.height) +
        number("height", "height", o.height, 1, doc.height) +
        number("width", "width", o.width, 0.25, 20, 0.25) +
        color("color", "color", o.color) +
        field("layer", "layer", "select", o.layer, {
          choices: [
            ["under", t("under")],
            ["over", t("over")],
          ],
        });
    html += `<div class="inspector-divider"></div><div class="element-actions">${button("duplicate", 'id="duplicate"')}${button("delete", 'id="delete-element" class="danger-text"')}</div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll("[data-field]").forEach(
    (input) =>
      (input.onchange = () => {
        if (!input.reportValidity()) return;
        const target = o || doc,
          key = input.dataset.field;
        let value = input.type === "number" ? Number(input.value) : input.value;
        if (["start", "end", "year"].includes(key) && value === 0) {
          toast(t("noYearZero"), true);
          input.value = target[key];
          return;
        }
        const candidate = { ...target, [key]: value };
        if (
          "start" in candidate &&
          ordinal(candidate.start) >= ordinal(candidate.end)
        ) {
          toast("End year must be after start year.", true);
          input.value = target[key];
          return;
        }
        change(() => {
          target[key] = value;
          if (key === "height" && target === doc) {
            doc.bars.forEach((b) => (b.y = Math.min(b.y, doc.height - 60)));
            doc.events.forEach((e) => {
              e.y = Math.min(e.y, doc.height);
              e.height = Math.min(e.height, doc.height);
            });
            doc.overlays.forEach((o) => (o.y = Math.min(o.y, doc.height)));
          }
        });
      }),
  );
  if ($("#duplicate"))
    $("#duplicate").onclick = () =>
      change(() => {
        const clone = structuredClone(o);
        clone.id = uid();
        clone.y = Math.min(doc.height - 60, clone.y + 42);
        doc[selected.kind].push(clone);
        selected.id = clone.id;
      });
  if ($("#delete-element"))
    $("#delete-element").onclick = () =>
      change(() => {
        const id = o.id;
        doc[selected.kind] = doc[selected.kind].filter((i) => i.id !== id);
        doc.bars.forEach((b) => {
          if (b.mergeInto === id) b.mergeInto = "";
        });
        selected = null;
      });
  if ($("#change-image"))
    $("#change-image").onclick = action(() => openMedia(true, true));
  if ($("#unpublish"))
    $("#unpublish").onclick = action(async () => {
      if (await confirmAction(t("unpublishQuestion")))
        await transaction(async () => {
          const result = await api(`/api/timelines/${ident}/publish`, {
            method: "POST",
            body: JSON.stringify({ published: false, revision }),
          });
          revision = result.revision;
          published = false;
          publishedSlug = null;
          renderEditor();
          toast(t("unpublished"));
        });
    });
  if ($("#delete-timeline"))
    $("#delete-timeline").onclick = action(async () => {
      if (!(await confirmAction(t("deleteQuestion")))) return;
      await transaction(async () => {
        if (ident)
          await api("/api/timelines/" + ident, {
            method: "DELETE",
            body: JSON.stringify({ revision }),
          });
        doc = null;
        ident = null;
        savedRaw = "";
        selected = null;
        await refreshProjects();
        renderEditor();
      });
    });
}
function addElement(type, media = null) {
  if (!doc) return;
  change(() => {
    let o;
    const span = ordinal(doc.end) - ordinal(doc.start),
      start = historical(ordinal(doc.start) + Math.floor(span * 0.15));
    if (type === "bar") {
      o = {
        id: uid(),
        label: t("labelNew"),
        start,
        end: doc.end,
        y: Math.min(doc.height - 100, 130 + doc.bars.length * 60),
        height: 28,
        background: ["#627b9d", "#7b9475", "#c17a63", "#9783ac"][
          doc.bars.length % 4
        ],
        foreground: "#ffffff",
        fadeIn: 0,
        fadeOut: 0,
        mergeInto: "",
        mergeYears: Math.min(100, Math.floor(span / 2)),
      };
      tab = "bars";
    } else if (type === "event") {
      o = {
        id: uid(),
        label: t("eventNew"),
        year: start,
        y: 90,
        height: Math.max(1, doc.height - 180),
        width: 1,
        color: "#b5ab97",
        layer: "under",
      };
      tab = "events";
    } else {
      o = {
        id: uid(),
        type,
        year: start,
        y: Math.min(doc.height - 80, 200),
        width: 200,
        height: 80,
        text: type === "image" ? "" : t("noteNew"),
        color: "#4a4e43",
        fill: "#eee9dc",
        fontSize: 14,
        ...(media
          ? {
              mediaId: media.id,
              width: 200,
              height: Math.min(
                500,
                Math.max(10, (200 * media.height) / media.width),
              ),
            }
          : {}),
      };
      tab = "overlays";
    }
    doc[tab].push(o);
    selected = { kind: tab, id: o.id };
  });
}
async function saveDraft() {
  if (!doc) return;
  const snapshot = raw();
  if (!dirty() && ident) return;
  let result;
  if (ident)
    result = await api("/api/timelines/" + ident, {
      method: "PUT",
      body: JSON.stringify({ document: doc, revision }),
    });
  else result = await api("/api/timelines", { method: "POST", body: snapshot });
  ident = result.id;
  revision = result.revision;
  savedRaw = snapshot;
  history.replaceState(null, "", "#" + ident);
  await refreshProjects();
  updateStatus();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(raw());
  doc = JSON.parse(undoStack.pop());
  renderEditor();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(raw());
  doc = JSON.parse(redoStack.pop());
  renderEditor();
}
function wireDragging() {
  let drag = null;
  $("#canvas").addEventListener("pointerdown", (e) => {
    if (preview || busy || e.button !== 0) return;
    const g = e.target.closest("[data-id]");
    if (!g) return;
    const kind = g.dataset.kind,
      id = g.dataset.id;
    selected = { kind, id };
    const object = selectedItem();
    drag = {
      id,
      kind,
      x: e.clientX,
      y: e.clientY,
      before: raw(),
      object: structuredClone(object),
      moved: false,
    };
    $("#canvas").setPointerCapture(e.pointerId);
    renderLayers();
    renderInspector();
    renderCanvas();
    e.preventDefault();
  });
  $("#canvas").addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / zoom,
      dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    drag.moved = true;
    const o = selectedItem(),
      b = drag.object,
      offset = Math.round(dx / UNIT);
    o.y = Math.round(
      Math.max(
        drag.kind === "bars" ? 60 : 0,
        Math.min(doc.height - (drag.kind === "bars" ? 60 : 0), b.y + dy),
      ),
    );
    if (drag.kind === "bars") {
      const length = ordinal(b.end) - ordinal(b.start),
        a = Math.max(
          -100000,
          Math.min(99999 - length, ordinal(b.start) + offset),
        );
      o.start = historical(a);
      o.end = historical(a + length);
    } else
      o.year = historical(
        Math.max(-100000, Math.min(99999, ordinal(b.year) + offset)),
      );
    renderCanvas();
    updateStatus();
  });
  const end = () => {
    if (drag?.moved) {
      undoStack.push(drag.before);
      redoStack = [];
    }
    drag = null;
    renderInspector();
    updateStatus();
  };
  $("#canvas").addEventListener("pointerup", end);
  $("#canvas").addEventListener("pointercancel", end);
  $("#canvas").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const g = e.target.closest("[data-id]");
      if (g) {
        e.preventDefault();
        selected = { kind: g.dataset.kind, id: g.dataset.id };
        renderEditor();
      }
    }
  });
}
async function openMedia(insert = false, replace = false) {
  const dialog = $("#media-dialog");
  const items = await api("/api/media");
  dialog.innerHTML = `${closeButton()}<div class="eyebrow">CHRONOSMOS</div><h2>${esc(t("mediaTitle"))}</h2><p>${esc(t("mediaText"))}</p><label class="upload-button">${esc(t("upload"))}<input type="file" id="media-upload" accept="image/png,image/jpeg,image/webp" hidden></label><div class="media-grid">${items.length ? items.map((m) => `<div class="media-card"><img src="/media/${m.id}.png" alt="${esc(m.name)}"><strong>${esc(m.name)}</strong><small>${m.width} × ${m.height}</small><div>${insert ? button("insert", `class="primary" data-insert="${m.id}"`) : ""}${button("delete", `class="danger-text" data-delete-media="${m.id}"`)}</div></div>`).join("") : `<p class="subtle">${esc(t("noMedia"))}</p>`}</div>`;
  wireDialog(dialog);
  if (!dialog.open) dialog.showModal();
  $("#media-upload").onchange = action(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const data = new FormData();
    data.append("file", file);
    await api("/api/media", { method: "POST", body: data });
    toast(t("uploaded"));
    await openMedia(insert, replace);
  });
  dialog.querySelectorAll("[data-insert]").forEach(
    (b) =>
      (b.onclick = () => {
        const media = items.find((i) => i.id === b.dataset.insert);
        dialog.close();
        if (replace && selectedItem()?.type === "image")
          change(() => (selectedItem().mediaId = media.id));
        else addElement("image", media);
      }),
  );
  dialog.querySelectorAll("[data-delete-media]").forEach(
    (b) =>
      (b.onclick = action(async () => {
        await api("/api/media/" + b.dataset.deleteMedia, { method: "DELETE" });
        await openMedia(insert, replace);
      })),
  );
}

function download(blob, name) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function exportSvg() {
  const parsed = new DOMParser().parseFromString(
    renderTimeline(doc, {
      language,
      pixelScale: (doc.mmPerYear * 96) / 25.4 / UNIT,
    }),
    "image/svg+xml",
  );
  for (const img of parsed.querySelectorAll("image")) {
    const response = await fetch(img.getAttribute("href"));
    if (!response.ok) throw new Error(t("exportError"));
    const blob = await response.blob();
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    img.setAttribute("href", data);
  }
  return new XMLSerializer().serializeToString(parsed);
}
function openExport() {
  if (!doc) return;
  const dialog = $("#export-dialog"),
    dim = dimensions(doc);
  dialog.innerHTML = `${closeButton()}<div class="eyebrow">CHRONOSMOS</div><h2>${esc(t("exportTitle"))}</h2><p>${esc(t("exportText"))}</p><div class="print-dimensions"><span>${esc(t("printSize"))}</span><strong>${dim.widthMm.toFixed(1)} × ${dim.heightMm.toFixed(1)} mm</strong></div><label class="field"><span>${esc(t("pngScale"))}</span><select id="png-scale"><option value="1">96 DPI</option><option value="1.5625">150 DPI</option><option value="3.125">300 DPI</option></select></label><div class="export-options">${button("svg", 'data-export="svg" class="primary"')}${button("png", 'data-export="png"')}${button("json", 'data-export="json"')}${button("print", 'data-export="print"')}</div><p class="field-note">${esc(t("printHint"))}</p>`;
  wireDialog(dialog);
  dialog.showModal();
  dialog.querySelectorAll("[data-export]").forEach(
    (b) =>
      (b.onclick = action(async () => {
        b.disabled = true;
        try {
          const format = b.dataset.export,
            name = doc.slug.replaceAll("/", "-");
          if (format === "json") {
            download(
              new Blob([JSON.stringify(doc, null, 2)], {
                type: "application/json",
              }),
              name + ".json",
            );
            return;
          }
          toast(t("exporting"));
          const svg = await exportSvg();
          if (format === "svg")
            download(new Blob([svg], { type: "image/svg+xml" }), name + ".svg");
          else if (format === "png") {
            const scale = (Number($("#png-scale").value) * 96) / 25.4;
            const width = Math.ceil(dim.widthMm * scale),
              height = Math.ceil(dim.heightMm * scale);
            if (width > 30000 || height > 30000 || width * height > 50_000_000)
              throw new Error(t("pngTooLarge"));
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const url = URL.createObjectURL(
              new Blob([svg], { type: "image/svg+xml" }),
            );
            try {
              const img = new Image();
              await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = () => reject(new Error(t("exportError")));
                img.src = url;
              });
              canvas.getContext("2d").drawImage(img, 0, 0, width, height);
              const blob = await new Promise((resolve) =>
                canvas.toBlob(resolve, "image/png"),
              );
              if (!blob) throw new Error(t("exportError"));
              download(blob, name + ".png");
            } finally {
              URL.revokeObjectURL(url);
            }
          } else {
            const printArea = document.createElement("div");
            printArea.id = "print-area";
            printArea.innerHTML = svg;
            const style = document.createElement("style");
            style.textContent = `@media print { @page { size: ${dim.widthMm}mm ${dim.heightMm}mm; margin: 0; } }`;
            printArea.append(style);
            document.body.append(printArea);
            window.print();
            printArea.remove();
          }
        } finally {
          b.disabled = false;
        }
      })),
  );
}

async function initEditor() {
  wireDragging();
  $("#new-timeline").onclick = action(newProject);
  $("#project-select").onchange = action((e) => loadProject(e.target.value));
  $$("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        renderLayers();
      }),
  );
  $("#document-settings").onclick = () => {
    selected = null;
    renderEditor();
  };
  $("#media-open").onclick = action(() => openMedia(false));
  $("#save").onclick = action(() =>
    transaction(async () => {
      await saveDraft();
      renderEditor();
      toast(t("saved"));
    }),
  );
  $("#publish").onclick = action(async () => {
    if (!(await confirmAction(t("publishQuestion")))) return;
    await transaction(async () => {
      await saveDraft();
      const result = await api(`/api/timelines/${ident}/publish`, {
        method: "POST",
        body: JSON.stringify({ published: true, revision }),
      });
      revision = result.revision;
      published = true;
      publishedSlug = doc.slug;
      renderEditor();
      toast(t("savedPublish"));
    });
  });
  $("#logout").onclick = action(async () => {
    if (dirty() && !(await confirmAction(t("leaveQuestion")))) return;
    await api("/api/logout", { method: "POST" });
    savedRaw = raw();
    location.href = "/";
  });
  $("#undo").onclick = undo;
  $("#redo").onclick = redo;
  $("#preview").onclick = () => {
    preview = !preview;
    document.body.classList.toggle("preview", preview);
    $("#preview").textContent = t(preview ? "closePreview" : "preview");
    renderCanvas();
    fit();
  };
  $("#import-open").onclick = () => $("#import-file").click();
  $("#import-file").onchange = action(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw new Error(t("invalidJson"));
    let imported;
    try {
      imported = JSON.parse(await file.text());
    } catch {
      throw new Error(t("invalidJson"));
    }
    const validated = await api("/api/validate", {
      method: "POST",
      body: JSON.stringify(imported),
    });
    if (dirty() && !(await confirmAction(t("leaveQuestion")))) return;
    doc = validated.document;
    ident = null;
    revision = 0;
    published = false;
    publishedSlug = null;
    savedRaw = "";
    undoStack = [];
    redoStack = [];
    selected = null;
    renderEditor();
    fit();
    toast(t("imported"));
    e.target.value = "";
  });
  window.addEventListener("beforeunload", (e) => {
    if (dirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("keydown", (e) => {
    if ($("dialog[open]")) return;
    const input = ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      $("#save").click();
    }
    if (!input && !busy) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
      if (e.key === "Delete" && $("#delete-element"))
        $("#delete-element").click();
    }
  });
  await refreshProjects();
  const fromHash = location.hash.slice(1);
  if (projects.length)
    await loadProject(
      projects.some((p) => p.id === fromHash) ? fromHash : projects[0].id,
    );
  else renderEditor();
}

translate();
$$(".language").forEach((e) => (e.onclick = toggleLanguage));
wireZoom();
if ($("#export-open")) $("#export-open").onclick = openExport;
window.addEventListener(
  "languagechange",
  action(async () => {
    if (page === "editor") {
      renderEditor();
      $("#preview").textContent = t(preview ? "closePreview" : "preview");
    } else if (page === "index") await initGallery();
    else if (page === "viewer") {
      $("#viewer-range").textContent = yearRange(doc);
      renderCanvas();
    }
  }),
);
await action(async () => {
  if (page === "index") await initGallery();
  if (page === "viewer") await initViewer();
  if (page === "editor") await initEditor();
})();
