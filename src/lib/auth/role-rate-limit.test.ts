import assert from "node:assert/strict";
import test from "node:test";
import {
  _resetRoleRateLimitForTests,
  assertRoleNotLocked,
  recordRoleFail,
  recordRoleSuccess,
} from "./role-rate-limit.ts";

test("locks after repeated failures", () => {
  _resetRoleRateLimitForTests();
  const uid = "user-a";
  for (let i = 0; i < 4; i++) {
    assert.doesNotThrow(() => recordRoleFail(uid));
  }
  assert.throws(() => recordRoleFail(uid), /قفل/);
  assert.throws(() => assertRoleNotLocked(uid), /دقیقه/);
  recordRoleSuccess(uid);
  assert.doesNotThrow(() => assertRoleNotLocked(uid));
});
