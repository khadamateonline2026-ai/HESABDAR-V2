import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, seedUser, type TestDb } from "@/lib/testing/pglite-db";
import { hashPin, isHashedPin, verifyPin } from "@/lib/auth/pin-hash";
import { ROLE_PIN_MAX_FAILS, attemptRoleSecret, lockMinutesForLevel, verifyAccountantPin, verifyRolePin } from "./role-pin";

async function setup(codes: { supervisor: string; accountant: string; seller: string }): Promise<TestDb> {
  const db = await createTestDb();
  await seedUser(db.sql, "u1");
  await db.sql`
    insert into app_settings (user_id, role_code_supervisor, role_code_accountant, role_code_seller)
    values (${"u1"}, ${codes.supervisor}, ${codes.accountant}, ${codes.seller})
  `;
  return db;
}
const hashed = () => ({ supervisor: hashPin("1111"), accountant: hashPin("2468"), seller: hashPin("3333") });
const state = async (db: TestDb) =>
  (await db.sql<{ role_fail_count: number; role_lock_until: string | null; role_lock_level: number }>`
    select role_fail_count, role_lock_until, role_lock_level from app_settings where user_id = 'u1'
  `)[0];

test("SEC-03 bug: the accountant-code gate had no limiter at all (unlimited guesses)", () => {
  // Pre-fix helpers.assertAccountantPin: a pure verifyPin per call, no counter.
  const stored = hashPin("2468");
  const oldGate = (code: string) => {
    if (!verifyPin(code, stored)) throw new Error("کد نقش حسابدار نادرست است");
  };
  for (let i = 0; i < 20; i++) assert.throws(() => oldGate(String(1000 + i)));
  assert.doesNotThrow(() => oldGate("2468"), "21st guess still allowed — no lockout existed");
  // …and the role-switch limiter was an in-memory Map (lost on every cold start).
  const helpers = readFileSync(join(process.cwd(), "src/lib/api/helpers.ts"), "utf8");
  assert.doesNotMatch(helpers, /role-rate-limit/);
});

test("SEC-03 fix: 5 wrong accountant codes lock the workspace (stored in the DB)", async () => {
  const db = await setup(hashed());
  for (let i = 1; i < ROLE_PIN_MAX_FAILS; i++) {
    await assert.rejects(verifyAccountantPin(db.sql, "u1", "0000"), /حسابدار نادرست/);
  }
  await assert.rejects(verifyAccountantPin(db.sql, "u1", "0000"), /قفل/);
  const s = await state(db);
  assert.ok(s.role_lock_until && new Date(s.role_lock_until).getTime() > Date.now());
  assert.equal(Number(s.role_lock_level), 1);
  // Even the right code is refused while locked; any role check is covered.
  await assert.rejects(verifyAccountantPin(db.sql, "u1", "2468"), /قفل/);
  await assert.rejects(verifyRolePin(db.sql, "u1", "seller", "3333"), /قفل/);
  await db.close();
});

test("SEC-03 fix: lockout is progressive and a correct PIN resets it", async () => {
  const db = await setup(hashed());
  assert.equal(lockMinutesForLevel(0), 15);
  assert.equal(lockMinutesForLevel(1), 30);
  assert.equal(lockMinutesForLevel(10), 24 * 60);
  for (let i = 0; i < ROLE_PIN_MAX_FAILS; i++) await assert.rejects(verifyRolePin(db.sql, "u1", "seller", "9"));
  // expire the first lock, fail 5 more times → longer lock
  await db.sql`update app_settings set role_lock_until = now() - interval '1 second' where user_id = 'u1'`;
  for (let i = 0; i < ROLE_PIN_MAX_FAILS; i++) await assert.rejects(verifyRolePin(db.sql, "u1", "seller", "9"));
  const s = await state(db);
  const mins = (new Date(s.role_lock_until as string).getTime() - Date.now()) / 60000;
  assert.ok(mins > 25 && mins <= 30, `second lock ≈ 30 min, got ${mins}`);
  await db.sql`update app_settings set role_lock_until = now() - interval '1 second' where user_id = 'u1'`;
  await verifyRolePin(db.sql, "u1", "seller", "3333");
  const after = await state(db);
  assert.equal(Number(after.role_fail_count), 0);
  assert.equal(Number(after.role_lock_level), 0);
  await db.close();
});

test("SEC-03 fix: parallel guesses cannot exceed the limit", async () => {
  const db = await setup(hashed());
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, () => verifyAccountantPin(db.sql, "u1", "0000")),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 0);
  const wrong = results.filter((r) => r.status === "rejected" && /نادرست/.test(String(r.reason))).length;
  assert.ok(wrong <= ROLE_PIN_MAX_FAILS - 1, `only ${ROLE_PIN_MAX_FAILS - 1} plain "wrong" answers, got ${wrong}`);
  await db.close();
});

test("SEC-03 fix: a legacy plaintext PIN works once and is re-hashed; public defaults never work", async () => {
  const db = await setup({ supervisor: "12345", accountant: "7788", seller: hashPin("3333") });
  await verifyAccountantPin(db.sql, "u1", "7788");
  const row = (await db.sql<{ role_code_accountant: string }>`select role_code_accountant from app_settings`)[0];
  assert.ok(isHashedPin(row.role_code_accountant), "stored as scrypt hash now");
  await verifyAccountantPin(db.sql, "u1", "7788");
  await assert.rejects(verifyRolePin(db.sql, "u1", "supervisor", "12345"), /نادرست/);
  await db.close();
});

test("SEC-03 fix: the emailed reset code uses the same limiter", async () => {
  const db = await setup(hashed());
  for (let i = 0; i < ROLE_PIN_MAX_FAILS - 1; i++) {
    await assert.rejects(attemptRoleSecret(db.sql, "u1", () => false, "کد ایمیل نادرست یا منقضی است"), /کد ایمیل/);
  }
  await assert.rejects(attemptRoleSecret(db.sql, "u1", () => false, "کد ایمیل نادرست یا منقضی است"), /قفل/);
  await db.close();
});

test("SEC-03 invariant: every PIN path uses the DB limiter", () => {
  const dir = join(process.cwd(), "src/lib/api");
  for (const f of ["core.ts", "workspace.ts", "helpers.ts", "setup.ts", "ops.ts", "inventory.ts", "reports.ts", "workers.ts"]) {
    const src = readFileSync(join(dir, f), "utf8");
    assert.doesNotMatch(src, /role-rate-limit|recordRoleFail|getRoleCodes\(sql, context\.userId\);\s*\n\s*assert/, f);
    assert.doesNotMatch(src.replace(/import[^;]+;/g, ""), /\bverifyPin\(/, `${f} must not call verifyPin directly`);
  }
});
