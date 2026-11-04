import { createContext, useContext } from "react";
import { DEFAULT_SETTINGS, type AppSettings, type CalendarMode } from "@/lib/types";

const PrefsContext = createContext<AppSettings>(DEFAULT_SETTINGS);
const CACHE_KEY = "dftar-appearance";

export const PrefsProvider = PrefsContext.Provider;

export function usePrefs(): AppSettings {
  return useContext(PrefsContext);
}

export function useCalendarMode(): CalendarMode {
  return useContext(PrefsContext).calendar;
}

function mix(hex: string, other: string, amount: number): string {
  const a = parseHex(hex);
  const b = parseHex(other);
  if (!a || !b) return hex;
  const t = Math.min(1, Math.max(0, amount));
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  if (typeof hex !== "string" || !hex) return null;
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0.5;
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

function contrastRatio(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const LEGACY_FACTORY = {
  theme: "light" as const,
  fontColor: "#1c1916",
  primaryColor: "#1b4d3e",
  bgColor: "#f4f0e6",
  accentColor: "#8a6a2f",
  dangerColor: "#8f3a32",
};

const TEAL_SKIN = {
  theme: "dark" as const,
  fontColor: "#e6eeea",
  primaryColor: "#1f9d8a",
  bgColor: "#0c1114",
  accentColor: "#d4b06a",
  dangerColor: "#e06c64",
};

const NAZM_SKIN = {
  theme: "dark" as const,
  fontColor: "#f7f2f6",
  primaryColor: "#ff2d6a",
  bgColor: "#07040c",
  accentColor: "#f4c27a",
  dangerColor: "#ff4d4d",
};

function hexEq(a: string | undefined, b: string) {
  return (a ?? "").trim().toLowerCase() === b;
}

function samePalette(
  settings: AppSettings,
  palette: { theme: "light" | "dark"; fontColor: string; primaryColor: string; bgColor: string; accentColor: string; dangerColor: string },
) {
  return (
    settings.theme === palette.theme &&
    hexEq(settings.fontColor, palette.fontColor) &&
    hexEq(settings.primaryColor, palette.primaryColor) &&
    hexEq(settings.bgColor, palette.bgColor) &&
    hexEq(settings.accentColor, palette.accentColor) &&
    hexEq(settings.dangerColor, palette.dangerColor)
  );
}

/** Paint factory or the interim teal skin as the Nazm glass theme. Custom colors pass through. */
export function paintTraderban<T extends AppSettings>(settings: T): T {
  if (samePalette(settings, LEGACY_FACTORY) || samePalette(settings, TEAL_SKIN)) {
    return { ...settings, ...NAZM_SKIN };
  }
  return settings;
}

export function ensureThemeContrast(settings: AppSettings): AppSettings {
  if (settings.theme === "dark") return settings;
  if (luminance(settings.bgColor) < 0.55) return { ...settings, bgColor: "#f6f0f3" };
  return settings;
}

function visualOf(settings: AppSettings) {
  return {
    theme: settings.theme,
    fontSize: settings.fontSize,
    fontFamily: settings.fontFamily,
    fontColor: settings.fontColor,
    primaryColor: settings.primaryColor,
    bgColor: settings.bgColor,
    accentColor: settings.accentColor,
    dangerColor: settings.dangerColor,
    listColor: settings.listColor,
    cardTint: settings.cardTint,
    cardTintStrength: settings.cardTintStrength,
  };
}

export function applyAppearance(settings: AppSettings) {
  if (typeof document === "undefined") return;
  const visual = ensureThemeContrast(paintTraderban(settings));
  const root = document.documentElement;
  root.classList.toggle("theme-dark", visual.theme === "dark");
  root.classList.toggle("theme-light", visual.theme !== "dark");
  root.classList.toggle("card-tint", visual.cardTint !== false);
  const strength = Math.min(100, Math.max(0, visual.cardTintStrength ?? 40));
  const tintMix = Math.min(100, 14 + strength * 0.86);
  const extra = Math.min(78, Math.round(strength * 0.78));
  root.style.setProperty("--dash-tint-mix", `${tintMix}%`);
  root.style.setProperty("--dash-tint-extra", `${extra}%`);
  root.style.fontSize = `${visual.fontSize}px`;
  const fontFamily = visual.fontFamily || DEFAULT_SETTINGS.fontFamily;
  root.style.fontFamily = `"${fontFamily}", "Vazirmatn", sans-serif`;
  root.style.setProperty("--font-sans", `"${fontFamily}", "Vazirmatn", sans-serif`);
  root.style.setProperty("--color-fg", visual.fontColor);
  root.style.setProperty("--color-muted", visual.fontColor);
  root.style.setProperty("--color-subtle", visual.fontColor);
  root.style.setProperty("--color-primary", visual.primaryColor);
  root.style.setProperty("--color-bg", visual.bgColor);
  root.style.setProperty("--color-warn", visual.accentColor || DEFAULT_SETTINGS.accentColor);
  root.style.setProperty("--color-danger", visual.dangerColor || DEFAULT_SETTINGS.dangerColor);
  root.style.setProperty("--color-list", visual.listColor || DEFAULT_SETTINGS.listColor);
  const fgOnPrimary = luminance(visual.primaryColor) > 0.62 ? "#10211c" : "#f4fbf9";
  root.style.setProperty("--color-primary-fg", fgOnPrimary);
  const ink = visual.theme === "dark" ? "#07040c" : "#ffffff";
  const paper = visual.theme === "dark" ? "#2a0e24" : "#ffffff";
  root.style.setProperty("--color-primary-soft", mix(visual.primaryColor, ink, visual.theme === "dark" ? 0.72 : 0.82));
  root.style.setProperty("--color-surface", mix(visual.bgColor, paper, visual.theme === "dark" ? 0.28 : 0.55));
  root.style.setProperty("--color-surface-2", mix(visual.bgColor, visual.fontColor, visual.theme === "dark" ? 0.14 : 0.08));
  root.style.setProperty("--color-border", mix(visual.bgColor, visual.fontColor, visual.theme === "dark" ? 0.28 : 0.16));
  root.style.setProperty("--color-border-strong", mix(visual.bgColor, visual.fontColor, visual.theme === "dark" ? 0.42 : 0.28));
  root.style.setProperty("--color-bg-warm", mix(visual.bgColor, visual.fontColor, visual.theme === "dark" ? 0.08 : 0.04));
  root.style.setProperty("--color-danger-soft", mix(visual.dangerColor || DEFAULT_SETTINGS.dangerColor, ink, 0.82));
  root.style.setProperty("--color-warn-soft", mix(visual.accentColor || DEFAULT_SETTINGS.accentColor, ink, 0.82));
  root.style.setProperty("--color-tab-a", mix(visual.primaryColor, ink, visual.theme === "dark" ? 0.62 : 0.78));
  root.style.setProperty("--color-tab-b", mix(visual.accentColor || DEFAULT_SETTINGS.accentColor, ink, visual.theme === "dark" ? 0.58 : 0.72));
  root.style.setProperty("--color-tab-c", mix(visual.bgColor, visual.fontColor, visual.theme === "dark" ? 0.2 : 0.12));
  root.style.setProperty("--color-tab-d", mix(visual.primaryColor, visual.bgColor, 0.55));
  root.style.setProperty(
    "--color-tab-e",
    mix(visual.accentColor || DEFAULT_SETTINGS.accentColor, visual.dangerColor || DEFAULT_SETTINGS.dangerColor, visual.theme === "dark" ? 0.42 : 0.62),
  );
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(visualOf(visual)));
  } catch {
    /* ignore */
  }
}

export function restoreCachedAppearance() {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw) as Partial<AppSettings>;
    applyAppearance({ ...DEFAULT_SETTINGS, ...cached });
  } catch {
    /* ignore */
  }
}
