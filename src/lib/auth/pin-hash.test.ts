import assert from "node:assert/strict";
import test from "node:test";
import { assertPinShape, hashPin, isHashedPin, legacyPlainMatches, verifyPin } from "./pin-hash.ts";

test("hashPin produces scrypt format and verifies", () => {
  const h = hashPin("1234");
  assert.equal(isHashedPin(h), true);
  assert.equal(verifyPin("1234", h), true);
  assert.equal(verifyPin("1235", h), false);
  assert.notEqual(h, hashPin("1234")); // unique salt
});

test("SEC-03: plaintext stored PINs are no longer accepted by verifyPin", () => {
  assert.equal(verifyPin("abcd", "abcd"), false);
  // only the one-time upgrade path may compare plaintext
  assert.equal(legacyPlainMatches("abcd", "abcd"), true);
  assert.equal(legacyPlainMatches("abcd", "abce"), false);
  assert.equal(legacyPlainMatches("1234", hashPin("1234")), false);
});

test("assertPinShape keeps min 4", () => {
  assert.doesNotThrow(() => assertPinShape("1234"));
  assert.throws(() => assertPinShape("123"), /۴/);
});
