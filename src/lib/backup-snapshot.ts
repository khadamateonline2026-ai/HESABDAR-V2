import { WORKSPACE_TABLES } from "@/lib/api/helpers";

export const SNAPSHOT_TABLES = [...WORKSPACE_TABLES, "profiles", "data_backups"] as const;

export type SnapshotTableName = (typeof SNAPSHOT_TABLES)[number];

export type SnapshotPhoto = {
  filename: string;
  mime: string;
  dataUrl: string;
  table: string;
  rowId: string;
  column: string;
};

export type BackupSnapshot = {
  stamp: string;
  exportedAt: string;
  timezone: string;
  tables: Record<string, Record<string, unknown>[]>;
  missingTables: string[];
  photos: SnapshotPhoto[];
  rowCounts: Record<string, number>;
  tableCount: number;
  rowTotal: number;
  photoCount: number;
  fileCount: number;
  approxBytes: number;
  appUntouched: true;
};

export const TABLE_FA_LABEL: Record<string, string> = {
  companies: "شرکت",
  app_settings: "تنظیمات",
  currencies: "ارز",
  units: "واحد",
  job_types: "نوع وظیفه",
  production_stages: "مرحله تولید",
  wage_rates: "نرخ دستمزد",
  party_categories: "دسته طرف‌حساب",
  parties: "طرف‌حساب / مشتری / تامین‌کننده / کارگر",
  item_categories: "دسته کالا",
  item_types: "نوع کالا",
  items: "کالا و مواد خام",
  bom_lines: "فرمول مواد خام",
  item_overheads: "سایر مصارف کالا",
  production_overhead_types: "نوع سایر مصارف تولید",
  warehouses: "گدام",
  accounts: "حساب بانکی / صندوق",
  transfers: "انتقال وجه",
  capital_moves: "سرمایه",
  opening_cash: "موجودی اول دوره نقد",
  opening_stock: "موجودی اولیه کالا",
  purchase_invoices: "فاکتور خرید",
  purchases: "اقلام خرید",
  sale_invoices: "فاکتور فروش",
  sales: "اقلام فروش",
  expenses: "هزینه",
  expense_categories: "دسته هزینه",
  recurring_expenses: "هزینه تکراری",
  recurring_periods: "دوره هزینه تکراری",
  party_payments: "پرداخت و دریافت",
  worker_payments: "پرداخت کارگر",
  work_orders: "سفارش تولید",
  work_order_alloc: "تخصیص مواد به سفارش",
  work_deliveries: "تحویل تولید",
  staff_users: "کاربران",
  important_notes: "یادداشت‌های مهم",
  profiles: "پروفایل",
  data_backups: "پشتیبان‌های داخلی",
};

export function backupStamp(date = new Date(), timeZone = "Asia/Kabul"): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}_${g("hour")}-${g("minute")}`;
}

export function extractPhotos(tables: Record<string, Record<string, unknown>[]>): SnapshotPhoto[] {
  const photos: SnapshotPhoto[] = [];
  const used = new Set<string>();
  for (const [table, rows] of Object.entries(tables)) {
    for (const row of rows) {
      for (const [column, value] of Object.entries(row)) {
        if (typeof value !== "string" || !value.startsWith("data:image")) continue;
        const mime = value.slice(5, value.indexOf(";")) || "image/jpeg";
        const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
        const rowId = String(row.id ?? row.user_id ?? photos.length + 1);
        let filename = `${table}-${rowId}-${column}.${ext}`;
        let i = 2;
        while (used.has(filename)) {
          filename = `${table}-${rowId}-${column}-${i}.${ext}`;
          i += 1;
        }
        used.add(filename);
        photos.push({ filename, mime, dataUrl: value, table, rowId, column });
      }
    }
  }
  return photos;
}

export function cellForSheet(value: unknown): string | number {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  if (s.startsWith("data:image")) return `[عکس ${s.length} بایت]`;
  if (s.length > 32000) return `[داده بلند ${s.length} نویسه]`;
  return s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "\uFEFF\n";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => {
          const raw = cellForSheet(row[h]);
          const s = String(raw);
          if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        })
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\n")}`;
}

export function buildBackupLog(snap: BackupSnapshot, extra: string[] = []): string {
  const lines = [
    "BACKUP-LOG — حسابداری شرکت",
    `تاریخ و ساعت: ${snap.exportedAt}`,
    `منطقه زمانی: ${snap.timezone}`,
    `شناسه بسته: ${snap.stamp}`,
    `تعداد جدول: ${snap.tableCount}`,
    `تعداد کل ردیف: ${snap.rowTotal}`,
    `تعداد عکس: ${snap.photoCount}`,
    `تعداد فایل پیوست: ${snap.fileCount}`,
    `حجم تقریبی: ${formatBytes(snap.approxBytes)}`,
    "هیچ داده‌ای از اپ حذف یا بازنویسی نشده است.",
    "",
    "ردیف هر جدول:",
  ];
  for (const [name, count] of Object.entries(snap.rowCounts)) {
    const fa = TABLE_FA_LABEL[name] ? ` — ${TABLE_FA_LABEL[name]}` : "";
    lines.push(`  ${name}${fa}: ${count}`);
  }
  if (snap.missingTables.length) {
    lines.push("", "جدول‌هایی که خوانده نشد:");
    for (const m of snap.missingTables) lines.push(`  ${m}`);
  }
  if (extra.length) {
    lines.push("", ...extra);
  }
  return lines.join("\n");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} بایت`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} کیلوبایت`;
  return `${(n / (1024 * 1024)).toFixed(2)} مگابایت`;
}

export const GUIDE_TEXT = `پوشه پشتیبان حسابداری شرکت
================================
00-راهنما        این فایل
01-پشتیبان-کامل  هر پشتیبان کامل در یک پوشه تاریخ جدا
02-پشتیبان-روزانه پشتیبان روزانه؛ فایل قبلی حذف نمی‌شود
03-پشتیبان-ماهانه پشتیبان ماهانه

داخل هر بسته:
  excel/  یک فایل اکسل برای هر جدول
  csv/    همان جدول‌ها به صورت CSV
  json/   نسخه کامل پایگاه
  photos/ عکس کالا و لوگو
  files/  پیوست‌ها (اگر باشد)
  log/    BACKUP-LOG.txt

این پشتیبان فقط کپی است. داده زنده اپ دست نخورده می‌ماند.
`;
