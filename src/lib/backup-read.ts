import type { Sql } from "@/lib/db";

/**
 * STR-06: read the given tables for one user. Tables that do not exist are
 * listed in `missingTables` (checked up front, so the snapshot transaction is
 * never aborted by a failed query).
 */
export async function readSnapshotTables(
  sql: Sql,
  userId: string,
  names: readonly string[],
): Promise<{ tables: Record<string, Record<string, unknown>[]>; missingTables: string[] }> {
  const exists = await sql<{ name: string; ok: boolean }>`
    select n as name, to_regclass('public.' || quote_ident(n)) is not null as ok
    from unnest(${[...names]}::text[]) as n
  `;
  const present = new Set(exists.filter((e) => e.ok).map((e) => e.name));
  const tables: Record<string, Record<string, unknown>[]> = {};
  const missingTables: string[] = [];
  for (const name of names) {
    if (!present.has(name)) {
      missingTables.push(name);
      continue;
    }
    tables[name] = await sql.query(`select * from ${name} where user_id = $1`, [userId]);
  }
  return { tables, missingTables };
}

/** STR-06: a Drive backup is only "ok" when every file uploaded and no table was missing. */
export function driveOutcome(
  uploaded: string[],
  failed: string[],
  missingTables: string[],
): { ok: boolean; partial: boolean; message: string } {
  const problems = failed.length + missingTables.length;
  if (uploaded.length > 0 && problems === 0) {
    return { ok: true, partial: false, message: `آپلود انجام شد (${uploaded.length} فایل)` };
  }
  if (uploaded.length > 0) {
    const parts = [
      failed.length ? `${failed.length} فایل ناموفق: ${failed.slice(0, 5).join("، ")}` : "",
      missingTables.length ? `جدول‌های خوانده‌نشده: ${missingTables.join("، ")}` : "",
    ].filter(Boolean);
    return {
      ok: false,
      partial: true,
      message: `پشتیبان ناقص است؛ ${uploaded.length} فایل آپلود شد. ${parts.join(" — ")}`,
    };
  }
  return {
    ok: false,
    partial: false,
    message: failed[0] || "فایل‌ها آپلود نشدند — ابزار آپلود فایل در Connector موجود نبود",
  };
}
