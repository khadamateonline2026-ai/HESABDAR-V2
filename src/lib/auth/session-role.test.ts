import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { needsRefresh, readRoleToken, ROLE_TOKEN_TTL_MS, signRoleToken, slotIfCurrent } from "./session-role.server.ts";

test("signs and reads role token for matching user", () => {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-session-role-unit";
  const token = signRoleToken("u1", "accountant", "علی", 1);
  const slot = readRoleToken(token, "u1");
  assert.ok(slot);
  const { exp: _exp, ...rest } = slot;
  assert.deepEqual(rest, { role: "accountant", displayName: "علی", pinVersion: 1 });
  assert.equal(readRoleToken(token, "other"), null);
});

test("rejects tampered token", () => {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-session-role-unit";
  const token = signRoleToken("u1", "seller", "ب", 1);
  const bad = token.slice(0, -2) + "aa";
  assert.equal(readRoleToken(bad, "u1"), null);
});

function legacyToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", process.env.BETTER_AUTH_SECRET as string).update(body).digest("base64url");
  return `${body}.${sig}`;
}

test("SEC-04 bug: legacy v1 tokens (no expiry, no PIN version) used to be accepted forever", () => {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-session-role-unit";
  // Pre-fix readRoleToken accepted v:1 with no exp; it must now be refused.
  const v1 = legacyToken({ u: "u1", r: "accountant", n: "x", v: 1 });
  const v2 = legacyToken({ u: "u1", r: "accountant", n: "x", v: 2, exp: Date.now() + 60_000 });
  assert.equal(readRoleToken(v1, "u1"), null);
  assert.equal(readRoleToken(v2, "u1"), null, "v2 had no PIN version -> expired");
});

test("SEC-04 fix: a PIN change (version bump) invalidates earlier role tokens", () => {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-session-role-unit";
  const claims = readRoleToken(signRoleToken("u1", "seller", "ب", 4), "u1");
  assert.ok(claims);
  assert.deepEqual(slotIfCurrent(claims, 4), { role: "seller", displayName: "ب" });
  assert.equal(slotIfCurrent(claims, 5), null);
  assert.equal(slotIfCurrent(null, 4), null);
});

test("SEC-04 invariant: every PIN change bumps role_pin_version and middleware checks it", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const core = read("src/lib/api/core.ts");
  // DEL-03: the old email-code reset (applyRoleReset) was removed; the reset link is the only path.
  assert.equal((core.match(/role_pin_version = role_pin_version \+ 1/g) ?? []).length, 1, "reset link");
  assert.match(read("src/lib/api/workspace.ts"), /role_pin_version = app_settings\.role_pin_version \+ 1/);
  assert.match(read("src/lib/auth/middleware.ts"), /const pinVersion = await currentRolePinVersion\(userId\);\s*slot = slotIfCurrent\(claims, pinVersion\)/);
});

test("role stays until sign-out: 180-day token, refreshed on use, still expires if never used", () => {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-session-role-unit";
  const DAY = 24 * 60 * 60 * 1000;
  assert.equal(ROLE_TOKEN_TTL_MS, 180 * DAY);
  const before = Date.now();
  const claims = readRoleToken(signRoleToken("u1", "seller", "ب", 3), "u1")!;
  assert.ok(claims.exp >= before + 180 * DAY - 1000, "lasts ~180 days, not 12 hours");
  // Reopening the app hours/days later still finds a valid role.
  assert.equal(needsRefresh(claims, before + 60 * 60 * 1000), false, "no re-issue within the first day");
  assert.equal(needsRefresh(claims, before + 2 * DAY), true, "re-issued (sliding) after a day of use");
  // An unused token past its expiry is refused (the role is asked again).
  const old = legacyToken({ u: "u1", r: "seller", n: "x", v: 3, pv: 3, exp: Date.now() - 1 });
  assert.equal(readRoleToken(old, "u1"), null);
});

test("middleware refreshes the role cookie and sign-out still clears it", () => {
  const mw = readFileSync(join(process.cwd(), "src/lib/auth/middleware.ts"), "utf8");
  assert.match(mw, /if \(slot && needsRefresh\(claims\)\)/);
  assert.match(mw, /setRoleCookie\(signRoleToken\(userId, slot\.role, slot\.displayName, pinVersion\)\)/);
  const onboarding = readFileSync(join(process.cwd(), "src/components/onboarding.tsx"), "utf8");
  assert.match(onboarding, /export async function logoutNow\(\) \{\s*await clearRoleSession\(\);/);
  const client = readFileSync(join(process.cwd(), "src/lib/session-role-client.ts"), "utf8");
  assert.match(client, /MAX_AGE_SEC = 180 \* 24 \* 60 \* 60/);
});
