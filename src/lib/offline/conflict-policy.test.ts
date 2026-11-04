import assert from "node:assert/strict";
import test from "node:test";
import { decideConflict } from "./conflict-policy.ts";

test("posted docs keep server", () => {
  assert.equal(decideConflict({ localPosted: true, serverPosted: false, serverNewer: false }), "keep_server");
  assert.equal(decideConflict({ localPosted: false, serverPosted: true, serverNewer: false }), "keep_server");
});

test("drafts prefer local unless server newer", () => {
  assert.equal(decideConflict({ localPosted: false, serverPosted: false, serverNewer: false }), "keep_local");
  assert.equal(decideConflict({ localPosted: false, serverPosted: false, serverNewer: true }), "keep_server");
});
