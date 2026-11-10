import { esc, yearLabel } from "./timeline.js";
import { textFor } from "./content.js";
import { researchHtml } from "./research.js";
let state = null,
  generation = 0;
export async function openAssistant({ api, t, language, getDocument, apply }) {
  const run = ++generation,
    dialog = document.querySelector("#ai-dialog");
  const status = await api("/api/ai/status"),
    context = getDocument(),
    fingerprint = JSON.stringify(context);
  dialog.innerHTML = `<button class="dialog-close" aria-label="${esc(t("close"))}">×</button><h2>${esc(t("aiAssistant"))}</h2><p>${esc(t(context ? "aiAddIntro" : "aiNewIntro"))}</p><p class="field-note">${esc(t("aiPrivacy"))}</p><form id="ai-form"><label class="field"><span>${esc(t("aiMode"))}</span><select id="ai-mode"><option value="compose">${esc(t("aiCompose"))}</option>${context ? `<option value="translate">${esc(t("aiTranslateOnly"))}</option>` : ""}</select></label><label class="field"><span>${esc(t("aiRequest"))}</span><textarea id="ai-prompt" minlength="10" maxlength="6000" rows="4" required></textarea></label><p class="field-note">${esc(t("aiTranslationsDefault"))}</p><div class="dialog-actions"><button type="submit" class="primary" ${status.configured ? "" : "disabled"}>${esc(t("aiResearch"))}</button></div></form><p id="ai-status" role="status"></p><div id="ai-proposal"></div>`;
  dialog.querySelector(".dialog-close").onclick = () => dialog.close();
  dialog.showModal();
  const message = dialog.querySelector("#ai-status"),
    results = dialog.querySelector("#ai-proposal"),
    form = dialog.querySelector("#ai-form");
  if (!status.configured) message.textContent = t("aiNotConfigured");
  form.querySelector("select").onchange = () => {
    if (form.querySelector("select").value === "translate")
      form.querySelector("textarea").value = t("aiTranslatePrompt");
  };
  const show = () => {
    const p = state.proposal,
      barMap = new Map(
        [...(context?.bars ?? []), ...p.bars].map((b) => [b.id, b]),
      );
    const name = (id) => textFor(barMap.get(id), "label", language) || id;
    message.textContent = t("aiReview");
    const check = (kind, item, label, body) =>
      `<article class="ai-bar"><label class="checkbox-field"><input type="checkbox" data-ai-kind="${kind}" data-ai-id="${esc(item.id)}" checked><strong>${esc(label)}</strong></label>${body}${researchHtml(item.research, t("dateSources"))}</article>`;
    results.innerHTML =
      `<h3>${esc(textFor(p, "title", language))}</h3><p>${esc(textFor(p, "description", language))}</p>` +
      p.bars
        .map((b) =>
          check(
            "bars",
            b,
            textFor(b, "label", language),
            `<p>${esc(yearLabel(b.start, language))} — ${esc(yearLabel(b.end, language))}</p>`,
          ),
        )
        .join("") +
      (p.joinedPeriods ?? [])
        .map((j) =>
          check(
            "joinedPeriods",
            j,
            t("joinedPeriods") +
              ": " +
              name(j.fromBarId) +
              " ↔ " +
              name(j.toBarId),
            `<p>${esc(yearLabel(j.start, language))} — ${esc(yearLabel(j.end, language))}</p>`,
          ),
        )
        .join("") +
      (p.events ?? [])
        .map((e) =>
          check(
            "events",
            e,
            textFor(e, "label", language),
            `<p>${esc(yearLabel(e.year, language))} · ${esc(e.startBarId ? name(e.startBarId) : t("top"))} → ${esc(e.endBarId ? name(e.endBarId) : t("bottom"))}</p>`,
          ),
        )
        .join("") +
      (p.translationUpdates?.length
        ? `<article class="ai-bar"><label class="checkbox-field"><input type="checkbox" id="ai-apply-translations" checked><strong>${esc(t("aiMissingTranslations"))}</strong></label>${p.translationUpdates
            .map((patch) => {
              const target =
                patch.kind === "timeline"
                  ? context
                  : context?.[patch.kind]?.find((i) => i.id === patch.id);
              return `<p><strong>${esc(target?.title || target?.label || target?.text || patch.id)}</strong></p>${patch.fields.map((f) => `<p>${esc(t(f.field))}: ${esc(f.text)}</p>`).join("")}`;
            })
            .join("")}</article>`
        : "") +
      `<p id="ai-dependencies" class="field-note"></p><div class="dialog-actions"><button id="ai-apply" class="primary">${esc(t(context ? "aiApplyChanges" : "aiApplyNew"))}</button></div>`;
    results.querySelectorAll("details").forEach((d) => (d.open = true));
    const selected = (kind) =>
      new Set(
        [...results.querySelectorAll(`[data-ai-kind="${kind}"]:checked`)].map(
          (el) => el.dataset.aiId,
        ),
      );
    const sync = () => {
      const bars = new Set([
        ...(context?.bars ?? []).map((b) => b.id),
        ...selected("bars"),
      ]);
      let excluded = 0;
      for (const kind of ["joinedPeriods", "events"])
        for (const item of p[kind] ?? []) {
          const el = [
            ...results.querySelectorAll(`[data-ai-kind="${kind}"]`),
          ].find((el) => el.dataset.aiId === item.id);
          const refs =
            kind === "joinedPeriods"
              ? [item.fromBarId, item.toBarId]
              : [item.startBarId, item.endBarId].filter(Boolean);
          el.disabled = refs.some((id) => !bars.has(id));
          if (el.disabled) excluded++;
        }
      results.querySelector("#ai-dependencies").textContent = excluded
        ? t("aiDependencies")
        : "";
      results.querySelector("#ai-apply").disabled = !results.querySelector(
        "[data-ai-kind]:checked:not(:disabled),#ai-apply-translations:checked",
      );
    };
    results.querySelectorAll("input").forEach((el) => (el.onchange = sync));
    sync();
    results.querySelector("#ai-apply").onclick = async () => {
      if (JSON.stringify(getDocument()) !== fingerprint) {
        message.textContent = t("aiDraftChanged");
        return;
      }
      const proposal = { ...p };
      for (const kind of ["bars", "joinedPeriods", "events"]) {
        const ids = new Set(
          [
            ...results.querySelectorAll(
              `[data-ai-kind="${kind}"]:checked:not(:disabled)`,
            ),
          ].map((el) => el.dataset.aiId),
        );
        proposal[kind] = (p[kind] ?? []).filter((v) => ids.has(v.id));
      }
      if (!results.querySelector("#ai-apply-translations:checked"))
        proposal.translationUpdates = [];
      try {
        await apply(proposal);
        dialog.close();
        state = null;
      } catch (e) {
        message.textContent = e.message;
      }
    };
  };
  const poll = async () => {
    form.querySelector("button").disabled = true;
    message.textContent = t("aiResearching");
    try {
      while (state?.job && run === generation && dialog.open) {
        const result = await api("/api/ai/jobs/" + state.job);
        if (run !== generation) return;
        if (result.status === "failed") throw Error(result.error);
        if (result.status === "completed") {
          state.proposal = result.proposal;
          state.job = null;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (e) {
      if (run !== generation) return;
      state = null;
      message.textContent = e.message;
    } finally {
      if (run === generation) {
        form.querySelector("button").disabled = !status.configured;
        if (state?.proposal && dialog.open) show();
      }
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || state?.job) return;
    results.innerHTML = "";
    form.querySelector("button").disabled = true;
    try {
      const result = await api("/api/ai/jobs", {
        method: "POST",
        body: JSON.stringify({
          prompt: form.querySelector("textarea").value,
          mode: form.querySelector("select").value,
          document: context,
        }),
      });
      state = { job: result.job };
      await poll();
    } catch (e) {
      message.textContent = e.message;
      form.querySelector("button").disabled = !status.configured;
    }
  };
  if (state?.proposal) show();
  else if (state?.job) await poll();
  else if (status.job) {
    state = { job: status.job };
    await poll();
  }
}
