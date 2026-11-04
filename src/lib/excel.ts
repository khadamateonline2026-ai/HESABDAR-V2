import { toLatinDigits } from "@/lib/format";
import type { StockCard, WorkOrder } from "@/lib/types";

export type ExcelValue = string | number | boolean | null;
export type ExcelSheet = {
  name: string;
  title?: string;
  headers: string[];
  rows: ExcelValue[][];
};

function headerLabel(th: Element): string {
  const clone = th.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, svg, input").forEach((el) => el.remove());
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function cellValue(td: Element): ExcelValue {
  if (td.classList.contains("no-print")) return "";
  const field = td.querySelector("input, textarea, select");
  if (field instanceof HTMLSelectElement) {
    return parseCell(field.selectedOptions[0]?.text ?? field.value);
  }
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    return parseCell(field.value);
  }
  const clone = td.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, svg, .no-print").forEach((el) => el.remove());
  return parseCell((clone.textContent || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim());
}

function parseCell(raw: string): ExcelValue {
  const t = raw.trim();
  if (!t || t === "—") return "";
  const latin = toLatinDigits(t);
  const stripped = latin.replace(/[؋$€£¥]/g, "").replace(/,/g, "").trim();
  if (/^-?\d+(\.\d+)?$/.test(stripped) && /[\d؋$€£¥]/.test(latin)) {
    const n = Number(stripped);
    if (Number.isFinite(n)) return n;
  }
  return t;
}

function tableHeading(table: HTMLTableElement, index: number): string {
  const boxed = table.closest("section, article");
  const heading = boxed?.querySelector("h2, h3, h4");
  const text = heading?.textContent?.replace(/\s+/g, " ").trim();
  if (text) return text;
  return `برگ ${index + 1}`;
}

function skipColumns(table: HTMLTableElement): Set<number> {
  const skip = new Set<number>();
  const heads = table.querySelectorAll("thead th");
  heads.forEach((th, i) => {
    if (th.classList.contains("no-print") || !headerLabel(th)) skip.add(i);
  });
  return skip;
}

function extractRow(tr: HTMLTableRowElement, skip: Set<number>): ExcelValue[] | null {
  const cells = [...tr.querySelectorAll("th, td")];
  if (cells.length === 1 && Number(cells[0].getAttribute("colspan") || "1") > 1) return null;
  const out: ExcelValue[] = [];
  let col = 0;
  for (const td of cells) {
    const span = Number(td.getAttribute("colspan") || "1") || 1;
    const val = cellValue(td);
    for (let k = 0; k < span; k += 1) {
      if (!skip.has(col)) out.push(k === 0 ? val : "");
      col += 1;
    }
  }
  if (!out.some((v) => v !== "" && v != null)) return null;
  return out;
}

export function tablesToSheets(root: HTMLElement): ExcelSheet[] {
  const tables = [...root.querySelectorAll("table")];
  return tables
    .map((table, index) => {
      const skip = skipColumns(table);
      const headers = [...table.querySelectorAll("thead th")]
        .map((th, i) => (skip.has(i) ? null : headerLabel(th)))
        .filter((h): h is string => h != null);
      const rows: ExcelValue[][] = [];
      table.querySelectorAll("tbody tr, tfoot tr").forEach((tr) => {
        const row = extractRow(tr as HTMLTableRowElement, skip);
        if (row) rows.push(row);
      });
      return {
        name: tableHeading(table, index),
        headers,
        rows,
      } satisfies ExcelSheet;
    })
    .filter((s) => s.headers.length && s.rows.length);
}

export function stockCardsSheet(name: string, cards: StockCard[], costLabel: string): ExcelSheet {
  return {
    name,
    title: name,
    headers: ["نام", "دسته", "واحد", "موجودی", "حداقل", costLabel, "ارزش", "قیمت فروش"],
    rows: cards.map((c) => [
      c.name,
      c.categoryName || "بدون دسته",
      c.unitName || "",
      c.qty,
      c.minQty,
      c.unitCost,
      c.valueBase,
      c.salePrice,
    ]),
  };
}

export function workOrdersSheet(orders: WorkOrder[]): ExcelSheet {
  return {
    name: "سفارش کار",
    title: "سفارش کار",
    headers: ["شماره", "مدل", "کارگر", "مرحله", "تعداد", "تحویل", "باقی", "تاریخ"],
    rows: orders.map((o) => [
      o.invoiceNo,
      o.productName,
      o.workerName || "",
      o.stageName || "",
      o.quantity,
      o.deliveredQty,
      o.remaining,
      o.occurredOn,
    ]),
  };
}
