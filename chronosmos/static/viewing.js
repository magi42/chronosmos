import { textFor } from "./content.js";

export function wireViewing(
  viewport,
  { isViewing, getDocument, getLanguage, translate },
) {
  let pan = null,
    suppressClick = false;
  const detail = document.createElement("dialog");
  detail.id = "detail-dialog";
  detail.className = "detail-dialog";
  detail.setAttribute("aria-label", translate("enlargedDetail"));
  document.body.append(detail);
  const enlarge = (id) => {
    const overlay = getDocument()?.overlays.find((o) => o.id === id);
    if (!overlay) return;
    detail.setAttribute("aria-label", translate("enlargedDetail"));
    detail.replaceChildren();
    const close = document.createElement("button");
    close.className = "detail-close";
    close.textContent = translate("close");
    detail.append(close);
    if (overlay.type === "image") {
      const img = document.createElement("img");
      img.src = "/media/" + overlay.mediaId + ".png";
      img.alt = textFor(overlay, "text", getLanguage()) || translate("image");
      detail.append(img);
    } else if (overlay.type === "brace") {
      const source = [...viewport.querySelectorAll("[data-view-id]")].find(
        (node) => node.dataset.viewId === id,
      );
      const bounds = source?.querySelector("rect");
      if (!source || !bounds) return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const x = Number(bounds.getAttribute("x")),
        y = Number(bounds.getAttribute("y"));
      svg.setAttribute(
        "viewBox",
        `${x - 4} ${y - 4} ${overlay.width + 8} ${overlay.height + 8}`,
      );
      svg.setAttribute("width", (overlay.width + 8) * 2);
      svg.setAttribute("height", (overlay.height + 8) * 2);
      svg.setAttribute("font-family", "Arial, sans-serif");
      svg.classList.add("detail-brace");
      svg.setAttribute("role", "img");
      svg.setAttribute(
        "aria-label",
        ["topText", "text", "bottomText"]
          .map((field) => textFor(overlay, field, getLanguage()))
          .filter(Boolean)
          .join(" · ") || translate("brace"),
      );
      svg.style.background = getDocument().background;
      const clone = source.cloneNode(true);
      for (const attribute of ["data-view-id", "tabindex", "role", "style"])
        clone.removeAttribute(attribute);
      svg.append(clone);
      detail.append(svg);
    } else {
      const text = document.createElement("div");
      text.className = "detail-text";
      text.textContent = textFor(overlay, "text", getLanguage());
      text.style.color = overlay.color;
      text.style.background =
        overlay.type === "box" ? overlay.fill : getDocument().background;
      text.style.fontSize =
        Math.max(24, Math.min(60, overlay.fontSize * 1.8)) + "px";
      detail.append(text);
    }
    detail.showModal();
  };
  document.addEventListener(
    "click",
    (e) => {
      if (detail.open) {
        e.preventDefault();
        e.stopPropagation();
        detail.close();
      }
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (detail.open && e.key === "Escape") {
      e.preventDefault();
      detail.close();
    }
  });
  viewport.addEventListener("pointerdown", (e) => {
    if (
      !isViewing() ||
      e.button !== 0 ||
      (e.pointerType && e.pointerType !== "mouse")
    )
      return;
    const r = viewport.getBoundingClientRect();
    // Keep native scrollbar handles usable.
    if (
      e.target === viewport &&
      (e.clientX - r.left >= viewport.clientWidth ||
        e.clientY - r.top >= viewport.clientHeight)
    )
      return;
    suppressClick = false;
    pan = {
      x: e.clientX,
      y: e.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      moved: false,
    };
    e.preventDefault();
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!pan) return;
    const dx = e.clientX - pan.x,
      dy = e.clientY - pan.y;
    if (!pan.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      pan.moved = true;
      viewport.setPointerCapture?.(e.pointerId);
    }
    if (pan.moved) {
      viewport.scrollLeft = pan.left - dx;
      viewport.scrollTop = pan.top - dy;
      viewport.classList.add("panning");
    }
  });
  const stop = () => {
    if (pan) suppressClick = pan.moved;
    pan = null;
    viewport.classList.remove("panning");
  };
  viewport.addEventListener("pointerup", stop);
  viewport.addEventListener("pointercancel", stop);
  viewport.addEventListener("lostpointercapture", stop);
  window.addEventListener("pointerup", stop);
  window.addEventListener("blur", stop);
  viewport.addEventListener(
    "click",
    (e) => {
      if (!isViewing()) return;
      if (suppressClick) {
        suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const target = e.target.closest("[data-view-id]");
      if (target) enlarge(target.dataset.viewId);
    },
    true,
  );
  viewport.addEventListener("keydown", (e) => {
    const target = e.target.closest("[data-view-id]");
    if (isViewing() && target && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      enlarge(target.dataset.viewId);
    }
  });
}
