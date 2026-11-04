import assert from "node:assert/strict";
import test from "node:test";
import { toGregorian } from "jalaali-js";
import {
  addDaysIso,
  defaultWeekCode,
  listWeekSlots,
  weekStartSaturday,
  weekVisibleRange,
} from "./delivery-weeks.ts";

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

test("week starts Saturday and ends Friday", () => {
  assert.equal(weekStartSaturday("2026-10-10"), "2026-10-10");
  assert.equal(weekStartSaturday("2026-10-07"), "2026-10-03");
  assert.equal(weekStartSaturday("2026-10-09"), "2026-10-03");
});

test("jalali weeks are WK-1 through WK-27 from 1/2", () => {
  const sawr = toGregorian(1405, 2, 1);
  const sawrIso = iso(sawr.gy, sawr.gm, sawr.gd);
  const slots = listWeekSlots("2026-10-10", "jalali");
  assert.equal(sawrIso, "2026-04-21");
  assert.equal(slots.length, 27);
  assert.equal(slots[0].code, "WK-1");
  assert.equal(slots[0].start, weekStartSaturday(sawrIso));
  assert.equal(slots[0].start, "2026-04-18");
  assert.equal(slots[26].code, "WK-27");
  assert.equal(slots[26].start, addDaysIso("2026-04-18", 26 * 7));
  assert.ok(slots[0].start <= sawrIso && sawrIso <= slots[0].end);
  assert.equal(slots.find((s) => s.code === "WK-28"), undefined);
  const before = addDaysIso(slots[0].start, -7);
  assert.equal(slots.some((s) => s.start === before), false);
  for (let i = 1; i < slots.length; i++) {
    assert.equal(slots[i].code, `WK-${i + 1}`);
    assert.equal(slots[i].start, addDaysIso(slots[i - 1].start, 7));
    assert.equal(slots[i].end, addDaysIso(slots[i].start, 6));
  }
});

test("gregorian weeks start at the Saturday of 1 February and stop at 27", () => {
  const slots = listWeekSlots("2026-10-10", "gregorian");
  assert.equal(slots.length, 27);
  assert.equal(slots[0].code, "WK-1");
  assert.equal(slots[0].start, weekStartSaturday("2026-02-01"));
  assert.equal(slots[0].start, "2026-01-31");
  assert.equal(slots[26].code, "WK-27");
  assert.equal(
    slots.find((s) => s.start <= "2026-10-10" && "2026-10-10" <= s.end),
    undefined,
  );
});

test("saturday of the current window shows through Friday", () => {
  const slots = listWeekSlots("2026-10-10", "jalali");
  const current = slots.find((s) => s.start === "2026-10-10");
  assert.ok(current);
  const range = weekVisibleRange(current, "2026-10-10");
  assert.equal(range.from, "2026-10-10");
  assert.equal(range.to, "2026-10-16");
  assert.equal(defaultWeekCode(slots, "2026-10-10"), current.code);
});

test("midweek stops at today", () => {
  const slots = listWeekSlots("2026-04-22", "jalali");
  const current = slots.find((s) => s.start === "2026-04-18")!;
  assert.equal(current.code, "WK-1");
  const range = weekVisibleRange(current, "2026-04-22");
  assert.equal(range.from, "2026-04-18");
  assert.equal(range.to, "2026-04-22");
});

test("a past week is Saturday through Friday", () => {
  const slots = listWeekSlots("2026-10-14", "jalali");
  const past = slots.find((s) => s.start === "2026-10-03")!;
  const range = weekVisibleRange(past, "2026-10-14");
  assert.equal(range.from, "2026-10-03");
  assert.equal(range.to, "2026-10-09");
});

test("before month 2 the default is WK-1 and after week 27 it is WK-27", () => {
  const early = listWeekSlots("2026-04-01", "jalali");
  assert.equal(defaultWeekCode(early, "2026-04-01"), "WK-1");
  const late = listWeekSlots("2026-12-01", "jalali");
  assert.equal(defaultWeekCode(late, "2026-12-01"), "WK-27");
});
