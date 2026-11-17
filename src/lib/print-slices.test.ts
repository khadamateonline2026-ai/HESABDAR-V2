import { test } from "node:test";
import assert from "node:assert/strict";
import { sliceBreaks } from "./print-slices";

test("short image = one page", () => {
  assert.deepEqual(sliceBreaks(500, 1000, () => true), [0]);
});

test("cuts at the nearest clean row above the page end", () => {
  const clean = new Set([950, 1890]);
  assert.deepEqual(sliceBreaks(2500, 1000, (y) => clean.has(y)), [0, 950, 1890]);
});

test("no clean row → hard cut at page height, never stalls", () => {
  const out = sliceBreaks(3500, 1000, () => false);
  assert.deepEqual(out, [0, 1000, 2000, 3000]);
});
