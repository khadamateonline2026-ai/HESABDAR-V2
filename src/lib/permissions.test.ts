import assert from "node:assert/strict";
import test from "node:test";
import { canView, canWrite } from "./permissions.ts";

test("supervisor read-only", () => {
  assert.equal(canView("supervisor", "settings"), true);
  assert.equal(canWrite("supervisor", "sales"), false);
});

test("accountant full write", () => {
  assert.equal(canWrite("accountant", "settings"), true);
  assert.equal(canView("accountant", "company"), true);
});

test("seller limited", () => {
  assert.equal(canWrite("seller", "sales"), true);
  assert.equal(canWrite("seller", "settings"), false);
  assert.equal(canView("seller", "settings"), false);
  assert.equal(canView("seller", "sales"), true);
});
