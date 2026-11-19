/**
 * «روزنامچه دخل»: preset date ranges. Month/week boundaries follow the app's
 * calendar setting — Jalali (Shamsi) months and Saturday-start weeks, or
 * Gregorian months and Monday-start weeks.
 */
import type { CalendarMode } from "@/lib/types";
import {
  gregorianToJalali,
  jalaliMonthLength,
  jalaliToGregorianIso,
  parseIso,
  toIso,
} from "@/lib/jalali";

export type PeriodPreset =
  "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";

export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  today: "امروز",
  yesterday: "دیروز",
  this_week: "این هفته",
  last_week: "هفته قبل",
  this_month: "این ماه",
  last_month: "ماه گذشته",
  custom: "بازه دلخواه",
};

export const PERIOD_ORDER: PeriodPreset[] = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "custom",
];

export function shiftIso(iso: string, days: number): string {
  const { y, m, d } = parseIso(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Days since the first day of the week: Saturday for Jalali, Monday for Gregorian. */
function weekOffset(iso: string, mode: CalendarMode): number {
  const { y, m, d } = parseIso(iso);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday … 6 = Saturday
  return mode === "jalali" ? (dow + 1) % 7 : (dow + 6) % 7;
}

export function monthStart(iso: string, mode: CalendarMode): string {
  if (mode === "jalali") {
    const j = gregorianToJalali(iso);
    return jalaliToGregorianIso(j.y, j.m, 1);
  }
  const { y, m } = parseIso(iso);
  return toIso(y, m, 1);
}

/** Inclusive [from, to] for a preset; `today` is YYYY-MM-DD. Custom returns today. */
export function periodRange(
  preset: PeriodPreset,
  today: string,
  mode: CalendarMode,
): { from: string; to: string } {
  switch (preset) {
    case "yesterday": {
      const y = shiftIso(today, -1);
      return { from: y, to: y };
    }
    case "this_week":
      return { from: shiftIso(today, -weekOffset(today, mode)), to: today };
    case "last_week": {
      const start = shiftIso(today, -weekOffset(today, mode));
      return { from: shiftIso(start, -7), to: shiftIso(start, -1) };
    }
    case "this_month":
      return { from: monthStart(today, mode), to: today };
    case "last_month": {
      const end = shiftIso(monthStart(today, mode), -1);
      return { from: monthStart(end, mode), to: end };
    }
    default:
      return { from: today, to: today };
  }
}

/** Length check helper used by tests: last month's day count in the active calendar. */
export function monthLengthOf(iso: string, mode: CalendarMode): number {
  if (mode === "jalali") {
    const j = gregorianToJalali(iso);
    return jalaliMonthLength(j.y, j.m);
  }
  const { y, m } = parseIso(iso);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
