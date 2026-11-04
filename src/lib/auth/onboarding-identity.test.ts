import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_COMPANY_NAME,
  resolveOnboardingIdentity,
} from "./onboarding-identity.ts";

test("person displayName becomes profile name; company defaults", () => {
  const r = resolveOnboardingIdentity({ displayName: "  علی رضایی  " });
  assert.equal(r.displayName, "علی رضایی");
  assert.equal(r.companyName, DEFAULT_COMPANY_NAME);
  assert.equal(r.companyName, "شرکت من");
});

test("legacy companyName still accepted as displayName alias", () => {
  const r = resolveOnboardingIdentity({ companyName: "شرکت قدیمی" });
  assert.equal(r.displayName, "شرکت قدیمی");
  assert.equal(r.companyName, DEFAULT_COMPANY_NAME);
});

test("displayName wins over companyName", () => {
  const r = resolveOnboardingIdentity({ displayName: "سارا", companyName: "ignored" });
  assert.equal(r.displayName, "سارا");
});

test("empty name rejected", () => {
  assert.throws(() => resolveOnboardingIdentity({}), /نام لازم/);
  assert.throws(() => resolveOnboardingIdentity({ displayName: "  " }), /نام لازم/);
});
