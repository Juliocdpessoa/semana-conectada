export type ColorTheme = "light" | "dark";
export const ACTIVE_THEME_USER_KEY = "nexo:theme:active-user";
export const themeStorageKey = (userId: string) => `nexo:theme:${userId}`;

export function readUserTheme(storage: Pick<Storage, "getItem">, userId: string): ColorTheme {
  try { return storage.getItem(themeStorageKey(userId)) === "dark" ? "dark" : "light"; }
  catch { return "light"; }
}

export function saveUserTheme(storage: Pick<Storage, "setItem">, userId: string, theme: ColorTheme) {
  try {
    storage.setItem(themeStorageKey(userId), theme);
    storage.setItem(ACTIVE_THEME_USER_KEY, userId);
  } catch { /* The selector still works when browser storage is unavailable. */ }
}

export function applyColorTheme(theme: ColorTheme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

// Static, before-paint script. No user content is interpolated into JavaScript.
export const COLOR_THEME_BOOTSTRAP = `try{var u=localStorage.getItem('nexo:theme:active-user');var t=u&&localStorage.getItem('nexo:theme:'+u)==='dark'?'dark':'light';document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.colorScheme=t}catch(e){}`;
