const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toLatinDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (ch) => {
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (p >= 0) return String(p);
    const a = ARABIC_DIGITS.indexOf(ch);
    return a >= 0 ? String(a) : ch;
  });
}

export function parseAmount(value: string): number {
  const clean = toLatinDigits(value).replace(/,/g, "").trim();
  if (!clean) return 0;
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

export function formatDecimal(value: string | number): string {
  const raw = toLatinDigits(String(value)).trim();
  if (!raw || raw === "-") return raw;
  if (raw === "." || raw === "-.") return raw === "." ? "0." : "-0.";
  const neg = raw.startsWith("-");
  const body = neg ? raw.slice(1) : raw;
  const trailingDot = body.endsWith(".") && body.split(".").length === 2;
  const [intPart, ...rest] = body.split(".");
  const dec = rest.join("");
  const grouped = (intPart || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const out = dec.length ? `${grouped}.${dec}` : trailingDot ? `${grouped}.` : grouped;
  return neg ? `-${out}` : out;
}

export function emptyNum(n: number | null | undefined): string {
  if (n == null || n === 0) return "";
  return String(n);
}

export function formatMoney(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 10000) / 10000;
  const asStr =
    Math.abs(rounded - Math.round(rounded)) < 1e-9
      ? String(Math.round(rounded))
      : String(Number(rounded.toFixed(4)));
  return formatDecimal(asStr);
}

export function formatMoneyInt(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "0";
  return formatDecimal(String(Math.round(n)));
}

export function formatMoneySymbol(value: number | string, symbol = "؋"): string {
  return `${formatMoney(value)} ${symbol}`;
}

export function toBase(amount: number, rate: number): number {
  return amount * (rate || 1);
}

export function convertAmount(amount: number, fromRate: number, toRate: number): number {
  const fr = fromRate || 1;
  const tr = toRate || 1;
  return (amount * fr) / tr;
}

export function rateToBaseOf<T extends { id: number; rateToBase: number }>(
  currencies: T[],
  id: number | null | undefined,
): number {
  if (id == null) return 1;
  return currencies.find((c) => c.id === id)?.rateToBase || 1;
}

export function stripCommas(value: string): string {
  return toLatinDigits(value).replace(/,/g, "");
}

export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isoToDisplay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

export function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}


export function text(value: unknown): string {
  return value == null ? "" : String(value);
}

export function idOf(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function findAfn<T extends { name: string; symbol: string }>(currencies: T[]): T | undefined {
  return currencies.find((c) => c.symbol === "؋" || c.name === "افغانی") ?? currencies[0];
}

export function nextInvoiceNo(existing: string[], prefix: string): string {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const raw of existing) {
    const m = raw.trim().match(re);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `${prefix}-${max + 1}`;
}
