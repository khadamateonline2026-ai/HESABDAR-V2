import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readRoleToken, signRoleToken, slotIfCurrent } from "./session-role.server.ts";

test("signs and reads role token for matching user", () => {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-session-role-unit";
  const token = signRoleToken("u1", "accountant", "علی", 1);
  const slot = readRoleToken(token, "u1");
  assert.deepEqual(slot, { role: "accountant", displayName: "علی", pinVersion: 1 });
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
  assert.match(read("src/lib/auth/middleware.ts"), /slotIfCurrent\(claims, await currentRolePinVersion\(userId\)\)/);
});
