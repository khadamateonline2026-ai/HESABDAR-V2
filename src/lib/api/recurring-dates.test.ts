import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { duePeriods } from "./ops";

test("ACC-07 bug: monthly dates from the 31st must not drift to the 28th", () => {
  const due = duePeriods("2026-01-31", "2026-05-31", "monthly", "start").map((d) => d.dueOn);
  // Before: 01-31, 02-28, 03-28, 04-28, 05-28
  assert.deepEqual(due, ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
});

test("ACC-07: period keys stay one per month", () => {
  const keys = duePeriods("2026-01-31", "2026-05-31", "monthly", "start").map((d) => d.period);
  assert.deepEqual(keys, ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]);
});

test("ACC-07: an 'end' period is due the day after it ends (next period's start)", () => {
  const due = duePeriods("2026-01-01", "2026-03-01", "monthly", "end");
  // Before: January was due on 2026-02-02.
  assert.deepEqual(due, [
    { period: "2026-01", dueOn: "2026-02-01" },
    { period: "2026-02", dueOn: "2026-03-01" },
  ]);
});

test("ACC-07: quarterly, yearly and weekly follow the original anchor", () => {
  assert.deepEqual(
    duePeriods("2025-11-30", "2026-08-31", "quarterly").map((d) => d.dueOn),
    ["2025-11-30", "2026-02-28", "2026-05-30", "2026-08-30"],
  );
  assert.deepEqual(duePeriods("2024-02-29", "2026-03-01", "yearly").map((d) => d.dueOn), ["2024-02-29", "2025-02-28", "2026-02-28"]);
  assert.deepEqual(duePeriods("2026-01-01", "2026-01-15", "weekly").map((d) => d.dueOn), ["2026-01-01", "2026-01-08", "2026-01-15"]);
});
