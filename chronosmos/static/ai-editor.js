import { esc, yearLabel } from "./timeline.js";
import { researchHtml } from "./research.js";
let state = null,
  generation = 0;
export async function openAssistant({ api, t, language, getDocument, apply }) {
  const run = ++generation;
  const dialog = document.querySelector("#ai-dialog");
  const status = await api("/api/ai/status");
  const context = getDocument();
  const fingerprint = JSON.stringify(context);
  dialog.innerHTML = `<button class="dialog-close" aria-label="${esc(t("close"))}">×</button><h2>${esc(t("aiAssistant"))}</h2><p>${esc(t(context ? "aiAddIntro" : "aiNewIntro"))}</p><p class="field-note">${esc(t("aiPrivacy"))}</p><form id="ai-form"><label class="field"><span>${esc(t("aiRequest"))}</span><textarea id="ai-prompt" minlength="10" maxlength="6000" rows="4" required></textarea></label><div class="dialog-actions"><button type="submit" class="primary" ${status.configured ? "" : "disabled"}>${esc(t("aiResearch"))}</button></div></form><p id="ai-status" role="status"></p><div id="ai-proposal"></div>`;
  dialog.querySelector(".dialog-close").onclick = () => dialog.close();
  dialog.showModal();
  const message = dialog.querySelector("#ai-status"),
    results = dialog.querySelector("#ai-proposal"),
    form = dialog.querySelector("#ai-form");
  if (!status.configured) message.textContent = t("aiNotConfigured");
  const show = () => {
    const proposal = state.proposal;
    message.textContent = t("aiReview");
    results.innerHTML = `<h3>${esc(proposal.title)}</h3><p>${esc(proposal.description)}</p>${proposal.bars.map((b, i) => `<article class="ai-bar"><label class="checkbox-field"><input type="checkbox" data-ai-bar="${i}" checked><strong>${esc(b.label)}</strong></label><p>${esc(yearLabel(b.start, language))} — ${esc(yearLabel(b.end, language))}</p>${researchHtml({ ...b, model: proposal.model, checkedAt: proposal.checkedAt }, t("dateSources"))}</article>`).join("")}<div class="dialog-actions"><button id="ai-apply" class="primary" ${proposal.bars.length ? "" : "disabled"}>${esc(t(context ? "aiApplyBars" : "aiApplyNew"))}</button></div>`;
    results.querySelectorAll("details").forEach((d) => (d.open = true));
    results.querySelector("#ai-apply").onclick = async () => {
      if (JSON.stringify(getDocument()) !== fingerprint) {
        message.textContent = t("aiDraftChanged");
        return;
      }
      const selected = [
        ...results.querySelectorAll("[data-ai-bar]:checked"),
      ].map((el) => proposal.bars[Number(el.dataset.aiBar)]);
      if (!selected.length) return;
      try {
        await apply({ ...proposal, bars: selected });
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
        if (result.status === "failed") throw new Error(result.error);
        if (result.status === "completed") {
          state.proposal = result.proposal;
          state.job = null;
          if (dialog.open && run === generation) show();
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
          document: context,
        }),
      });
      state = { job: result.job, fingerprint };
      await poll();
    } catch (e) {
      message.textContent = e.message;
      form.querySelector("button").disabled = !status.configured;
    }
  };
  if (state?.proposal) show();
  else if (state?.job) {
    await poll();
  } else if (status.job) {
    state = { job: status.job, fingerprint };
    await poll();
  }
}
