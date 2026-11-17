import type { Sql } from "@/lib/db";

/**
 * STR-06: run several reads against ONE consistent snapshot. Call as the first
 * thing inside a fresh transaction; all reads then see the same committed
 * state (REPEATABLE READ) and nothing can be written by mistake (READ ONLY).
 */
export async function readInSnapshot<T>(sql: Sql, fn: (sql: Sql) => Promise<T>): Promise<T> {
  await sql`set transaction isolation level repeatable read read only`;
  return fn(sql);
}
