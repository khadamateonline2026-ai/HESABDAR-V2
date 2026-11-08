/** Warehouse catalog backup (گدام) — current + legacy original formats. */

export type WarehouseBackupSection = "product" | "raw";

export type WarehouseBackupBom = {
  name: string;
  quantity: number;
  unit: string;
  purchasePrice: number;
};

export type WarehouseBackupItem = {
  name: string;
  category: string;
  unit: string;
  minQty: number;
  salePrice: number;
  purchasePrice: number;
  qty: number;
  notes: string;
  kind?: WarehouseBackupSection;
  bom?: WarehouseBackupBom[];
  overheads?: { title: string; amount: number }[];
  /** Which price/min fields were actually present in the file (absent → keep existing values on re-import). */
  has?: { minQty: boolean; salePrice: boolean; purchasePrice: boolean };
};

/** Alternate key names seen in older exports / hand-edited files (English + Persian). */
const MIN_KEYS = ["minQty", "min_qty", "minStock", "min_stock", "minimum", "min", "alertQty", "minAlert", "حداقل", "حداقل موجودی", "هشدار حداقل موجودی"];
const SALE_KEYS = ["salePrice", "sale_price", "sellPrice", "sell_price", "price", "قیمت فروش", "فروش"];
const BUY_KEYS = ["purchasePrice", "purchase_price", "buyPrice", "buy_price", "cost", "costPrice", "unitCost", "قیمت خرید", "خرید"];

function pickNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  const pools: Record<string, unknown>[] = [row];
  for (const nest of ["prices", "price", "stock", "pricing"]) {
    const v = row[nest];
    if (v && typeof v === "object" && !Array.isArray(v)) pools.push(v as Record<string, unknown>);
  }
  for (const pool of pools) {
    for (const k of keys) {
      const v = pool[k];
      if (v === undefined || v === null || v === "" || typeof v === "object") continue;
      const n = asBackupNumber(typeof v === "string" ? v.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))) : v);
      return Math.max(0, n);
    }
  }
  return undefined;
}

export type ParsedWarehouseBackup = {
  section: WarehouseBackupSection;
  items: WarehouseBackupItem[];
  format: "current" | "legacy";
};

export function asBackupNumber(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/,/g, ""))
        : NaN;
  return Number.isFinite(n) ? n : 0;
}

export function asBackupText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isSection(value: unknown): value is WarehouseBackupSection {
  return value === "product" || value === "raw";
}

/**
 * Resolve which warehouse section a backup targets.
 * Current V2/original export: `{ app: "hesabdar", section: "product"|"raw", items }`
 * Legacy export (still in the wild): `{ type: "hesabdar-warehouse", warehouse: "product"|"raw", items }`
 */
export function resolveWarehouseBackupSection(parsed: Record<string, unknown>): WarehouseBackupSection | null {
  if (isSection(parsed.section)) return parsed.section;
  if (isSection(parsed.warehouse)) return parsed.warehouse;
  return null;
}

export function detectWarehouseBackupFormat(parsed: Record<string, unknown>): "current" | "legacy" | "unknown" {
  if (parsed.type === "hesabdar-warehouse" || (isSection(parsed.warehouse) && !isSection(parsed.section))) {
    return "legacy";
  }
  if (parsed.app === "hesabdar" || isSection(parsed.section)) {
    return "current";
  }
  if (isSection(parsed.warehouse) || isSection(parsed.section)) return "legacy";
  return "unknown";
}

/** True when JSON looks like a warehouse backup (not a full workspace dump). */
export function isWarehouseBackupPayload(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const o = parsed as Record<string, unknown>;
  if (!Array.isArray(o.items)) return false;
  if (o.type === "hesabdar-warehouse") return true;
  if (o.app === "hesabdar" && isSection(o.section)) return true;
  if (isSection(o.section) || isSection(o.warehouse)) return true;
  return false;
}

function normalizeBom(raw: unknown): WarehouseBackupBom[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: WarehouseBackupBom[] = [];
  for (const line of raw) {
    if (!line || typeof line !== "object" || Array.isArray(line)) continue;
    const row = line as Record<string, unknown>;
    const name = asBackupText(row.name);
    const quantity = asBackupNumber(row.quantity);
    if (!name || quantity <= 0) continue;
    out.push({
      name,
      quantity,
      unit: asBackupText(row.unit),
      purchasePrice: pickNumber(row, BUY_KEYS) ?? 0,
    });
  }
  return out;
}

function normalizeOverheads(raw: unknown): { title: string; amount: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((line) => {
      if (!line || typeof line !== "object" || Array.isArray(line)) return null;
      const row = line as Record<string, unknown>;
      const title = asBackupText(row.title);
      const amount = Math.max(0, asBackupNumber(row.amount));
      if (!title || amount <= 0) return null;
      return { title, amount };
    })
    .filter((x): x is { title: string; amount: number } => Boolean(x));
}

function normalizeItem(raw: unknown): WarehouseBackupItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const name = asBackupText(row.name);
  if (!name) return null;
  const kind = isSection(row.kind) ? row.kind : undefined;
  const minQty = pickNumber(row, MIN_KEYS);
  const salePrice = pickNumber(row, SALE_KEYS);
  const purchasePrice = pickNumber(row, BUY_KEYS);
  return {
    name,
    category: asBackupText(row.category),
    unit: asBackupText(row.unit),
    minQty: minQty ?? 0,
    salePrice: salePrice ?? 0,
    purchasePrice: purchasePrice ?? 0,
    has: { minQty: minQty !== undefined, salePrice: salePrice !== undefined, purchasePrice: purchasePrice !== undefined },
    qty: Math.max(0, asBackupNumber(row.qty ?? row.quantity ?? row["موجودی"])),
    notes: asBackupText(row.notes),
    kind,
    bom: normalizeBom(row.bom),
    overheads: normalizeOverheads(row.overheads),
  };
}

/**
 * Parse a warehouse backup JSON string for the active گدام tab.
 * Accepts current (`section`) and legacy (`type`/`warehouse`) shapes.
 */
export function parseWarehouseBackup(text: string, expectedSection: WarehouseBackupSection): ParsedWarehouseBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("فایل معتبر نیست");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("فایل معتبر نیست");
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.items)) {
    throw new Error("این فایل مربوط همین گدام نیست");
  }
  const section = resolveWarehouseBackupSection(obj);
  if (section !== expectedSection) {
    throw new Error("این فایل مربوط همین گدام نیست");
  }
  const format = detectWarehouseBackupFormat(obj);
  const items: WarehouseBackupItem[] = [];
  for (const raw of obj.items) {
    const item = normalizeItem(raw);
    if (!item) continue;
    // Skip rows whose kind explicitly disagrees with the target warehouse.
    if (item.kind && item.kind !== expectedSection) continue;
    items.push(item);
  }
  if (!items.length) throw new Error("فایل قلمی برای خواندن ندارد");
  return { section, items, format: format === "unknown" ? "current" : format };
}
