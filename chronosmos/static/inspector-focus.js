// Committing a property can replace the inspector DOM. Resolve the next control
// after that commit, rather than leaving Tab attached to the removed input.
const controls = "input, textarea, select, button, a[href]";
const keyFor = (control) =>
  control.id ||
  (control.dataset.periodField
    ? `period:${control.closest("[data-height-period]").dataset.heightPeriod}:${control.dataset.periodField}`
    : control.dataset.removePeriod
      ? `remove:${control.dataset.removePeriod}`
      : control.getAttribute("href"));
function available(control, visibility) {
  if (
    control.disabled ||
    control.type === "hidden" ||
    control.tabIndex < 0 ||
    control.closest("[hidden], dialog:not([open])")
  )
    return false;
  for (let node = control; node; node = node.parentElement) {
    if (!visibility.has(node)) {
      const style = control.ownerDocument.defaultView.getComputedStyle(node);
      visibility.set(
        node,
        style.display !== "none" && style.visibility !== "hidden",
      );
    }
    if (!visibility.get(node)) return false;
  }
  return true;
}
export function wireInspectorNavigation(inspector) {
  inspector.addEventListener(
    "change",
    (event) => {
      const control = event.target;
      const doc = inspector.ownerDocument;
      if (doc.activeElement !== control) return;
      const key = keyFor(control);
      // Selects and number steppers may commit before blur. Retain their focus
      // when that commit rebuilds the fields, without stealing a mouse click.
      queueMicrotask(() => {
        if (control.isConnected || doc.activeElement !== doc.body) return;
        [...inspector.querySelectorAll(controls)]
          .find((node) => keyFor(node) === key)
          ?.focus();
      });
    },
    true,
  );
  inspector.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey)
      return;
    const control = event.target.closest(controls);
    if (!control || !inspector.contains(control)) return;
    const key = keyFor(control);
    event.preventDefault();
    if (control.matches("input, textarea, select")) control.onchange?.();
    control.blur();
    const current = [...inspector.querySelectorAll(controls)].find(
      (node) => keyFor(node) === key,
    );
    const visibility = new Map();
    const inside = [...inspector.querySelectorAll(controls)].filter((node) =>
      available(node, visibility),
    );
    const step = event.shiftKey ? -1 : 1;
    const index = inside.indexOf(current);
    if (index >= 0 && inside[index + step]) inside[index + step].focus();
    else {
      // Preserve normal navigation out of the panel; do not trap keyboard focus.
      const order = [
        ...inspector.ownerDocument.querySelectorAll(controls + ", [tabindex]"),
      ].filter((node) => available(node, visibility));
      const globalIndex = order.indexOf(current);
      if (globalIndex >= 0 && order.length)
        order[(globalIndex + step + order.length) % order.length].focus();
    }
  });
}
