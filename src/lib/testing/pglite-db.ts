/**
 * Test-only in-memory Postgres (PGLite) with `migrations/*.sql` applied in
 * order — the same files production runs — so accounting fixes can be tested
 * against real SQL, FKs and transactions instead of mocks.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "@/lib/db";

const OID_INT8 = 20;
const OID_DATE = 1082;
const identity = (v: string) => v;

function toSql(run: <T>(text: string, params: unknown[]) => Promise<T[]>): Sql {
  const sql = (async <T,>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T,>(text: string, params: unknown[] = []) => run<T>(text, params);
  return sql;
}

export type TestDb = {
  pg: PGlite;
  sql: Sql;
  /** Run `fn` in one transaction; a throw rolls everything back. */
  tx: <T>(fn: (sql: Sql) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Fresh DB. `upTo` (inclusive file name) stops early so a test can show the
 * behaviour BEFORE a migration and then apply the rest with `applyMigrations`.
 */
export async function createTestDb(opts: { upTo?: string } = {}): Promise<TestDb> {
  const pg = new PGlite({ parsers: { [OID_INT8]: Number, [OID_DATE]: identity } });
  await pg.waitReady;
  await pg.exec("create table if not exists _migrations (name text primary key)");
  await applyMigrations(pg, opts.upTo);
  const sql = toSql(async <T,>(text: string, params: unknown[]) => (await pg.query<T>(text, params)).rows);
  const tx = <T,>(fn: (sql: Sql) => Promise<T>) =>
    pg.transaction(async (t) => fn(toSql(async <R,>(text: string, params: unknown[]) => (await t.query<R>(text, params)).rows)));
  return { pg, sql, tx, close: () => pg.close() };
}

export async function applyMigrations(pg: PGlite, upTo?: string): Promise<void> {
  const done = new Set((await pg.query<{ name: string }>("select name from _migrations")).rows.map((r) => r.name));
  for (const file of migrationFiles()) {
    if (upTo && file > upTo) break;
    if (done.has(file)) continue;
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    await pg.query("insert into _migrations (name) values ($1)", [file]);
  }
}

/** Only needed for DBs built with `upTo` before 0033 (STR-01 moved these into migrations). */
export async function ensureRuntimeColumns(sql: Sql): Promise<void> {
  for (const q of [
    "alter table warehouses add column if not exists shop_only boolean not null default false",
    "alter table sale_invoices add column if not exists closed boolean not null default false",
    "alter table sale_invoices add column if not exists received_fx_rate double precision not null default 0",
    "alter table sale_invoices add column if not exists refund_amount double precision not null default 0",
    "alter table sale_invoices add column if not exists refund_account_id bigint",
    "alter table sale_invoices add column if not exists cash_included_base double precision not null default 0",
    "alter table party_payments add column if not exists applied_sale_id bigint",
    "alter table party_payments add column if not exists fx_rate double precision not null default 0",
    "alter table work_deliveries add column if not exists wage_per_unit numeric",
  ]) {
    await sql.query(q);
  }
}

/** Minimal tenant: profile, AFN (rate 1) + USD (rate 70), one AFN cash account. */
export async function seedUser(sql: Sql, userId: string) {
  await sql`insert into profiles (user_id, display_name, role) values (${userId}, ${"t"}, ${"accountant"})`;
  const afn = await sql<{ id: number }>`insert into currencies (user_id, name, symbol, rate_to_base) values (${userId}, ${"افغانی"}, ${"؋"}, ${1}) returning id`;
  const usd = await sql<{ id: number }>`insert into currencies (user_id, name, symbol, rate_to_base) values (${userId}, ${"دالر"}, ${"$"}, ${70}) returning id`;
  const acc = await sql<{ id: number }>`insert into accounts (user_id, name, currency_id, opening_balance) values (${userId}, ${"صندوق"}, ${afn[0].id}, ${0}) returning id`;
  return { afnId: afn[0].id, usdId: usd[0].id, accountId: acc[0].id };
}
