import assert from "node:assert/strict";
import test from "node:test";
import { convertAmount, formatMoney, nextInvoiceNo, toBase, toLatinDigits } from "./format.ts";

test("convertAmount and toBase", () => {
  assert.equal(toBase(10, 70), 700);
  assert.equal(convertAmount(100, 70, 1), 7000);
  assert.equal(convertAmount(7000, 1, 70), 100);
});

test("formatMoney and digits", () => {
  assert.equal(toLatinDigits("۱۲۳"), "123");
  assert.equal(formatMoney(1000), "1,000");
  assert.equal(formatMoney(10.5), "10.5");
});

test("nextInvoiceNo", () => {
  assert.equal(nextInvoiceNo(["S-1", "S-3"], "S"), "S-4");
  assert.equal(nextInvoiceNo([], "P"), "P-1");
});
