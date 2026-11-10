import { applyAIProposal } from "./ai-apply.js";
import { fittedScreenScale } from "./screen-scale.js";
import { openAssistant } from "./ai-editor.js";
import { researchHtml } from "./research.js";
import { textWidth } from "./text-layout.js";
import { wireInspectorNavigation } from "./inspector-focus.js";
import { textFor } from "./content.js";
import { moveBars } from "./bar-motion.js";
import {
  validJoinedPeriods,
  joinedPeriodIssue,
  joinedPeriodAt,
  validHeightPeriods,
  heightAt,
} from "./geometry.js";
import { wireViewing } from "./viewing.js";
import { t, language, languageUrl, translate, toggleLanguage } from "./i18n.js";
import {
  renderTimeline,
  barCaption,
  eventCaption,
  overlayPosition,
  barSectionAt,
  clampYearToBar,
  dimensions,
  ordinal,
  historical,
  yearLabel,
  pixelsPerYear,
  MAX_YEAR,
  timeUnitFactor,
  eventEndY,
  eventStartY,
  eventYearRange,
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
let textEditorKey = "";
const textFieldLanguages = new Map();
const collapsedBars = new Set();
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
  normalizeAttachments();
  renderEditor();
}
function normalizeAttachments() {
  for (const bar of doc.bars) {
    if (bar.captionYear !== undefined)
      bar.captionYear =
        (bar.captionPosition ?? "inside") === "inside"
          ? clampYearToBar(bar, bar.captionYear)
          : historical(
              Math.max(
                -MAX_YEAR,
                Math.min(MAX_YEAR - 1, ordinal(bar.captionYear)),
              ),
            );
  }
  for (const overlay of doc.overlays) {
    const bar = doc.bars.find((b) => b.id === overlay.anchorBarId);
    if (bar) {
      overlay.year = clampYearToBar(bar, overlay.year);
      overlay.y = Math.max(
        0,
        Math.min(doc.height, overlayPosition(doc, overlay).y),
      );
    }
  }
  for (const event of doc.events) {
    const range = eventYearRange(doc, event);
    event.year = historical(
      Math.max(range.start, Math.min(range.end, ordinal(event.year))),
    );
    if (event.startBarId || event.startAxis) {
      event.startY = eventStartY(doc, event);
      event.y = Math.max(0, Math.min(doc.height, event.startY));
    }
    if (event.endBarId || event.endAxis) event.endY = eventEndY(doc, event);
  }
  for (const branch of doc.branches ?? []) {
    const from = doc.bars.find((b) => b.id === branch.fromBarId),
      to = doc.bars.find((b) => b.id === branch.toBarId);
    if (from) branch.fromYear = clampYearToBar(from, branch.fromYear);
    if (to) branch.toYear = clampYearToBar(to, branch.toYear);
  }
}
function branchLabel(branch) {
  const name = (id) =>
    textFor(
      doc.bars.find((b) => b.id === id),
      "label",
      language,
    ) || t("timeBar");
  return name(branch.fromBarId) + " → " + name(branch.toBarId);
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
  return `${yearLabel(d.start, language, d.timeUnit)} — ${yearLabel(d.end, language, d.timeUnit)}`;
}
let screenFitCache = {};
function screenScale() {
  if (!doc) return zoom;
  const width = Math.max(1, ($("#canvas-viewport").clientWidth || 1000) - 64),
    key = raw();
  if (
    screenFitCache.key !== key ||
    screenFitCache.width !== width ||
    screenFitCache.language !== language
  )
    screenFitCache = {
      key,
      width,
      language,
      scale: fittedScreenScale(doc, width, language),
    };
  return zoom * screenFitCache.scale;
}
function resizeCanvas() {
  if (!doc) return;
  const svg = $("#canvas svg");
  if (!svg) return;
  const dim = dimensions(doc, screenScale(), language);
  svg.style.width = `${dim.width}px`;
  svg.style.height = `${dim.height}px`;
  $("#zoom-value").textContent = `${Math.round(zoom * 100)}%`;
  $("#zoom-value").title = t("screenZoomHint");
}
function fit() {
  if (!doc) return;
  zoom = 1;
  renderCanvas();
}
function setZoom(value, anchor = null) {
  if (!doc) return;
  const viewport = $("#canvas-viewport"),
    old = screenScale(),
    oldScrollLeft = viewport.scrollLeft,
    oldLeft = dimensions(doc, old, language).left;
  zoom = Math.min(32, Math.max(0.05, value));
  renderCanvas();
  if (anchor) {
    const offset = $("#canvas").offsetLeft;
    const nextLeft = dimensions(doc, screenScale(), language).left;
    viewport.scrollLeft =
      offset +
      nextLeft +
      ((oldScrollLeft + anchor.x - offset - oldLeft) * screenScale()) / old -
      anchor.x;
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
    viewing: page === "viewer" || preview,
    horizontalScale: screenScale(),
  });
  resizeCanvas();
}
function wireZoom() {
  if (!$("#canvas-viewport")) return;
  $("#zoom-in").onclick = () => setZoom(zoom * 1.25);
  $("#zoom-out").onclick = () => setZoom(zoom / 1.25);
  $("#zoom-fit").onclick = fit;
  window.addEventListener("resize", () => {
    if (doc) renderCanvas();
  });
  $("#zoom-value").title = t("screenZoomHint");
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
            `<a class="timeline-card" href="${esc(languageUrl("/" + item.slug))}"><div class="card-art art-${i % 3}"><span class="card-number">${String(i + 1).padStart(2, "0")}</span><div class="art-band band-a"></div><div class="art-band band-b"></div><div class="art-band band-c"></div><div class="art-band band-d"></div><div class="art-line"></div><span class="art-year">${esc(yearLabel(item.start, language))}</span><span class="art-year end">${esc(yearLabel(item.end, language))}</span></div><div class="card-body"><div class="eyebrow">${esc(yearRange(item))} <span>· ${item.bars} ${esc(t("barCount"))}</span></div><h2>${esc(textFor(item, "title", language))}</h2><p>${esc(textFor(item, "description", language))}</p><span class="card-link">${esc(t("openTimeline"))} <span>↗</span></span></div></a>`,
        )
        .join("")
    : `<div class="empty-state">${esc(t("noTimelines"))}</div>`;
}
async function initViewer() {
  ident = $("#viewer").dataset.timelineId;
  const data = await api("/api/timelines/" + ident);
  doc = data.document;
  renderViewerHeading();
  renderCanvas();
  fit();
}
function renderViewerHeading() {
  if (!doc) return;
  $("#viewer-title").textContent = textFor(doc, "title", language);
  document.title = textFor(doc, "title", language) + " · Chronosmos";
  const description = textFor(doc, "description", language);
  $("#viewer-description").textContent = description;
  $("#viewer-description").hidden = !description.trim();
  $("#viewer-description").title = description;
  $("#viewer-range").textContent = yearRange(doc);
  const sources = $("#viewer-sources");
  if (sources) {
    const researched = [
      ...doc.bars,
      ...doc.events,
      ...(doc.joinedPeriods ?? []).map((p) => ({
        ...p,
        label: [p.fromBarId, p.toBarId]
          .map((id) =>
            textFor(
              doc.bars.find((b) => b.id === id),
              "label",
              language,
            ),
          )
          .join(" ↔ "),
      })),
    ].filter((b) => b.research);
    sources.hidden = !researched.length;
    sources.querySelector("div").innerHTML = researched
      .map(
        (b) =>
          `<h3>${esc(textFor(b, "label", language) || t("timeBar"))}</h3>${researchHtml(b.research, t("dateSources"))}`,
      )
      .join("");
  }
}
async function refreshProjects() {
  projects = await api("/api/timelines?editor=1");
  renderProjectPicker();
  renderChooser();
}
function projectURL(id) {
  history.replaceState(
    null,
    "",
    languageUrl(id ? "/manage?timeline=" + encodeURIComponent(id) : "/manage"),
  );
}
function renderChooser() {
  $("#timeline-chooser").hidden = !!doc;
  $("#editor-workspace").hidden = !doc;
  $("#managed-timelines").innerHTML = projects.length
    ? projects
        .map(
          (p) =>
            `<a class="managed-timeline" href="${esc(languageUrl("/manage?timeline=" + encodeURIComponent(p.id)))}"><strong>${esc(textFor(p, "title", language))}</strong><span class="badge">${esc(t(p.published ? "live" : "draft"))}</span><p>${esc(textFor(p, "description", language))}</p><small>/${esc(p.slug ?? "")}</small></a>`,
        )
        .join("")
    : `<p>${esc(t("emptyLibrary"))}</p>`;
}
function renderProjectPicker() {
  const picker = $("#project-select");
  picker.innerHTML =
    `<option value="">${esc(t("chooseTimeline"))}</option>` +
    projects
      .map(
        (p) =>
          `<option value="${p.id}">${esc(textFor(p, "title", language))}</option>`,
      )
      .join("");
  if (doc && !ident)
    picker.insertAdjacentHTML(
      "beforeend",
      `<option value="new">${esc(textFor(doc, "title", language))} *</option>`,
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
  textEditorKey = id;
  revision = data.revision;
  published = data.published;
  publishedSlug = data.publishedSlug;
  savedRaw = raw();
  undoStack = [];
  redoStack = [];
  selected = null;
  renderEditor();
  fit();
  projectURL(id);
}
async function newProject() {
  if (dirty() && !(await confirmAction(t("leaveQuestion")))) return false;
  projectURL("new");
  doc = {
    version: 1,
    title: t("nameNew", "en"),
    description: "",
    slug: t("newPath", "en") + "-" + uid().slice(0, 6),
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
  textEditorKey = uid();
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
  return true;
}
function selectedItem() {
  return selected && doc?.[selected.kind]?.find((o) => o.id === selected.id);
}
function renderEditor() {
  renderChooser();
  renderProjectPicker();
  $("#empty-canvas").hidden = !!doc;
  const conflict = $("#composition-conflicts");
  if (conflict) {
    conflict.hidden = !doc || validJoinedPeriods(doc);
    conflict.textContent = t("joinConflictDraft");
  }
  $("#element-count").textContent = doc
    ? doc.bars.length +
      doc.overlays.length +
      doc.events.length +
      (doc.branches?.length ?? 0)
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
  const row = (item, kind, i) =>
    `<button class="layer-row ${selected?.id === item.id ? "selected" : ""}" data-kind="${kind}" data-id="${item.id}"><span class="layer-swatch ${kind === "overlays" ? "overlay-swatch" : ""}" style="background:${item.background || item.color || "#d5d1c5"}">${kind === "branches" ? "↳" : kind === "overlays" ? (item.type === "text" ? "T" : item.type === "box" ? "□" : item.type === "brace" ? "}" : "▧") : ""}</span><span class="layer-detail"><strong>${esc(kind === "branches" ? branchLabel(item) : textFor(item, "label", language) || (textFor(item, "text", language) || textFor(item, "topText", language) || textFor(item, "bottomText", language)).split("\n")[0] || t(item.type) || t("event"))}</strong><small>${kind === "bars" ? esc(yearLabel(item.start, language) + " — " + yearLabel(item.end, language)) : kind === "branches" ? esc(yearLabel(item.fromYear, language) + " → " + yearLabel(item.toYear, language)) : esc(yearLabel(item.year, language))}</small></span><span class="layer-index">${String(i + 1).padStart(2, "0")}</span></button>`;
  list.innerHTML = !items.length
    ? `<p class="subtle empty-layers">${esc(t("noLayers"))}</p>`
    : tab === "bars"
      ? `<ul class="bar-tree">${items
          .map((bar, i) => {
            const branches = (doc.branches ?? []).filter(
              (branch) => branch.fromBarId === bar.id,
            );
            const collapsed =
              collapsedBars.has(textEditorKey + ":" + bar.id) &&
              !branches.some((branch) => branch.id === selected?.id);
            return `<li data-source-bar="${bar.id}"><div class="bar-tree-row">${branches.length ? `<button class="branch-toggle" data-toggle-bar="${bar.id}" aria-expanded="${!collapsed}" aria-controls="branches-${bar.id}" aria-label="${esc(t("branches") + ": " + (textFor(bar, "label", language) || t("timeBar")))}">${collapsed ? "▸" : "▾"}</button>` : '<span class="branch-toggle-placeholder"></span>'}${row(bar, "bars", i)}</div>${branches.length ? `<ul id="branches-${bar.id}" class="branch-children" ${collapsed ? "hidden" : ""}>${branches.map((branch, j) => `<li>${row(branch, "branches", j)}</li>`).join("")}</ul>` : ""}</li>`;
          })
          .join("")}</ul>`
      : items.map((item, i) => row(item, tab, i)).join("");
  list.querySelectorAll(".layer-row").forEach(
    (button) =>
      (button.onclick = () => {
        selected = { kind: button.dataset.kind, id: button.dataset.id };
        renderEditor();
      }),
  );
  list.querySelectorAll("[data-toggle-bar]").forEach(
    (button) =>
      (button.onclick = () => {
        const key = textEditorKey + ":" + button.dataset.toggleBar;
        if (collapsedBars.has(key)) collapsedBars.delete(key);
        else collapsedBars.add(key);
        if (
          selected?.kind === "branches" &&
          doc.branches.find((b) => b.id === selected.id)?.fromBarId ===
            button.dataset.toggleBar
        )
          selected = { kind: "bars", id: button.dataset.toggleBar };
        renderEditor();
        list
          .querySelector(`[data-toggle-bar="${button.dataset.toggleBar}"]`)
          ?.focus();
      }),
  );
  $("#add-controls").innerHTML = !doc
    ? ""
    : tab === "bars"
      ? button("addBar", 'data-add="bar" class="add-layer"') +
        button("addBranch", 'data-add="branch" class="add-layer"')
      : tab === "events"
        ? button("addEvent", 'data-add="event" class="add-layer"')
        : button("addText", 'data-add="text"') +
          button("addBox", 'data-add="box"') +
          button("addImage", 'data-add="image"') +
          button("addBrace", 'data-add="brace"');
  $$("[data-add]").forEach(
    (b) =>
      (b.onclick = action(() =>
        b.dataset.add === "image" ? openMedia(true) : addElement(b.dataset.add),
      )),
  );
}
function field(key, label, type = "text", value = "", options = {}) {
  const id = "field-" + key;
  const translatable = [
    "title",
    "description",
    "label",
    "text",
    "topText",
    "bottomText",
  ].includes(key);
  const languageKey = `${textEditorKey}:${selectedItem()?.id ?? "document"}:${key}`;
  const locale = translatable
    ? (textFieldLanguages.get(languageKey) ?? "en")
    : null;
  const target = selectedItem() || doc;
  if (locale === "fi") value = target.translations?.fi?.[key] ?? "";
  const textAttributes = locale
    ? `data-content-locale="${locale}" lang="${locale}" ${locale === "fi" ? `placeholder="${esc(target[key])}"` : ""}`
    : "";
  let control;
  if (type === "select")
    control = `<select id="${id}" data-field="${key}">${options.choices.map(([v, l]) => `<option value="${esc(v)}" ${String(value) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  else if (type === "checkbox")
    control = `<input id="${id}" data-field="${key}" type="checkbox" ${value ? "checked" : ""}>`;
  else if (type === "textarea")
    control = `<textarea id="${id}" data-field="${key}" ${textAttributes} rows="${options.rows || 3}" maxlength="${options.maxLength || 4000}">${esc(value)}</textarea>`;
  else
    control = `<input id="${id}" data-field="${key}" ${textAttributes} type="${type}" value="${esc(value)}" ${options.min !== undefined ? `min="${options.min}"` : ""} ${options.max !== undefined ? `max="${options.max}"` : ""} ${type === "number" ? `step="${options.step || 1}"` : ""} ${type === "text" ? `maxlength="${options.maxLength || 250}"` : ""}>`;
  if (translatable) {
    const selector = `<select id="language-${key}" class="text-language-select" data-text-language="${esc(languageKey)}" data-text-field="${key}" aria-label="${esc(t(label) + " · " + t("textLanguage"))}"><option value="en" ${locale === "en" ? "selected" : ""}>${esc(t("englishBase"))}</option><option value="fi" ${locale === "fi" ? "selected" : ""}>${esc(t("finnish"))}</option></select>`;
    return `<div class="field content-field"><label for="${id}">${esc(t(label))}</label>${selector}${control}${locale === "fi" ? `<small>${esc(t("englishFallback"))}</small>` : ""}</div>`;
  }
  return `<label class="field ${type === "color" ? "color-field" : type === "checkbox" ? "checkbox-field" : ""}" for="${id}"><span>${esc(t(label))}</span>${control}${options.hint ? `<small>${esc(options.hint)}</small>` : ""}</label>`;
}
function heightPeriodFields(bar) {
  return `<section class="height-periods"><h3>${esc(t("heightChanges"))}</h3>${(bar.heightPeriods ?? []).map((p) => `<div class="height-period" data-height-period="${p.id}"><div class="field-pair"><label class="field"><span>${esc(t("start"))}</span><input type="number" data-period-field="start" value="${p.start}" min="${bar.start}" max="${bar.end}" step="1"></label><label class="field"><span>${esc(t("end"))}</span><input type="number" data-period-field="end" value="${p.end}" min="${bar.start}" max="${bar.end}" step="1"></label></div><label class="field"><span>${esc(t("targetHeight"))}</span><input type="number" data-period-field="height" value="${p.height}" min="4" max="160" step="1"></label><button class="danger-text" data-remove-period="${p.id}">${esc(t("removePeriod"))}</button></div>`).join("")}<button id="add-height-period">${esc(t("addHeightPeriod"))}</button><p class="field-note">${esc(t("heightPeriodHint"))}</p></section>`;
}
function wireHeightPeriods(el, bar) {
  if (!bar || selected?.kind !== "bars") return;
  el.querySelectorAll("[data-period-field]").forEach(
    (input) =>
      (input.onchange = () => {
        if (!input.reportValidity()) return;
        const id = input.closest("[data-height-period]").dataset.heightPeriod;
        const periods = structuredClone(bar.heightPeriods ?? []);
        const period = periods.find((p) => p.id === id);
        if (period[input.dataset.periodField] === Number(input.value)) return;
        period[input.dataset.periodField] = Number(input.value);
        if (!validHeightPeriods(bar, periods)) {
          toast(t("invalidHeightPeriods"), true);
          renderInspector();
          return;
        }
        change(
          () =>
            (bar.heightPeriods = periods.sort(
              (a, b) => ordinal(a.start) - ordinal(b.start),
            )),
        );
      }),
  );
  el.querySelectorAll("[data-remove-period]").forEach(
    (button) =>
      (button.onclick = () =>
        change(
          () =>
            (bar.heightPeriods = bar.heightPeriods.filter(
              (p) => p.id !== button.dataset.removePeriod,
            )),
        )),
  );
  $("#add-height-period").onclick = () => {
    if ((bar.heightPeriods?.length ?? 0) >= 50) {
      toast(t("invalidHeightPeriods"), true);
      return;
    }
    const sorted = [...(bar.heightPeriods ?? [])].sort(
      (a, b) => ordinal(a.start) - ordinal(b.start),
    );
    const gaps = [];
    let cursor = ordinal(bar.start);
    for (const p of sorted) {
      if (ordinal(p.start) > cursor) gaps.push([cursor, ordinal(p.start)]);
      cursor = ordinal(p.end);
    }
    if (ordinal(bar.end) > cursor) gaps.push([cursor, ordinal(bar.end)]);
    const gap = gaps.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
    if (!gap) {
      toast(t("invalidHeightPeriods"), true);
      return;
    }
    const start = gap[0] + Math.floor((gap[1] - gap[0]) * 0.4),
      end = Math.min(
        gap[1],
        start + Math.max(1, Math.floor((gap[1] - gap[0]) * 0.15)),
      );
    change(() => {
      bar.heightPeriods ??= [];
      bar.heightPeriods.push({
        id: uid(),
        start: historical(start),
        end: historical(end),
        height: Math.min(160, heightAt(bar, start).height + 12),
      });
      bar.heightPeriods.sort((a, b) => ordinal(a.start) - ordinal(b.start));
    });
  };
}
function joinedPeriodFields(bar) {
  const periods = (doc.joinedPeriods ?? []).filter(
    (p) => p.fromBarId === bar.id || p.toBarId === bar.id,
  );
  return `<section class="height-periods"><h3>${esc(t("joinedPeriods"))}</h3>${periods
    .map((p) => {
      const otherId = p.fromBarId === bar.id ? p.toBarId : p.fromBarId;
      return `<div class="height-period ${joinedPeriodIssue(doc, p) ? "has-conflict" : ""}" data-joined-period="${p.id}">${joinedPeriodIssue(doc, p) ? `<p class="field-conflict" role="status">${esc(t(joinedPeriodIssue(doc, p)))}</p>` : ""}<label class="field"><span>${esc(t("joinWith"))}</span><select data-join-field="peer">${doc.bars
        .filter((b) => b.id !== bar.id)
        .map(
          (b) =>
            `<option value="${b.id}" ${b.id === otherId ? "selected" : ""}>${esc(textFor(b, "label", language) || t("timeBar"))}</option>`,
        )
        .join(
          "",
        )}</select></label>${["start", "end", "transitionYears"].map((key) => `<label class="field"><span>${esc(t(key))}</span><input type="number" data-join-field="${key}" value="${p[key]}" step="${key === "transitionYears" ? "any" : "1"}"></label>`).join("")}<button class="danger-text" data-remove-join="${p.id}">${esc(t("removePeriod"))}</button>${researchHtml(p.research, t("dateSources"))}</div>`;
    })
    .join(
      "",
    )}<button id="add-joined-period" ${doc.bars.length < 2 ? "disabled" : ""}>${esc(t("addJoinedPeriod"))}</button><p class="field-note">${esc(t("joinedPeriodHint"))}</p></section>`;
}
function wireJoinedPeriods(bar) {
  $$("[data-join-field]").forEach(
    (input) =>
      (input.onchange = () => {
        const periods = structuredClone(doc.joinedPeriods),
          p = periods.find(
            (p) =>
              p.id ===
              input.closest("[data-joined-period]").dataset.joinedPeriod,
          );
        const key = input.dataset.joinField;
        if (key === "peer")
          p[p.fromBarId === bar.id ? "toBarId" : "fromBarId"] = input.value;
        else p[key] = Number(input.value);
        change(() => (doc.joinedPeriods = periods));
      }),
  );
  $$("[data-remove-join]").forEach(
    (b) =>
      (b.onclick = () =>
        change(
          () =>
            (doc.joinedPeriods = doc.joinedPeriods.filter(
              (p) => p.id !== b.dataset.removeJoin,
            )),
        )),
  );
  $("#add-joined-period").onclick = () => {
    for (const peer of doc.bars.filter((b) => b !== bar)) {
      const start = Math.max(ordinal(bar.start), ordinal(peer.start)),
        end = Math.min(
          ordinal(bar.end),
          ordinal(peer.end),
          bar.mergeInto ? ordinal(bar.end) - bar.mergeYears : Infinity,
          peer.mergeInto ? ordinal(peer.end) - peer.mergeYears : Infinity,
        );
      const occupied = (doc.joinedPeriods ?? [])
        .filter((p) =>
          [p.fromBarId, p.toBarId].some((id) => [bar.id, peer.id].includes(id)),
        )
        .sort((a, b) => ordinal(a.start) - ordinal(b.start));
      let at = start;
      for (const p of [
        ...occupied,
        { start: historical(end), end: historical(end) },
      ]) {
        const z = Math.min(end, ordinal(p.start));
        if (z - at >= 1) {
          const span = z - at;
          const joined = {
            id: uid(),
            fromBarId: bar.id,
            toBarId: peer.id,
            start: historical(at),
            end: historical(z),
            transitionYears: Math.max(0.01, span / 4),
          };
          change(() => {
            doc.joinedPeriods ??= [];
            doc.joinedPeriods.push(joined);
          });
          return;
        }
        at = Math.max(at, ordinal(p.end));
      }
    }
    toast(t("invalidJoinedPeriods"), true);
  };
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
      `<div class="field-pair">${number("start", "start", doc.start, -MAX_YEAR, MAX_YEAR)}${number("end", "end", doc.end, -MAX_YEAR, MAX_YEAR)}</div><p class="field-note">${esc(t("dateHint"))}</p><div class="inspector-divider"></div>` +
      field("timeUnit", "timeUnit", "select", doc.timeUnit ?? "auto", {
        choices: ["auto", "years", "thousands", "millions"].map((v) => [
          v,
          t(v),
        ]),
      }) +
      number(
        "mmPerYear",
        doc.timeUnit === "millions"
          ? "mmPerMillion"
          : doc.timeUnit === "thousands"
            ? "mmPerThousand"
            : "mmPerYear",
        doc.mmPerYear * timeUnitFactor(doc.timeUnit),
        1e-12 * timeUnitFactor(doc.timeUnit),
        100 * timeUnitFactor(doc.timeUnit),
        "any",
      ) +
      `<p class="field-note">${esc(t("printHint"))}</p>` +
      number("height", "height", doc.height, 200, 4000) +
      field("scale", "scale", "select", doc.scale, {
        choices: ["top", "bottom", "both", "none"].map((v) => [v, t(v)]),
      }) +
      number(
        "labelInterval",
        "labelInterval",
        doc.labelInterval ?? 0,
        0,
        2 * MAX_YEAR,
      ) +
      number(
        "minorTickInterval",
        "minorTickInterval",
        doc.minorTickInterval ?? 0,
        0,
        2 * MAX_YEAR,
      ) +
      `<p class="field-note">${esc(t("axisIntervalHint"))}</p>` +
      field(
        "majorGrid",
        "majorGrid",
        "select",
        String(doc.majorGrid ?? false),
        {
          choices: [
            ["false", t("off")],
            ["true", t("on")],
          ],
        },
      ) +
      color("background", "background", doc.background) +
      `<div class="inspector-divider"></div>${published ? `<a class="public-link" href="${esc(languageUrl("/" + publishedSlug))}" target="_blank" rel="noopener">/${esc(publishedSlug)} ↗</a>${button("unpublish", 'id="unpublish" class="danger-text"')}` : ""}${button("deleteTimeline", 'id="delete-timeline" class="danger-text"')}`;
  } else {
    const kind = selected.kind;
    html = `<div class="eyebrow">${esc(t(kind === "bars" ? "timeBar" : kind === "events" ? "event" : kind === "branches" ? "branch" : o.type))}</div><h2>${esc(kind === "branches" ? branchLabel(o) : textFor(o, "label", language) || (textFor(o, "text", language) || textFor(o, "topText", language) || textFor(o, "bottomText", language)).split("\n")[0] || t(o.type))}</h2>`;
    if (kind === "bars") {
      html +=
        field("label", "label", "text", o.label) +
        field("showCaption", "showCaption", "checkbox", o.showCaption ?? true, {
          hint: t("hiddenCaptionHint"),
        }) +
        field(
          "captionPosition",
          "captionPosition",
          "select",
          o.captionPosition ?? "inside",
          {
            choices: ["inside", "right", "left", "above", "below", "free"].map(
              (v) => [v, t(v)],
            ),
          },
        ) +
        (!["right", "left"].includes(o.captionPosition)
          ? number(
              "captionYear",
              "captionYear",
              o.captionYear ?? o.start,
              o.captionPosition === undefined || o.captionPosition === "inside"
                ? o.start
                : -MAX_YEAR,
              o.captionPosition === undefined || o.captionPosition === "inside"
                ? o.end
                : MAX_YEAR,
            )
          : "") +
        field(
          "captionFontMode",
          "captionFontSize",
          "select",
          o.captionFontSize === undefined || o.captionFontSize === "auto"
            ? "auto"
            : "fixed",
          {
            choices: [
              ["auto", t("auto")],
              ["fixed", t("fixed")],
            ],
          },
        ) +
        (typeof o.captionFontSize === "number"
          ? number(
              "captionFontSize",
              "fontSize",
              o.captionFontSize,
              6,
              120,
              "any",
            )
          : "") +
        number(
          "captionOffsetX",
          "captionOffsetX",
          barCaption(doc, o).offsetX,
          -2000,
          2000,
          "any",
        ) +
        number(
          "captionOffsetY",
          "captionOffsetY",
          o.captionOffsetY ?? 0,
          -4000,
          4000,
          "any",
        ) +
        color("captionColor", "captionColor", barCaption(doc, o).color) +
        `<div class="field-pair">${number("start", "start", o.start, -MAX_YEAR, MAX_YEAR)}${number("end", "end", o.end, -MAX_YEAR, MAX_YEAR)}</div><p class="field-note">${esc(t("dateHint"))}</p>` +
        number("y", "y", o.y, 60, doc.height - 60) +
        number("height", "initialHeight", o.height, 4, 160) +
        field(
          "heightAlignment",
          "heightAlignment",
          "select",
          o.heightAlignment ?? "center",
          {
            choices: ["top", "center", "bottom"].map((v) => [v, t(v)]),
          },
        ) +
        researchHtml(o.research, t("dateSources")) +
        heightPeriodFields(o) +
        joinedPeriodFields(o) +
        `<div class="field-pair">${color("background", "background", o.background)}${color("foreground", "foreground", o.foreground)}</div><div class="inspector-divider"></div>` +
        number("fadeIn", "fadeIn", o.fadeIn, 0, 2 * MAX_YEAR) +
        number("fadeOut", "fadeOut", o.fadeOut, 0, 2 * MAX_YEAR) +
        field("mergeInto", "mergeInto", "select", o.mergeInto, {
          choices: [
            ["", t("none")],
            ...doc.bars
              .filter((b) => b.id !== o.id)
              .map((b) => [
                b.id,
                textFor(b, "label", language) || t("timeBar"),
              ]),
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
      if (o.type === "brace")
        html +=
          field("topText", "topCaption", "textarea", o.topText ?? "") +
          field("text", "middleCaption", "textarea", o.text) +
          field("bottomText", "bottomCaption", "textarea", o.bottomText ?? "");
      else if (o.type !== "image")
        html += field("text", "text", "textarea", o.text);
      else
        html += `<img class="inspector-image" src="/media/${o.mediaId}.png" alt="${esc(t("selectedMedia"))}">${button("changeImage", 'id="change-image"')}`;
      const anchor = doc.bars.find((b) => b.id === o.anchorBarId);
      html +=
        field("anchorBarId", "anchorBar", "select", o.anchorBarId ?? "", {
          choices: [
            ["", t("freePosition")],
            ...doc.bars.map((b) => [
              b.id,
              textFor(b, "label", language) || t("timeBar"),
            ]),
          ],
          hint: t("anchorHint"),
        }) +
        number(
          "year",
          anchor ? "anchorYear" : "year",
          o.year,
          anchor?.start ?? -MAX_YEAR,
          anchor?.end ?? MAX_YEAR,
        ) +
        (anchor
          ? number("offsetY", "offsetY", o.offsetY ?? 0, -4000, 4000, "any")
          : number("y", "y", o.y, 0, doc.height)) +
        `<div class="field-pair">${number("width", "width", o.width, o.type === "brace" ? (o.braceWidth ?? 24) + 24 : 10, 2000)}${number("height", "height", o.height, 10, 2000)}</div>`;
      if (o.type !== "image")
        html +=
          number("fontSize", "fontSize", o.fontSize, 6, 120) +
          color("color", "color", o.color);
      if (o.type === "brace")
        html +=
          number(
            "braceWidth",
            "braceWidth",
            o.braceWidth ?? 24,
            8,
            Math.min(160, o.width - 24),
            "any",
          ) +
          number(
            "strokeWidth",
            "strokeWidth",
            o.strokeWidth ?? 1.5,
            0.25,
            20,
            "any",
          );
      if (o.type === "box") html += color("fill", "fill", o.fill);
    } else if (kind === "branches") {
      const from = doc.bars.find((b) => b.id === o.fromBarId),
        to = doc.bars.find((b) => b.id === o.toBarId);
      const choices = (except) =>
        doc.bars
          .filter((b) => b.id !== except)
          .map((b) => [b.id, textFor(b, "label", language) || t("timeBar")]);
      html +=
        field("fromBarId", "fromBar", "select", o.fromBarId, {
          choices: choices(o.toBarId),
        }) +
        number("fromYear", "fromYear", o.fromYear, from.start, from.end) +
        field("toBarId", "toBar", "select", o.toBarId, {
          choices: choices(o.fromBarId),
        }) +
        number("toYear", "toYear", o.toYear, to.start, to.end);
    } else {
      html += researchHtml(o.research, t("dateSources"));
      const endpointFields = (side) => {
        const barId = side + "BarId",
          axis = o[side + "Axis"];
        const anchor = axis || o[barId];
        return (
          field(
            barId,
            side === "start" ? "eventSource" : "eventTarget",
            "select",
            axis ? "@" + axis : (o[barId] ?? ""),
            {
              choices: [
                ["", t("freePosition")],
                ["@top", t("topAxis")],
                ["@bottom", t("bottomAxis")],
                ...doc.bars.map((b) => [
                  b.id,
                  textFor(b, "label", language) || t("timeBar"),
                ]),
              ],
            },
          ) +
          (o[barId]
            ? field(
                side + "Edge",
                "endEdge",
                "select",
                o[side + "Edge"] ?? "center",
                {
                  choices: ["top", "center", "bottom"].map((v) => [v, t(v)]),
                },
              )
            : anchor
              ? ""
              : side === "start"
                ? o.startY !== undefined
                  ? number(
                      "startY",
                      "startPosition",
                      o.startY,
                      -4000,
                      8000,
                      "any",
                    )
                  : number("y", "y", o.y, 0, doc.height)
                : o.endY !== undefined
                  ? number("endY", "endPosition", o.endY, -4000, 8000, "any")
                  : number("height", "height", o.height, 1, doc.height))
        );
      };
      const range = eventYearRange(doc, o);
      html +=
        field("label", "label", "text", o.label) +
        field(
          "labelPosition",
          "eventCaptionPosition",
          "select",
          o.labelPosition ?? "top",
          {
            choices: ["top", "bottom", "center", "free"].map((v) => [v, t(v)]),
          },
        ) +
        (o.labelPosition === "free"
          ? number("labelY", "captionY", o.labelY, -4000, 8000, "any")
          : "") +
        number(
          "labelOffsetX",
          "captionOffsetX",
          o.labelOffsetX ?? 7,
          -2000,
          2000,
          "any",
        ) +
        number(
          "year",
          "year",
          o.year,
          historical(range.start),
          historical(range.end),
        ) +
        endpointFields("start") +
        endpointFields("end") +
        field("dotted", "dottedLine", "checkbox", o.dotted ?? false) +
        number("width", "width", o.width, 0.25, 20, 0.25) +
        color("color", "color", o.color) +
        field("layer", "layer", "select", o.layer, {
          choices: [
            ["under", t("under")],
            ["over", t("over")],
          ],
        });
    }
    html += `<div class="inspector-divider"></div><div class="element-actions">${button("duplicate", 'id="duplicate"')}${button("delete", 'id="delete-element" class="danger-text"')}</div>`;
  }
  el.innerHTML = html;
  wireHeightPeriods(el, o);
  const commitContent = (input) => {
    if (!input.reportValidity()) return;
    const target = o || doc,
      key = input.dataset.field,
      locale = input.dataset.contentLocale,
      value = input.value;
    const previous =
      locale === "en" ? target[key] : (target.translations?.fi?.[key] ?? "");
    if (value === previous) return;
    checkpoint();
    if (locale === "en") target[key] = value;
    else if (value.trim()) {
      target.translations ??= {};
      target.translations.fi ??= {};
      target.translations.fi[key] = value;
    } else if (target.translations?.fi) {
      delete target.translations.fi[key];
      if (!Object.keys(target.translations.fi).length)
        delete target.translations.fi;
      if (!Object.keys(target.translations).length) delete target.translations;
    }
    if (locale === "fi" && !value.trim()) input.value = "";
    renderCanvas();
    renderLayers();
    renderProjectPicker();
    updateStatus();
    if (o)
      el.querySelector("h2").textContent =
        textFor(o, "label", language) ||
        (
          textFor(o, "text", language) ||
          textFor(o, "topText", language) ||
          textFor(o, "bottomText", language)
        ).split("\n")[0] ||
        t(o.type);
  };
  el.querySelectorAll("[data-text-language]").forEach(
    (select) =>
      (select.onchange = () => {
        const locale = select.value;
        if (
          locale ===
          (textFieldLanguages.get(select.dataset.textLanguage) ?? "en")
        )
          return;
        commitContent(
          el.querySelector(`[data-field="${select.dataset.textField}"]`),
        );
        textFieldLanguages.set(select.dataset.textLanguage, locale);
        renderInspector();
      }),
  );
  el.querySelectorAll("[data-field]").forEach(
    (input) =>
      (input.onchange = () => {
        if (!input.reportValidity()) return;
        const target = o || doc,
          key = input.dataset.field;
        let value =
          input.type === "checkbox"
            ? input.checked
            : input.type === "number"
              ? Number(input.value)
              : input.value;
        if (input.dataset.contentLocale) {
          commitContent(input);
          return;
        }
        if (
          [
            "start",
            "end",
            "year",
            "captionYear",
            "fromYear",
            "toYear",
          ].includes(key) &&
          value === 0
        ) {
          toast(t("noYearZero"), true);
          input.value = target[key] ?? target.start;
          return;
        }
        if (key === "captionFontMode") {
          const previous =
            target.captionFontSize === undefined ||
            target.captionFontSize === "auto"
              ? "auto"
              : "fixed";
          if (value !== previous)
            change(
              () => (target.captionFontSize = value === "auto" ? "auto" : 14),
            );
          return;
        }
        if (key === "mmPerYear") value /= timeUnitFactor(doc.timeUnit);
        if (key === "majorGrid") value = value === "true";
        const side =
          key === "startBarId" ? "start" : key === "endBarId" ? "end" : null;
        if (side) {
          const previous = target[side + "Axis"]
            ? "@" + target[side + "Axis"]
            : (target[key] ?? "");
          if (value === previous) return;
        } else {
          const defaults = {
            timeUnit: "auto",
            heightAlignment: "center",
            startEdge: "center",
            endEdge: "center",
            labelInterval: 0,
            minorTickInterval: 0,
            majorGrid: false,
            offsetY: 0,
            anchorBarId: "",
            mergeInto: "",
            captionYear: target.start,
            captionPosition: "inside",
            captionOffsetY: 0,
            captionOffsetX:
              selected?.kind === "bars" ? barCaption(doc, target).offsetX : 0,
            captionColor:
              selected?.kind === "bars" ? barCaption(doc, target).color : "",
            labelPosition: "top",
            labelOffsetX: 7,
            showCaption: true,
            dotted: false,
            braceWidth: 24,
            strokeWidth: 1.5,
          };
          if (value === (target[key] ?? defaults[key])) return;
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
        if (
          selected?.kind === "bars" &&
          ["start", "end"].includes(key) &&
          !validHeightPeriods(candidate, candidate.heightPeriods ?? [])
        ) {
          toast(t("invalidHeightPeriods"), true);
          input.value = target[key];
          return;
        }
        if (side) {
          candidate[side + "Axis"] = value.startsWith("@")
            ? value.slice(1)
            : "";
          candidate[key] = value.startsWith("@") ? "" : value;
          const range = eventYearRange(doc, candidate);
          if (range.start > range.end) {
            toast(t("eventBarsOverlap"), true);
            renderInspector();
            return;
          }
        }
        if (selected?.kind === "bars" && ["start", "end"].includes(key)) {
          const edited = {
            ...doc,
            bars: doc.bars.map((bar) => (bar === target ? candidate : bar)),
          };
          if (
            doc.events.some((event) => {
              const range = eventYearRange(edited, event);
              return range.start > range.end;
            })
          ) {
            toast(t("eventBarsOverlap"), true);
            input.value = target[key];
            return;
          }
        }
        change(() => {
          if (key === "anchorBarId") {
            const position = overlayPosition(doc, target);
            const anchor = doc.bars.find((b) => b.id === value);
            if (anchor) {
              target.year = clampYearToBar(anchor, target.year);
              target.offsetY =
                position.y - barSectionAt(doc, anchor, target.year).y;
            } else {
              target.y = Math.max(0, Math.min(doc.height, position.y));
              delete target.offsetY;
            }
          }
          if (key === "labelPosition" && value === "free")
            target.labelY = eventCaption(doc, target).y;
          if (side) {
            if (
              side === "start" &&
              !target.endBarId &&
              !target.endAxis &&
              target.endY === undefined
            )
              target.endY = eventEndY(doc, target);
            const position =
              side === "start"
                ? eventStartY(doc, target)
                : eventEndY(doc, target);
            target[side + "Y"] = position;
            delete target[side + "Axis"];
            delete target[key];
            if (value.startsWith("@")) target[side + "Axis"] = value.slice(1);
            else if (value) target[key] = value;
          } else target[key] = value;
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
        if ("y" in clone) clone.y = Math.min(doc.height - 60, clone.y + 42);
        if (
          selected.kind === "events" &&
          !clone.endBarId &&
          !clone.endAxis &&
          clone.endY !== undefined
        )
          clone.endY = Math.min(8000, clone.endY + clone.y - o.y);
        if (
          selected.kind === "events" &&
          !clone.startBarId &&
          !clone.startAxis &&
          clone.startY !== undefined
        )
          clone.startY = Math.min(8000, clone.startY + clone.y - o.y);
        if (clone.anchorBarId)
          clone.offsetY = Math.min(4000, (clone.offsetY ?? 0) + 42);
        doc[selected.kind].push(clone);
        selected.id = clone.id;
      });
  if (selected?.kind === "bars") wireJoinedPeriods(o);
  if ($("#delete-element"))
    $("#delete-element").onclick = () =>
      change(() => {
        const id = o.id;
        if (selected.kind === "bars") {
          for (const event of doc.events) {
            for (const side of ["start", "end"]) {
              if (event[side + "BarId"] === id) {
                event[side + "Y"] =
                  side === "start"
                    ? eventStartY(doc, event)
                    : eventEndY(doc, event);
                delete event[side + "BarId"];
              }
            }
          }
          doc.joinedPeriods = (doc.joinedPeriods ?? []).filter(
            (p) => p.fromBarId !== id && p.toBarId !== id,
          );
          doc.branches = (doc.branches ?? []).filter(
            (branch) => branch.fromBarId !== id && branch.toBarId !== id,
          );
          for (const overlay of doc.overlays.filter(
            (overlay) => overlay.anchorBarId === id,
          )) {
            overlay.y = Math.max(
              0,
              Math.min(doc.height, overlayPosition(doc, overlay).y),
            );
            delete overlay.anchorBarId;
            delete overlay.offsetY;
          }
        }
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
        projectURL(null);
        savedRaw = "";
        selected = null;
        await refreshProjects();
        renderEditor();
      });
    });
}
function addElement(type, media = null) {
  if (!doc) return;
  if (type === "branch" && doc.bars.length < 2) {
    toast(t("needTwoBars"), true);
    return;
  }
  change(() => {
    let o;
    const span = ordinal(doc.end) - ordinal(doc.start),
      start = historical(ordinal(doc.start) + Math.floor(span * 0.15));
    if (type === "branch") {
      const from =
          (selected?.kind === "bars"
            ? selectedItem()
            : doc.bars.find((bar) => bar.id === selectedItem()?.fromBarId)) ||
          doc.bars[0],
        to = doc.bars.find((bar) => bar.id !== from.id);
      const year = historical(
        Math.floor((ordinal(from.start) + ordinal(from.end)) / 2),
      );
      o = {
        id: uid(),
        fromBarId: from.id,
        toBarId: to.id,
        fromYear: year,
        toYear: clampYearToBar(
          to,
          historical(Math.min(MAX_YEAR - 1, ordinal(year) + 100)),
        ),
      };
      tab = "bars";
      doc.branches ??= [];
    } else if (type === "bar") {
      o = {
        id: uid(),
        label: t("labelNew", "en"),
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
        label: t("eventNew", "en"),
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
        text:
          type === "image"
            ? ""
            : t(type === "brace" ? "braceNew" : "noteNew", "en"),
        ...(type === "brace"
          ? {
              width: 240,
              height: 240,
              braceWidth: 24,
              strokeWidth: 1.5,
              topText: "",
              bottomText: "",
            }
          : {}),
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
    const kind = type === "branch" ? "branches" : tab;
    doc[kind].push(o);
    selected = { kind, id: o.id };
  });
}
async function saveDraft() {
  if (!doc) return;
  if (!validJoinedPeriods(doc)) throw new Error(t("joinFixBeforeSave"));
  $("#inspector")
    .querySelectorAll("[data-content-locale]")
    .forEach((input) => input.onchange?.());
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
  projectURL(ident);
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
    tab = kind === "branches" ? "bars" : kind;
    if (kind === "branches") {
      renderEditor();
      return;
    }
    const object = selectedItem();
    const svg = $("#canvas svg");
    const at =
      ordinal(doc.start) +
      ((e.clientX - svg.getBoundingClientRect().left) / screenScale() -
        dimensions(doc, screenScale(), language).left / screenScale()) /
        pixelsPerYear(doc);
    const joined =
      kind === "bars" && !e.target.closest("[data-caption]")
        ? joinedPeriodAt(doc, id, at)
        : null;
    drag = {
      scale: screenScale(),
      movingIds: joined ? [joined.fromBarId, joined.toBarId] : [id],
      snapshot: structuredClone(doc),
      id,
      kind,
      x: e.clientX,
      y: e.clientY,
      before: raw(),
      object: structuredClone(object),
      caption: kind === "bars" && !!e.target.closest("[data-caption]"),
      captionLayout: kind === "bars" ? barCaption(doc, object) : null,
      eventCaption:
        kind === "events" && !!e.target.closest("[data-event-caption]"),
      eventCaptionLayout: kind === "events" ? eventCaption(doc, object) : null,
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
    const dx = (e.clientX - drag.x) / drag.scale,
      dy = e.clientY - drag.y;
    if (
      !drag.moved &&
      Math.abs(e.clientX - drag.x) + (drag.caption ? 0 : Math.abs(dy)) < 3
    )
      return;
    drag.moved = true;
    const o = selectedItem(),
      b = drag.object;
    if (drag.kind === "bars" && !drag.caption && e.shiftKey)
      drag.timeOffset = Math.round(dx / pixelsPerYear(doc));
    const offset =
      drag.kind === "bars" && !drag.caption
        ? (drag.timeOffset ?? 0)
        : Math.round(dx / pixelsPerYear(doc));
    if (drag.eventCaption) {
      o.labelPosition = "free";
      o.labelY = Math.max(
        -4000,
        Math.min(8000, drag.eventCaptionLayout.y + dy),
      );
      o.labelOffsetX = Math.max(
        -2000,
        Math.min(2000, drag.eventCaptionLayout.offsetX + e.clientX - drag.x),
      );
      renderCanvas();
      updateStatus();
      return;
    }
    if (drag.caption) {
      const candidate = Math.max(
        -MAX_YEAR,
        Math.min(MAX_YEAR - 1, ordinal(drag.captionLayout.year) + offset),
      );
      const layout = drag.captionLayout;
      o.captionPosition = "free";
      o.captionYear = historical(candidate);
      o.captionOffsetX =
        layout.offsetX -
        (layout.anchor === "end"
          ? textWidth(textFor(b, "label", language), layout.size)
          : 0);
      const base = barSectionAt(doc, o, clampYearToBar(o, layout.year));
      o.captionOffsetY = layout.y - base.y - base.height / 2;
      renderCanvas();
      updateStatus();
      return;
    }
    o.y = Math.round(
      Math.max(
        drag.kind === "bars" ? 60 : 0,
        Math.min(doc.height - (drag.kind === "bars" ? 60 : 0), b.y + dy),
      ),
    );
    if (
      drag.kind === "events" &&
      !b.endBarId &&
      !b.endAxis &&
      b.endY !== undefined
    )
      o.endY = Math.max(-4000, Math.min(8000, b.endY + o.y - b.y));
    if (
      drag.kind === "events" &&
      !b.startBarId &&
      !b.startAxis &&
      b.startY !== undefined
    )
      o.startY = Math.max(-4000, Math.min(8000, b.startY + o.y - b.y));
    if (drag.kind === "bars") {
      moveBars(doc, drag.snapshot, drag.movingIds, dy, offset);
    } else {
      o.year = historical(
        Math.max(-MAX_YEAR, Math.min(MAX_YEAR - 1, ordinal(b.year) + offset)),
      );
      const anchor = doc.bars.find((bar) => bar.id === o.anchorBarId);
      if (anchor) {
        o.year = clampYearToBar(anchor, o.year);
        const top = barSectionAt(doc, anchor, o.year).y;
        const y = Math.max(
          0,
          Math.min(doc.height, top + (b.offsetY ?? 0) + dy),
        );
        o.offsetY = y - top;
      }
    }
    normalizeAttachments();
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
        tab = selected.kind === "branches" ? "bars" : selected.kind;
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
async function exportSvg(horizontalScale) {
  const parsed = new DOMParser().parseFromString(
    renderTimeline(doc, {
      language,
      horizontalScale,
      pixelScale: (doc.mmPerYear * 96) / 25.4 / pixelsPerYear(doc),
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
    initialStretch = zoom * 100;
  dialog.innerHTML = `${closeButton()}<div class="eyebrow">CHRONOSMOS</div><h2>${esc(t("exportTitle"))}</h2><p>${esc(t("exportText"))}</p><label class="field"><span>${esc(t("exportStretch"))}</span><input id="export-stretch" type="number" value="${initialStretch}" min="5" max="3200" step="any" required></label><p class="field-note">${esc(t("exportStretchHint"))}</p><div class="print-dimensions"><span>${esc(t("printSize"))}</span><strong id="export-dimensions" role="status"></strong></div><label class="field"><span>${esc(t("pngScale"))}</span><select id="png-dpi">${[96, 150, 300, 600, 1200].map((dpi) => `<option value="${dpi}">${dpi} DPI</option>`).join("")}</select></label><div class="export-options">${button("svg", 'data-export="svg" class="primary"')}${button("png", 'data-export="png"')}${button("json", 'data-export="json"')}${button("packageExport", 'data-export="package"')}${button("print", 'data-export="print"')}</div><p class="field-note">${esc(t("printHint"))}</p>`;
  const stretchInput = $("#export-stretch");
  stretchInput.oninput = () => {
    if (!stretchInput.checkValidity()) {
      $("#export-dimensions").textContent = "—";
      return;
    }
    const dim = dimensions(doc, Number(stretchInput.value) / 100, language);
    $("#export-dimensions").textContent =
      `${dim.widthMm.toFixed(1)} × ${dim.heightMm.toFixed(1)} mm`;
  };
  stretchInput.oninput();
  wireDialog(dialog);
  dialog.showModal();
  dialog.querySelectorAll("[data-export]").forEach(
    (b) =>
      (b.onclick = action(async () => {
        b.disabled = true;
        try {
          const format = b.dataset.export,
            name = doc.slug.replaceAll("/", "-");
          if (format === "package") {
            const response = await fetch(
              page === "editor"
                ? "/api/packages/export"
                : `/api/timelines/${ident}/package`,
              page === "editor"
                ? {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "X-CSRF-Token": $('meta[name="csrf-token"]').content,
                    },
                    body: JSON.stringify(doc),
                  }
                : {},
            );
            if (!response.ok)
              throw new Error(
                (await response.json()).error || t("exportError"),
              );
            download(await response.blob(), name + ".chronosmos.zip");
            return;
          }
          if (format === "json") {
            download(
              new Blob([JSON.stringify(doc, null, 2)], {
                type: "application/json",
              }),
              name + ".json",
            );
            return;
          }
          if (!stretchInput.reportValidity()) return;
          const horizontalScale = Number(stretchInput.value) / 100;
          const dim = dimensions(doc, horizontalScale, language);
          toast(t("exporting"));
          const svg = await exportSvg(horizontalScale);
          if (format === "svg")
            download(new Blob([svg], { type: "image/svg+xml" }), name + ".svg");
          else if (format === "png") {
            const scale = Number($("#png-dpi").value) / 25.4;
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

async function openAI() {
  await openAssistant({
    api,
    t,
    language,
    getDocument: () => doc,
    apply: async (proposal) => {
      const creating = !doc;
      if (creating && !(await newProject())) return;
      change(() => {
        doc = applyAIProposal(doc, proposal, { newTimeline: creating });
        if (proposal.bars?.length) {
          selected = { kind: "bars", id: proposal.bars.at(-1).id };
          tab = "bars";
        } else if (proposal.events?.length) {
          selected = { kind: "events", id: proposal.events.at(-1).id };
          tab = "events";
        }
      });
      fit();
      toast(t("aiApplied"));
    },
  });
}
async function initEditor() {
  wireInspectorNavigation($("#inspector"));
  wireDragging();
  $("#chooser-ai").onclick = action(openAI);
  $("#ai-open").onclick = action(openAI);
  $("#new-timeline").onclick = action(newProject);
  $("#create-timeline").onclick = action(newProject);
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
    location.href = languageUrl("/");
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
  $("#import-open").onclick = $("#chooser-import").onclick = () =>
    $("#import-file").click();
  $("#import-file").onchange = action(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (/\.zip$/i.test(file.name)) {
      if (file.size > 64 * 1024 * 1024) throw new Error(t("packageTooLarge"));
      if (dirty() && !(await confirmAction(t("leaveQuestion")))) return;
      const form = new FormData();
      form.append("file", file);
      const result = await api("/api/packages/import", {
        method: "POST",
        body: form,
      });
      doc = result.document;
      ident = result.id;
      revision = result.revision;
      textEditorKey = ident;
      published = false;
      publishedSlug = null;
      savedRaw = raw();
      undoStack = [];
      redoStack = [];
      selected = null;
      await refreshProjects();
      renderEditor();
      fit();
      projectURL(ident);
      toast(t("packageImported"));
      e.target.value = "";
      return;
    }
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
    textEditorKey = uid();
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
  const requested =
    new URLSearchParams(location.search).get("timeline") ||
    location.hash.slice(1);
  if (requested === "new") await newProject();
  else if (requested) await loadProject(requested);
  else renderEditor();
}

translate();
$$(".language").forEach((e) => (e.onclick = toggleLanguage));
wireZoom();
if ($("#canvas-viewport"))
  wireViewing($("#canvas-viewport"), {
    isViewing: () => page === "viewer" || preview,
    getDocument: () => doc,
    getLanguage: () => language,
    translate: t,
  });
if ($("#export-open")) $("#export-open").onclick = openExport;
window.addEventListener(
  "languagechange",
  action(async () => {
    if (page === "editor") {
      renderEditor();
      $("#preview").textContent = t(preview ? "closePreview" : "preview");
    } else if (page === "index") await initGallery();
    else if (page === "viewer") {
      renderViewerHeading();
      renderCanvas();
    }
  }),
);
await action(async () => {
  if (page === "index") await initGallery();
  if (page === "viewer") await initViewer();
  if (page === "editor") await initEditor();
})();
