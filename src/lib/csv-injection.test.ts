import assert from "node:assert/strict";
import test from "node:test";
import { toCsv } from "./backup-snapshot.ts";

test("SEC-06: text that starts like a formula is exported as text", () => {
  const csv = toCsv([
    { a: "=1+1", b: "+92", c: "-cmd", d: "@SUM(A1)", e: "\tx", f: "عادی" },
  ]);
  const line = csv.split("\n")[1];
  assert.equal(line, "'=1+1,'+92,'-cmd,'@SUM(A1),'\tx,عادی");
});

test("SEC-06: real numbers (including negatives) stay numeric", () => {
  const csv = toCsv([{ amount: -150, rate: 70.5, note: "a,b", numeric: "-12.50" }]);
  assert.equal(csv.split("\n")[1], '-150,70.5,"a,b",-12.50');
});
