import { useLayoutEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyColorTheme, readUserTheme, saveUserTheme, themeStorageKey, type ColorTheme } from "@/lib/color-theme";

export function ThemeToggle({ userId }: { userId: string }) {
  const [theme, setTheme] = useState<ColorTheme>("light");
  useLayoutEffect(() => {
    let next: ColorTheme = "light";
    try { next = readUserTheme(window.localStorage, userId); } catch { /* Storage may be disabled. */ }
    setTheme(next);
    applyColorTheme(next);
    try { saveUserTheme(window.localStorage, userId, next); } catch { /* Keep the in-memory choice. */ }
    const sync = (event: StorageEvent) => {
      if (event.key !== null && event.key !== themeStorageKey(userId)) return;
      const updated = event.newValue === "dark" ? "dark" : "light";
      setTheme(updated);
      applyColorTheme(updated);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [userId]);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyColorTheme(next);
    try { saveUserTheme(window.localStorage, userId, next); } catch { /* Keep the in-memory choice. */ }
  }

  return (
    <button type="button" onClick={toggle} aria-pressed={theme === "dark"}
      aria-label="Tema escuro" title={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
      className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-2 text-[11px] text-white hover:bg-white/20">
      {theme === "dark" ? <Sun aria-hidden="true" className="h-4 w-4" /> : <Moon aria-hidden="true" className="h-4 w-4" />}
      <span className="hidden xl:inline">{theme === "dark" ? "Escuro" : "Claro"}</span>
    </button>
  );
}
