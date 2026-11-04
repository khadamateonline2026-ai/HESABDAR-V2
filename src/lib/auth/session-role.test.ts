import assert from "node:assert/strict";
import test from "node:test";
import { readRoleToken, signRoleToken } from "./session-role.server.ts";

test("signs and reads role token for matching user", () => {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-session-role-unit";
  const token = signRoleToken("u1", "accountant", "علی");
  const slot = readRoleToken(token, "u1");
  assert.deepEqual(slot, { role: "accountant", displayName: "علی" });
  assert.equal(readRoleToken(token, "other"), null);
});

test("rejects tampered token", () => {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-session-role-unit";
  const token = signRoleToken("u1", "seller", "ب");
  const bad = token.slice(0, -2) + "aa";
  assert.equal(readRoleToken(bad, "u1"), null);
});
