// Plain fields hold the English base. Each translated field falls back separately.
export function textFor(object, field, language = "en") {
  const base = typeof object?.[field] === "string" ? object[field] : "";
  const locale = language.toLowerCase();
  if (locale.split("-")[0] === "en") return base;
  for (const key of new Set([locale, locale.split("-")[0]])) {
    const value = object?.translations?.[key]?.[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  return base;
}
