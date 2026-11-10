import { esc } from "./timeline.js";
export function researchHtml(research, heading) {
  if (!research) return "";
  const sources = (research.sources ?? []).filter((s) =>
    /^https?:\/\//.test(s.url),
  );
  return `<details class="research"><summary>${esc(heading)}</summary><p>${esc(research.note ?? "")}</p><ul>${sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></li>`).join("")}</ul><small>${esc(research.model ?? "")} · ${esc(research.checkedAt?.slice(0, 10) ?? "")}</small></details>`;
}
