import test from "node:test";
import assert from "node:assert/strict";
globalThis.localStorage = { getItem: () => null };
Object.defineProperty(globalThis, "navigator", {
  value: { languages: ["en-US", "fi"] },
  configurable: true,
});
const { detectLanguage, language, translations } = await import(
  "../chronosmos/static/i18n.js"
);
test("browser language follows the first supported preference", () => {
  assert.equal(language, "en");
  assert.equal(detectLanguage(["fi-FI", "en"]), "fi");
  assert.equal(detectLanguage(["sv-SE", "fi"]), "fi");
  assert.equal(detectLanguage(["de"]), "en");
  assert.equal(detectLanguage([]), "en");
});
test("all English interface messages have Finnish translations", () => {
  assert.deepEqual(
    Object.keys(translations.en).sort(),
    Object.keys(translations.fi).sort(),
  );
});
