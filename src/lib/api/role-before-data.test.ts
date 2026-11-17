import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, seedUser } from "@/lib/testing/pglite-db";
import { bootstrapFor } from "./core";
import { ROLE_REQUIRED, sqlOf } from "./helpers";

type Slot = { role: "supervisor" | "accountant" | "seller"; displayName: string } | null;
let slot: Slot = null;
(globalThis as { __hesabdarRoleAls?: { getStore: () => Slot } }).__hesabdarRoleAls = { getStore: () => slot };

const U = "user-gate";

test("SEC-02 bug: before a role PIN the bootstrap carried balances, parties and staff", async () => {
  const db = await createTestDb();
  await db.tx((sql) => seedUser(sql, U));
  await db.sql`insert into parties (user_id, kind, name) values (${U}, ${"customer"}, ${"مشتری محرمانه"})`;
  await db.sql`insert into staff_users (user_id, display_name, role, is_owner) values (${U}, ${"کارمند"}, ${"seller"}, ${false})`;

  slot = null;
  const locked = await bootstrapFor(db.sql, U);
  assert.equal(locked.needsSessionRole, true);
  assert.equal(locked.catalogs.accounts.length, 0);
  assert.equal(locked.catalogs.parties.length, 0);
  assert.equal(locked.catalogs.currencies.length, 0);
  assert.deepEqual(locked.staff, []);
  assert.ok(locked.settings, "appearance settings are still sent");

  slot = { role: "accountant", displayName: "t" };
  const open = await bootstrapFor(db.sql, U);
  assert.equal(open.needsSessionRole, false);
  assert.ok(open.catalogs.accounts.length > 0);
  assert.ok(open.catalogs.parties.some((p) => p.name === "مشتری محرمانه"));
  assert.ok(open.staff.length > 0);
  slot = null;
  await db.close();
});

test("SEC-02: workspace data access refuses to start before a role is unlocked", async () => {
  slot = null;
  await assert.rejects(sqlOf(), (e: Error) => e.message === ROLE_REQUIRED);
  slot = { role: "seller", displayName: "t" };
  await assert.doesNotReject(sqlOf().catch((e: Error) => (/پایگاه|database|connect/i.test(e.message) ? null : Promise.reject(e))));
  slot = null;
});

test("SEC-02 invariant: only the role gate reads before a role; nothing bypasses sqlOf", () => {
  const dir = join(process.cwd(), "src/lib/api");
  const allowed = ["getBootstrap", "completeOnboarding", "changeRole", "requestRoleReset", "applyRoleResetLink", "applyRoleReset"];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
    const src = readFileSync(join(dir, f), "utf8");
    if (f !== "helpers.ts" && f !== "idempotency.ts") assert.doesNotMatch(src, /\bgetSql\(/, `${f} must use sqlOf()`);
    const parts = src.split(/\nexport const (\w+) = createServerFn/);
    for (let i = 1; i < parts.length; i += 2) {
      if (parts[i + 1].includes("sqlBeforeRole(")) assert.ok(allowed.includes(parts[i]), `${parts[i]} may not read before a role`);
    }
  }
});
