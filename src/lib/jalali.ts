import { jalaaliMonthLength as jMonthLen, toGregorian, toJalaali } from "jalaali-js";
import { isoToDisplay } from "./format";
import type { CalendarMode } from "./types";

export const JALALI_MONTHS = [
  "حمل",
  "ثور",
  "جوزا",
  "سرطان",
  "اسد",
  "سنبله",
  "میزان",
  "عقرب",
  "قوس",
  "جدی",
  "دلو",
  "حوت",
] as const;

export const GREGORIAN_MONTHS = [
  "جنوری",
  "فبروری",
  "مارچ",
  "اپریل",
  "می",
  "جون",
  "جولای",
  "اگست",
  "سپتمبر",
  "اکتوبر",
  "نومبر",
  "دسمبر",
] as const;

export const WEEKDAYS = [
  "شنبه",
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
] as const;

export const WEEKDAYS_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"] as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function parseIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function toIso(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function gregorianToJalali(iso: string): { y: number; m: number; d: number } {
  const { y, m, d } = parseIso(iso);
  const j = toJalaali(y, m, d);
  return { y: j.jy, m: j.jm, d: j.jd };
}

export function jalaliToGregorianIso(jy: number, jm: number, jd: number): string {
  const g = toGregorian(jy, jm, jd);
  return toIso(g.gy, g.gm, g.gd);
}

export function formatJalaliDisplay(iso: string): string {
  const j = gregorianToJalali(iso);
  return `${pad(j.d)}-${pad(j.m)}-${j.y}`;
}

export function formatJalaliYmd(iso: string): string {
  const j = gregorianToJalali(iso);
  return `${j.y}-${pad(j.m)}-${pad(j.d)}`;
}

export function weekdayDari(iso: string): string {
  const { y, m, d } = parseIso(iso);
  const date = new Date(y, m - 1, d);
  const js = date.getDay();
  const idx = (js + 1) % 7;
  return WEEKDAYS[idx];
}

export function formatPreferredDate(iso: string, mode: CalendarMode): string {
  if (!iso) return "";
  return mode === "jalali" ? formatJalaliDisplay(iso) : isoToDisplay(iso);
}

export function headerDateParts(iso: string): { jalali: string; gregorian: string; weekday: string } {
  return {
    jalali: formatJalaliDisplay(iso),
    gregorian: isoToDisplay(iso),
    weekday: weekdayDari(iso),
  };
}

export function headerDateLine(iso: string): string {
  const p = headerDateParts(iso);
  return `${p.jalali}  ${p.gregorian}  ${p.weekday}`;
}

export function shiftJalaliMonths(iso: string, delta: number): string {
  const j = gregorianToJalali(iso);
  let m = j.m + delta;
  let y = j.y;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  const d = Math.min(j.d, jalaliMonthLength(y, m));
  return jalaliToGregorianIso(y, m, d);
}

export function jalaliMonthLength(jy: number, jm: number): number {
  return jMonthLen(jy, jm);
}

export function gregorianMonthLength(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export function monthStartWeekday(y: number, m: number, jalaliMode: boolean): number {
  if (jalaliMode) {
    const g = toGregorian(y, m, 1);
    const js = new Date(g.gy, g.gm - 1, g.gd).getDay();
    return (js + 1) % 7;
  }
  const js = new Date(y, m - 1, 1).getDay();
  return (js + 1) % 7;
}
