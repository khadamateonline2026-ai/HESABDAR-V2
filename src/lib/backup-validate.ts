/**
 * STR-02 — validation of a full-workspace backup BEFORE anything is deleted.
 *
 * A restore replaces every workspace table, so a file that is empty, partial
 * or truncated must be refused up front (it used to be accepted: `{tables:{}}`
 * wiped all 36 tables). Pure function — no DB access — so it is unit-tested.
 */
export const RESTORE_CONFIRM = "replace-all" as const;

export const BACKUP_VERSIONS = [1] as const;

export type BackupManifest = { tables: Record<string, number>; rowTotal: number };

export type ValidBackup = {
  tables: Record<string, Record<string, unknown>[]>;
  profile: { display_name?: string; role?: string } | null;
  rowTotal: number;
};

const INVALID = "فایل پشتیبان معتبر نیست";

export function buildManifest(tables: Record<string, unknown[]>): BackupManifest {
  const counts: Record<string, number> = {};
  let rowTotal = 0;
  for (const [name, rows] of Object.entries(tables)) {
    counts[name] = rows.length;
    rowTotal += rows.length;
  }
  return { tables: counts, rowTotal };
}

/**
 * Throws a Persian error unless `parsed` is a complete backup of `requiredTables`:
 * known version, every table present as an array of row objects, at least one
 * currency (every real workspace has one), and — when the file carries a
 * manifest (all backups made by this version do) — row counts that match it.
 */
/** ACC-09: purchase_receipts is rebuilt from purchases.received_qty on restore. */
export const OPTIONAL_BACKUP_TABLES: readonly string[] = ["purchase_receipts"];

export function validateWorkspaceBackup(parsed: unknown, requiredTables: readonly string[]): ValidBackup {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(INVALID);
  const obj = parsed as {
    version?: unknown;
    tables?: unknown;
    profile?: unknown;
    manifest?: unknown;
  };
  if (!BACKUP_VERSIONS.includes(obj.version as 1)) {
    throw new Error(`${INVALID}: نسخه فایل پشتیبان شناخته‌شده نیست`);
  }
  if (!obj.tables || typeof obj.tables !== "object" || Array.isArray(obj.tables)) throw new Error(INVALID);
  const tables = obj.tables as Record<string, unknown>;
  // Tables added after older backups were made start empty when absent.
  for (const name of OPTIONAL_BACKUP_TABLES) {
    if (requiredTables.includes(name) && tables[name] === undefined) tables[name] = [];
  }
  const missing = requiredTables.filter((name) => !Array.isArray(tables[name]));
  if (missing.length) {
    throw new Error(`پشتیبان ناقص است؛ این جدول‌ها در فایل نیستند: ${missing.join("، ")}. هیچ داده‌ای تغییر نکرد.`);
  }
  let rowTotal = 0;
  for (const name of requiredTables) {
    const rows = tables[name] as unknown[];
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(INVALID);
    }
    rowTotal += rows.length;
  }
  if ((tables.currencies as unknown[]).length === 0) {
    throw new Error("پشتیبان خالی یا ناقص است (هیچ ارزی ندارد). هیچ داده‌ای تغییر نکرد.");
  }
  if (obj.manifest != null) {
    const m = obj.manifest as Partial<BackupManifest>;
    if (!m.tables || typeof m.tables !== "object") throw new Error(`${INVALID}: فهرست جدول‌ها خراب است`);
    const bad: string[] = [];
    for (const name of requiredTables) {
      const expected = m.tables[name];
      if (typeof expected === "number" && expected !== (tables[name] as unknown[]).length) bad.push(name);
    }
    if (typeof m.rowTotal === "number" && m.rowTotal !== rowTotal && !bad.length) bad.push("rowTotal");
    if (bad.length) {
      throw new Error(`پشتیبان ناقص است؛ تعداد ردیف‌ها با فهرست فایل نمی‌خواند (${bad.join("، ")}). هیچ داده‌ای تغییر نکرد.`);
    }
  }
  const profile =
    obj.profile && typeof obj.profile === "object" && !Array.isArray(obj.profile)
      ? (obj.profile as { display_name?: string; role?: string })
      : null;
  return { tables: tables as Record<string, Record<string, unknown>[]>, profile, rowTotal };
}

export function assertRestoreConfirmed(confirm: unknown): void {
  if (confirm !== RESTORE_CONFIRM) {
    throw new Error("بازیابی همه داده‌ها را جایگزین می‌کند و باید صریحاً تأیید شود");
  }
}
