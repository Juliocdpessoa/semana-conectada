import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { ACTIVE_THEME_USER_KEY, COLOR_THEME_BOOTSTRAP, readUserTheme, saveUserTheme, themeStorageKey } from "../src/lib/color-theme.ts";

const storage = () => {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
};
test("light is the default, including invalid preferences", () => {
  const s = storage();
  assert.equal(readUserTheme(s, "one"), "light");
  s.setItem(themeStorageKey("one"), "invalid");
  assert.equal(readUserTheme(s, "one"), "light");
});
test("choices persist independently for different users", () => {
  const s = storage();
  saveUserTheme(s, "one", "dark");
  assert.equal(readUserTheme(s, "one"), "dark");
  assert.equal(readUserTheme(s, "two"), "light");
  saveUserTheme(s, "two", "light");
  assert.equal(s.getItem(ACTIVE_THEME_USER_KEY), "two");
  assert.equal(readUserTheme(s, "one"), "dark");
});
test("unavailable storage never prevents app startup", () => {
  const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  assert.equal(readUserTheme(blocked, "one"), "light");
  assert.doesNotThrow(() => saveUserTheme(blocked, "one", "dark"));
});
test("before-paint bootstrap restores the active user's theme", () => {
  const s = storage();
  saveUserTheme(s, "one", "dark");
  const root = { classList: { toggle: (key, on) => { root.dark = on; } }, style: {} };
  vm.runInNewContext(COLOR_THEME_BOOTSTRAP, { localStorage: s, document: { documentElement: root } });
  assert.equal(root.dark, true);
  assert.equal(root.style.colorScheme, "dark");
  saveUserTheme(s, "one", "light");
  vm.runInNewContext(COLOR_THEME_BOOTSTRAP, { localStorage: s, document: { documentElement: root } });
  assert.equal(root.dark, false);
  assert.equal(root.style.colorScheme, "light");
});
