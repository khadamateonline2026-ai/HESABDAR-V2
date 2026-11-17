import { z } from "zod";

/**
 * ACC-13: server-side input checks for every server function. The client
 * types are compile-time only, so a broken or tampered request could send
 * NaN, Infinity, null or text where a number is expected and the old code
 * silently treated it as 0. This walks the whole payload and rejects it with
 * a Persian message instead.
 */

const finite = z.number(); // zod 4: NaN and ±Infinity are rejected
const nonNegative = z.number().min(0);
const isoDate = z.iso.date();
const safeId = z.number().int().refine((n) => Number.isSafeInteger(n));

/** Must be a real number whenever the key is present. */
const REQUIRED_NUMBER: Record<string, string> = {
  amount: "مبلغ",
  quantity: "مقدار",
  qty: "مقدار",
  unitPrice: "قیمت",
};
/** Never below zero. */
const NON_NEGATIVE: Record<string, string> = {
  unitPrice: "قیمت",
  price: "قیمت",
  salePrice: "قیمت فروش",
  purchasePrice: "قیمت خرید",
  salary: "معاش",
  wagePerUnit: "مزد",
  minQty: "حداقل موجودی",
  receivedAmount: "مبلغ دریافتی",
  paidAmount: "مبلغ پرداختی",
  refundAmount: "مبلغ برگشتی",
  fxRate: "نرخ ارز",
  rateToBase: "نرخ ارز",
};
const DATE_KEY = /^(occurredOn|startOn|expectedOn|dueOn|startDate|from|to)$/;
const ID_KEY = /^(id|[a-z][A-Za-z]*Id)$/;
const MAX_DEPTH = 12;

function invalid(label: string): never {
  throw new Error(`${label} نامعتبر است`);
}

function walk(value: unknown, key: string, depth: number): void {
  if (depth > MAX_DEPTH) invalid("ورودی");
  if (Array.isArray(value)) {
    for (const v of value) walk(v, key, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walk(v, k, depth + 1);
    return;
  }
  const required = REQUIRED_NUMBER[key];
  if (required && value !== undefined && !finite.safeParse(value).success) invalid(required);
  if (typeof value === "number") {
    if (!finite.safeParse(value).success) invalid(REQUIRED_NUMBER[key] ?? NON_NEGATIVE[key] ?? "عدد");
    const nn = NON_NEGATIVE[key];
    if (nn && !nonNegative.safeParse(value).success) invalid(nn);
    if (ID_KEY.test(key) && !safeId.safeParse(value).success) invalid("شناسه");
    return;
  }
  if (typeof value === "string" && DATE_KEY.test(key) && value !== "" && !isoDate.safeParse(value).success) {
    invalid("تاریخ");
  }
}

/** Use in `.validator((d: T) => validInput(d))`; returns the same object. */
export function validInput<T>(d: T): T {
  walk(d, "", 0);
  return d;
}

/** Same as validInput, plus the named amounts must be above zero. */
export function validPositive<T extends Record<string, unknown>>(d: T, ...keys: (keyof T & string)[]): T {
  validInput(d);
  for (const k of keys) {
    const v = d[k];
    if (typeof v !== "number" || !(v > 0)) throw new Error("مبلغ باید بزرگ‌تر از صفر باشد");
  }
  return d;
}
