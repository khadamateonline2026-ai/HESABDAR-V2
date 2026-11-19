import { test } from "node:test";
import assert from "node:assert/strict";
import { gregorianToJalali } from "@/lib/jalali";
import { monthLengthOf, periodRange, shiftIso } from "./cashbook-periods";

const j = (iso: string) => {
  const x = gregorianToJalali(iso);
  return `${x.y}/${x.m}/${x.d}`;
};

test("today / yesterday, across month and year ends", () => {
  assert.deepEqual(periodRange("today", "2026-11-19", "jalali"), {
    from: "2026-11-19",
    to: "2026-11-19",
  });
  assert.deepEqual(periodRange("yesterday", "2026-03-01", "gregorian"), {
    from: "2026-02-28",
    to: "2026-02-28",
  });
  assert.deepEqual(periodRange("yesterday", "2024-03-01", "gregorian"), {
    from: "2024-02-29",
    to: "2024-02-29",
  });
  assert.deepEqual(periodRange("yesterday", "2026-01-01", "jalali"), {
    from: "2025-12-31",
    to: "2025-12-31",
  });
  assert.equal(shiftIso("2026-12-31", 1), "2027-01-01");
});

test("week: Saturday start for Jalali, Monday start for Gregorian", () => {
  // 2026-11-19 is a Thursday.
  assert.deepEqual(periodRange("this_week", "2026-11-19", "jalali"), {
    from: "2026-11-14",
    to: "2026-11-19",
  }); // Sat 14
  assert.deepEqual(periodRange("this_week", "2026-11-19", "gregorian"), {
    from: "2026-11-16",
    to: "2026-11-19",
  }); // Mon 16
  assert.deepEqual(periodRange("last_week", "2026-11-19", "jalali"), {
    from: "2026-11-07",
    to: "2026-11-13",
  });
  assert.deepEqual(periodRange("last_week", "2026-11-19", "gregorian"), {
    from: "2026-11-09",
    to: "2026-11-15",
  });
  // On the first day of the week itself.
  assert.deepEqual(periodRange("this_week", "2026-11-14", "jalali"), {
    from: "2026-11-14",
    to: "2026-11-14",
  });
  assert.deepEqual(periodRange("this_week", "2026-11-16", "gregorian"), {
    from: "2026-11-16",
    to: "2026-11-16",
  });
  // Week spanning a year end.
  assert.deepEqual(periodRange("last_week", "2027-01-04", "gregorian"), {
    from: "2026-12-28",
    to: "2027-01-03",
  });
});

test("Jalali months: start on the 1st of the Shamsi month, 31/30/29-30 day lengths", () => {
  // 2026-11-19 = 1405/8/28 (Aban) → this month starts 1405/8/1 = 2026-10-23.
  assert.equal(j("2026-11-19"), "1405/8/28");
  const tm = periodRange("this_month", "2026-11-19", "jalali");
  assert.deepEqual(tm, { from: "2026-10-23", to: "2026-11-19" });
  assert.equal(j(tm.from), "1405/8/1");
  // Last month = Mehr 1405 (30 days).
  const lm = periodRange("last_month", "2026-11-19", "jalali");
  assert.equal(j(lm.from), "1405/7/1");
  assert.equal(j(lm.to), "1405/7/30");
  assert.equal(monthLengthOf(lm.to, "jalali"), 30);
  // First half of the year has 31-day months: last month of Mehr 1 is Shahrivar (31).
  const sh = periodRange("last_month", "2026-09-25", "jalali"); // 1405/7/3
  assert.equal(j(sh.from), "1405/6/1");
  assert.equal(j(sh.to), "1405/6/31");
  // Year boundary: in Farvardin, last month is Esfand of the previous year (29 or 30 days).
  const es = periodRange("last_month", "2026-03-25", "jalali"); // 1405/1/5
  assert.equal(j(es.from), "1404/12/1");
  assert.equal(j(es.to), `1404/12/${monthLengthOf(es.to, "jalali")}`);
  assert.equal(shiftIso(es.to, 1), periodRange("this_month", "2026-03-25", "jalali").from);
  // Leap Esfand: 1403 is a leap year (Esfand has 30 days).
  const leap = periodRange("last_month", "2025-03-25", "jalali"); // 1404/1/5
  assert.equal(j(leap.to), "1403/12/30");
});

test("Gregorian months: start on the 1st, February and year boundaries", () => {
  assert.deepEqual(periodRange("this_month", "2026-11-19", "gregorian"), {
    from: "2026-11-01",
    to: "2026-11-19",
  });
  assert.deepEqual(periodRange("last_month", "2026-11-19", "gregorian"), {
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.deepEqual(periodRange("last_month", "2024-03-10", "gregorian"), {
    from: "2024-02-01",
    to: "2024-02-29",
  });
  assert.deepEqual(periodRange("last_month", "2026-01-05", "gregorian"), {
    from: "2025-12-01",
    to: "2025-12-31",
  });
});
