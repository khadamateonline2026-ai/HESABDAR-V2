import assert from "node:assert/strict";
import test from "node:test";
import { assertPinShape, hashPin, isHashedPin, verifyPin } from "./pin-hash.ts";

test("hashPin produces scrypt format and verifies", () => {
  const h = hashPin("1234");
  assert.equal(isHashedPin(h), true);
  assert.equal(verifyPin("1234", h), true);
  assert.equal(verifyPin("1235", h), false);
  assert.notEqual(h, hashPin("1234")); // unique salt
});

test("legacy plaintext still verifies", () => {
  assert.equal(verifyPin("abcd", "abcd"), true);
  assert.equal(verifyPin("abcd", "abce"), false);
});

test("assertPinShape keeps min 4", () => {
  assert.doesNotThrow(() => assertPinShape("1234"));
  assert.throws(() => assertPinShape("123"), /۴/);
});
