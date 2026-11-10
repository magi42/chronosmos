import test from "node:test";
import assert from "node:assert/strict";
globalThis.localStorage = { getItem: () => null };
Object.defineProperty(globalThis, "navigator", {
  value: { languages: ["en-US", "fi"] },
  configurable: true,
});
const { detectLanguage, preferredLanguage, language, translations } =
  await import("../chronosmos/static/i18n.js");
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

test("URL language overrides saved and browser preferences without accepting unsupported languages", () => {
  assert.equal(preferredLanguage("?lang=fi", "en", ["en-US"]), "fi");
  assert.equal(preferredLanguage("?lang=en", "fi", ["fi-FI"]), "en");
  assert.equal(preferredLanguage("?lang=fi-FI", "en", ["en-US"]), "fi");
  assert.equal(preferredLanguage("?lang=xx", "fi", ["en"]), "fi");
  assert.equal(preferredLanguage("?lang=xx", "xx", ["fi"]), "fi");
});
