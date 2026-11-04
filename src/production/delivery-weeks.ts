import { toGregorian, toJalaali } from "jalaali-js";
import type { CalendarMode } from "@/lib/types";

export type WeekSlot = { code: string; start: string; end: string };

export const WEEK_SLOT_COUNT = 27;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function weekStartSaturday(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  const back = (date.getDay() + 1) % 7;
  date.setDate(date.getDate() - back);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 1st of month 2: 1 ثور in Jalali, 1 February in Gregorian. */
export function monthTwoStartIso(today: string, mode: CalendarMode): string {
  const [y, m, d] = today.slice(0, 10).split("-").map(Number);
  if (mode === "gregorian") return `${y}-02-01`;
  const j = toJalaali(y, m, d);
  const g = toGregorian(j.jy, 2, 1);
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

export function listWeekSlots(today: string, mode: CalendarMode, weekOneStart?: string | null): WeekSlot[] {
  const custom = weekOneStart?.slice(0, 10) ?? "";
  let cursor = weekStartSaturday(custom || monthTwoStartIso(today.slice(0, 10), mode));
  const slots: WeekSlot[] = [];
  for (let n = 1; n <= WEEK_SLOT_COUNT; n++) {
    slots.push({ code: `WK-${n}`, start: cursor, end: addDaysIso(cursor, 6) });
    cursor = addDaysIso(cursor, 7);
  }
  return slots;
}

export function defaultWeekCode(slots: WeekSlot[], today: string): string {
  const start = weekStartSaturday(today.slice(0, 10));
  const hit = slots.find((s) => s.start === start);
  if (hit) return hit.code;
  if (!slots.length) return "";
  return start < slots[0].start ? slots[0].code : slots[slots.length - 1].code;
}

export function weekCodeForDate(iso: string, mode: CalendarMode, weekOneStart?: string | null): string {
  const day = weekStartSaturday(iso.slice(0, 10));
  const custom = weekOneStart?.slice(0, 10) ?? "";
  const origin = weekStartSaturday(custom || monthTwoStartIso(iso.slice(0, 10), mode));
  const days = utcDaySpan(origin, day);
  const n = Math.floor(days / 7) + 1;
  return `WK-${n < 1 ? 1 : n}`;
}

function utcDaySpan(from: string, to: string): number {
  const [ay, am, ad] = from.split("-").map(Number);
  const [by, bm, bd] = to.split("-").map(Number);
  return Math.round((Date.UTC(by, (bm || 1) - 1, bd || 1) - Date.UTC(ay, (am || 1) - 1, ad || 1)) / 86400000);
}

export function weekVisibleRange(slot: WeekSlot, today: string): { from: string; to: string } {
  const todayIso = today.slice(0, 10);
  if (todayIso < slot.start || todayIso > slot.end) return { from: slot.start, to: slot.end };
  if (todayIso === slot.start) return { from: slot.start, to: slot.end };
  return { from: slot.start, to: todayIso };
}
