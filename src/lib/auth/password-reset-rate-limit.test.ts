import assert from "node:assert/strict";
import test from "node:test";
import {
  _resetPasswordResetRateLimitForTests,
  assertPasswordResetAllowed,
  recordPasswordResetRequest,
} from "./password-reset-rate-limit.ts";

test("allows a few reset requests then locks for the hour", () => {
  _resetPasswordResetRateLimitForTests();
  const email = "Owner@Example.com";
  for (let i = 0; i < 3; i++) {
    assert.doesNotThrow(() => assertPasswordResetAllowed(email));
    recordPasswordResetRequest(email);
  }
  assert.throws(() => assertPasswordResetAllowed(email), /ساعت/);
});

test("email key is case-insensitive", () => {
  _resetPasswordResetRateLimitForTests();
  recordPasswordResetRequest("a@b.com");
  recordPasswordResetRequest("A@B.com");
  recordPasswordResetRequest("a@B.COM");
  assert.throws(() => assertPasswordResetAllowed("a@b.com"), /ساعت/);
});
