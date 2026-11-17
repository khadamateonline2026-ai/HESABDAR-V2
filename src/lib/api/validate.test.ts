import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "@/lib/testing/pglite-db";
import { validInput, validPositive } from "./validate";

test("ACC-13 bug: NaN / Infinity / missing amounts were accepted and became 0", () => {
  assert.throws(() => validInput({ amount: Number.NaN, occurredOn: "2026-01-01" }), /مبلغ نامعتبر است/);
  assert.throws(() => validInput({ amount: Number.POSITIVE_INFINITY }), /مبلغ نامعتبر است/);
  assert.throws(() => validInput({ amount: null }), /مبلغ نامعتبر است/);
  assert.throws(() => validInput({ lines: [{ itemName: "x", quantity: "abc" }] }), /مقدار نامعتبر است/);
});

test("ACC-13: prices and rates cannot be negative; dates must be real dates", () => {
  assert.throws(() => validInput({ lines: [{ unitPrice: -5, quantity: 1 }] }), /قیمت نامعتبر است/);
  assert.throws(() => validInput({ fxRate: -1 }), /نرخ ارز نامعتبر است/);
  assert.throws(() => validInput({ occurredOn: "2026-02-30" }), /تاریخ نامعتبر است/);
  assert.throws(() => validInput({ id: 1.5 }), /شناسه نامعتبر است/);
});

test("ACC-13: valid input passes unchanged (negative opening cash, empty dates, optional ids)", () => {
  const d = { amount: -100, occurredOn: "2026-01-31", expectedOn: "", accountId: null, notes: "", lines: [{ quantity: 2, unitPrice: 0 }] };
  assert.equal(validInput(d), d);
});

test("ACC-13: capital / expense / transfer amounts must be above zero", () => {
  assert.throws(() => validPositive({ amount: -5 }, "amount"), /مبلغ باید بزرگ‌تر از صفر باشد/);
  assert.throws(() => validPositive({ amount: 0 }, "amount"), /مبلغ باید بزرگ‌تر از صفر باشد/);
  assert.deepEqual(validPositive({ amount: 5 }, "amount"), { amount: 5 });
});

test("ACC-13: money columns are numeric, not floating point", async () => {
  const db = await createTestDb();
  const cols = await db.sql<{ column_name: string; data_type: string }>`
    select column_name, data_type from information_schema.columns
    where table_schema = 'public' and data_type in ('double precision', 'real')
  `;
  assert.deepEqual(cols, []);
  await db.close();
});
