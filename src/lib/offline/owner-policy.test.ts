import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mustWipe, partitionQueue, previousOwner } from "./owner-policy.ts";

const rows = [
  { id: 1, owner: "alice" },
  { id: 2, owner: "bob" },
  { id: 3 }, // queued before owners were tracked
];

test("SEC-05 bug: the old queue replayed every row under whoever was signed in", () => {
  // Pre-fix flush(): `for (const row of rows)` with no owner check at all.
  const engineBefore = (q: typeof rows) => q.map((r) => r.id);
  assert.deepEqual(engineBefore(rows), [1, 2, 3], "bob's session would send alice's writes");
});

test("SEC-05 fix: only the signed-in user's rows are replayed; others are dropped", () => {
  const { replay, drop } = partitionQueue(rows, "bob", "alice");
  assert.deepEqual(replay.map((r) => r.id), [2]);
  assert.deepEqual(drop.map((r) => r.id).sort(), [1, 3], "legacy row belonged to alice (last session)");
  const same = partitionQueue(rows, "alice", "alice");
  assert.deepEqual(same.replay.map((r) => r.id), [1, 3]);
});

test("SEC-05 fix: nothing is replayed or dropped while the user is unknown", () => {
  const { replay, drop } = partitionQueue(rows, null, "alice");
  assert.equal(replay.length + drop.length, 0);
});

test("SEC-05 fix: a different user wipes; the same user or first sign-in does not", () => {
  assert.equal(mustWipe("alice", "bob"), true);
  assert.equal(mustWipe("alice", "alice"), false);
  assert.equal(mustWipe(null, "alice"), false);
  assert.equal(mustWipe("alice", null), false);
  assert.equal(previousOwner(null, JSON.stringify({ user: { id: "alice" } })), "alice");
  assert.equal(previousOwner("bob", JSON.stringify({ user: { id: "alice" } })), "bob");
  assert.equal(previousOwner(null, "not json"), null);
});

test("SEC-05 invariant: engine, sign-out and server are wired", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const engine = read("src/lib/offline/engine.ts");
  assert.match(engine, /partitionQueue\(/);
  assert.match(engine, /owner: queuedFor/);
  assert.match(engine, /export async function clearOfflineData/);
  assert.match(engine, /if \(!owner\) return;/);
  const client = read("src/lib/auth/client.ts");
  assert.match(client, /clearOfflineData\(\)/);
  assert.match(client, /flushOfflineQueue\(\)/);
  assert.match(read("src/routes/__root.tsx"), /setOfflineOwner\(userId\)/);
  assert.match(read("src/lib/auth/middleware.ts"), /assertOfflineOwner\(userId\)/);
  assert.match(read("public/sw.js"), /\/_serverFn/);
});
