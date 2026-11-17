import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seedUser, type TestDb } from "@/lib/testing/pglite-db";
import { hashPin } from "@/lib/auth/pin-hash";
import { muteActivityLog, unmuteActivityLog } from "./helpers";
import { deleteActivityLogEntry } from "./reports";

const U = "user-log";

async function setup() {
  const db = await createTestDb();
  await db.tx((sql) => seedUser(sql, U));
  await db.sql`insert into app_settings (user_id, role_code_accountant) values (${U}, ${hashPin("2468")})
    on conflict (user_id) do update set role_code_accountant = excluded.role_code_accountant`;
  return db;
}
const logged = async (db: TestDb, title: string) =>
  (await db.sql<{ n: number }>`select count(*)::int as n from activity_log where user_id = ${U} and title = ${title}`)[0].n;

test("STR-05 bug: a mute left behind (crash before unmute) silenced the log for good", async () => {
  const db = await setup();
  // Old restore muted outside its transaction; a crash here never unmuted.
  await muteActivityLog(db.sql, U);
  await db.sql`insert into parties (user_id, kind, name) values (${U}, ${"customer"}, ${"علی"})`;
  assert.equal(await logged(db, "علی"), 1, "later changes must still be logged");
  await db.close();
});

test("STR-05: the mute only covers its own transaction", async () => {
  const db = await setup();
  await db.tx(async (tx) => {
    await muteActivityLog(tx, U);
    await tx`insert into parties (user_id, kind, name) values (${U}, ${"customer"}, ${"بی‌صدا"})`;
    await unmuteActivityLog(tx, U);
    await tx`insert into parties (user_id, kind, name) values (${U}, ${"customer"}, ${"باصدا"})`;
  });
  assert.equal(await logged(db, "بی‌صدا"), 0);
  assert.equal(await logged(db, "باصدا"), 1);
  await db.close();
});

test("STR-05: edits keep the before and after values", async () => {
  const db = await setup();
  const p = await db.sql<{ id: number }>`insert into parties (user_id, kind, name) values (${U}, ${"customer"}, ${"قدیم"}) returning id`;
  await db.sql`update parties set name = ${"جدید"} where id = ${p[0].id}`;
  const r = await db.sql<{ before_data: { name: string } | null; after_data: { name: string } | null }>`
    select before_data, after_data from activity_log where user_id = ${U} and action = ${"ویرایش"}
  `;
  assert.equal(r[0].before_data?.name, "قدیم");
  assert.equal(r[0].after_data?.name, "جدید");
  await db.close();
});

test("STR-05: deleting one log entry needs the accountant code", async () => {
  const db = await setup();
  await db.sql`insert into parties (user_id, kind, name) values (${U}, ${"customer"}, ${"حذفی"})`;
  const id = (await db.sql<{ id: number }>`select id from activity_log where user_id = ${U} and title = ${"حذفی"}`)[0].id;
  await assert.rejects(deleteActivityLogEntry(db.sql, U, id, "0000"), /حسابدار/);
  assert.equal(await logged(db, "حذفی"), 1);
  await deleteActivityLogEntry(db.sql, U, id, "2468");
  assert.equal(await logged(db, "حذفی"), 0);
  await db.close();
});
