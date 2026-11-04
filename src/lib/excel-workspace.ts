import { getBootstrap } from "@/lib/api/core";
import { listCapital, listOpeningCash, listOpeningStock, listTransfers } from "@/lib/api/finance";
import { getInventory, listWorkOrders } from "@/lib/api/inventory";
import { listPurchaseInvoices, listSaleInvoices } from "@/lib/api/invoices";
import { listExpenses } from "@/lib/api/ops";
import { getPartyStatement, listPartyPayments } from "@/lib/api/reports";
import { stockCardsSheet, workOrdersSheet, type ExcelSheet, type ExcelValue } from "@/lib/excel";
import { downloadExcel } from "@/lib/excel-write";
import { formatPreferredDate } from "@/lib/jalali";
import {
  EMPLOYMENT_LABELS,
  ITEM_KIND_LABEL,
  PARTY_KIND_LABEL,
  type CalendarMode,
  type PurchaseInvoice,
  type SaleInvoice,
} from "@/lib/types";

async function settle<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function dateOf(iso: string, cal: CalendarMode): string {
  return iso ? formatPreferredDate(iso, cal) : "";
}

function sheet(name: string, headers: string[], rows: ExcelValue[][]): ExcelSheet | null {
  if (!rows.length) return null;
  return { name, title: name, headers, rows };
}

function saleLines(invoices: SaleInvoice[], cal: CalendarMode): ExcelValue[][] {
  const rows: ExcelValue[][] = [];
  for (const inv of invoices) {
    for (const line of inv.lines) {
      rows.push([
        inv.invoiceNo,
        dateOf(inv.occurredOn, cal),
        inv.customerName || "",
        ITEM_KIND_LABEL[inv.kind],
        line.itemName,
        line.quantity,
        line.unitPrice,
        line.quantity * line.unitPrice,
        inv.totalBase,
        inv.remainingBase,
        inv.notes || "",
      ]);
    }
  }
  return rows;
}

function purchaseLines(invoices: PurchaseInvoice[], cal: CalendarMode): ExcelValue[][] {
  const rows: ExcelValue[][] = [];
  for (const inv of invoices) {
    for (const line of inv.lines) {
      rows.push([
        inv.invoiceNo,
        dateOf(inv.occurredOn, cal),
        inv.vendorName || "",
        inv.receiveStatus === "arrived" ? "رسیده" : "در راه",
        line.itemName,
        line.quantity,
        line.receivedQty,
        line.unitPrice,
        line.quantity * line.unitPrice,
        inv.totalBase,
        inv.remainingBase,
        inv.notes || "",
      ]);
    }
  }
  return rows;
}

export async function exportWorkspaceExcel() {
  const boot = await getBootstrap();
  const cal = boot.settings.calendar;
  const cats = boot.catalogs;

  const [
    sales,
    purchases,
    expenses,
    payments,
    receipts,
    inventory,
    orders,
    transfers,
    capital,
    openingCash,
    openingFinished,
    openingRaw,
    customers,
    vendors,
  ] = await Promise.all([
    settle(() => listSaleInvoices()),
    settle(() => listPurchaseInvoices()),
    settle(() => listExpenses()),
    settle(() => listPartyPayments({ data: { kind: "payment" } })),
    settle(() => listPartyPayments({ data: { kind: "receipt" } })),
    settle(() => getInventory()),
    settle(() => listWorkOrders()),
    settle(() => listTransfers()),
    settle(() => listCapital()),
    settle(() => listOpeningCash()),
    settle(() => listOpeningStock({ data: { kind: "finished" } })),
    settle(() => listOpeningStock({ data: { kind: "raw" } })),
    settle(() => getPartyStatement({ data: { kind: "customer" } })),
    settle(() => getPartyStatement({ data: { kind: "vendor" } })),
  ]);

  const sheets: ExcelSheet[] = [];
  const push = (s: ExcelSheet | null | undefined) => {
    if (s && s.headers.length && s.rows.length) sheets.push(s);
  };

  if (sales) {
    push(
      sheet(
        "فروش فاکتورها",
        ["شماره", "تاریخ", "مشتری", "نوع", "جمع", "باقی", "یادداشت"],
        sales.map((r) => [
          r.invoiceNo,
          dateOf(r.occurredOn, cal),
          r.customerName || "",
          ITEM_KIND_LABEL[r.kind],
          r.totalBase,
          r.remainingBase,
          r.notes || "",
        ]),
      ),
    );
    push(
      sheet(
        "اقلام فروش",
        ["شماره", "تاریخ", "مشتری", "نوع", "نام", "تعداد", "قیمت فی", "جمع ردیف", "جمع فاکتور", "باقی", "یادداشت"],
        saleLines(sales, cal),
      ),
    );
  }

  if (purchases) {
    push(
      sheet(
        "خرید فاکتورها",
        ["شماره", "تاریخ", "فروشنده", "وضعیت", "جمع", "باقی", "یادداشت"],
        purchases.map((r) => [
          r.invoiceNo,
          dateOf(r.occurredOn, cal),
          r.vendorName || "",
          r.receiveStatus === "arrived" ? "رسیده" : "در راه",
          r.totalBase,
          r.remainingBase,
          r.notes || "",
        ]),
      ),
    );
    push(
      sheet(
        "اقلام خرید",
        [
          "شماره",
          "تاریخ",
          "فروشنده",
          "وضعیت",
          "نام",
          "تعداد",
          "رسیده",
          "قیمت فی",
          "جمع ردیف",
          "جمع فاکتور",
          "باقی",
          "یادداشت",
        ],
        purchaseLines(purchases, cal),
      ),
    );
  }

  if (expenses) {
    push(
      sheet(
        "هزینه‌ها",
        ["تشریح", "تاریخ", "مبلغ", "ارز", "از حساب", "طرف حساب", "دسته", "یادداشت"],
        expenses.map((r) => [
          r.title,
          dateOf(r.occurredOn, cal),
          r.amount,
          r.currencySymbol,
          r.asDebt ? "بدهی متفرقه" : r.accountName || "",
          r.partyName || "",
          r.categoryName || "",
          r.notes || "",
        ]),
      ),
    );
  }

  if (payments) {
    push(
      sheet(
        "پرداختی‌ها",
        ["تاریخ", "طرف حساب", "مبلغ", "ارز", "معادل افغانی", "حساب", "یادداشت"],
        payments.map((r) => [
          dateOf(r.occurredOn, cal),
          r.partyName,
          r.amount,
          r.currencySymbol,
          r.amountBase,
          r.accountName || "",
          r.notes || "",
        ]),
      ),
    );
  }

  if (receipts) {
    push(
      sheet(
        "دریافتی‌ها",
        ["تاریخ", "طرف حساب", "مبلغ", "ارز", "معادل افغانی", "حساب", "یادداشت"],
        receipts.map((r) => [
          dateOf(r.occurredOn, cal),
          r.partyName,
          r.amount,
          r.currencySymbol,
          r.amountBase,
          r.accountName || "",
          r.notes || "",
        ]),
      ),
    );
  }

  if (customers) {
    push(
      sheet(
        "طلبات",
        ["طرف حساب", "مجموع", "تسویه", "باقی"],
        customers.summaries.map((s) => [s.name, s.invoicedBase, s.paidBase, s.remainingBase]),
      ),
    );
  }

  if (vendors) {
    push(
      sheet(
        "بدهی‌ها",
        ["طرف حساب", "مجموع", "تسویه", "باقی"],
        vendors.summaries.map((s) => [s.name, s.invoicedBase, s.paidBase, s.remainingBase]),
      ),
    );
  }

  if (inventory) {
    push(stockCardsSheet("گدام کالا", inventory.products, "قیمت تمام‌شده"));
    push(stockCardsSheet("گدام مواد خام", inventory.raw, "قیمت خرید"));
    push(stockCardsSheet("مواد نزد کارگران", inventory.workerRaw.filter((c) => c.qty > 1e-9), "قیمت فی"));
  }

  if (orders) push(workOrdersSheet(orders));

  push(
    sheet(
      "دخل",
      ["نام حساب", "ارز", "موجودی اولیه", "موجودی فعلی"],
      cats.accounts.map((a) => [a.name, a.currencySymbol, a.openingBalance, a.balance]),
    ),
  );

  if (transfers) {
    push(
      sheet(
        "انتقالات",
        ["از حساب", "به حساب", "مبلغ", "تاریخ", "یادداشت"],
        transfers.map((r) => [r.fromAccountName, r.toAccountName, r.amount, dateOf(r.occurredOn, cal), r.notes || ""]),
      ),
    );
  }

  if (capital) {
    push(
      sheet(
        "سرمایه",
        ["نوع", "حساب", "مبلغ", "ارز", "تاریخ", "یادداشت"],
        capital.map((r) => [
          r.kind === "add" ? "افزودن سرمایه" : "برداشت سرمایه",
          r.accountName,
          r.amount,
          r.currencySymbol,
          dateOf(r.occurredOn, cal),
          r.notes || "",
        ]),
      ),
    );
  }

  if (openingCash) {
    push(
      sheet(
        "تعدیل موجودی دخل",
        ["حساب", "مبلغ", "ارز", "تاریخ", "یادداشت"],
        openingCash.map((r) => [r.accountName, r.amount, r.currencySymbol, dateOf(r.occurredOn, cal), r.notes || ""]),
      ),
    );
  }

  if (openingFinished) {
    push(
      sheet(
        "تعدیل کالای تولید شده",
        ["نام", "گدام", "مقدار", "قیمت فروش", "قیمت تمام‌شد", "ارزش", "تاریخ"],
        openingFinished.map((r) => [
          r.itemName,
          r.warehouseName,
          r.quantity,
          r.salePrice,
          r.unitCost,
          r.valueBase,
          dateOf(r.occurredOn, cal),
        ]),
      ),
    );
  }

  if (openingRaw) {
    push(
      sheet(
        "تعدیل مواد خام",
        ["نام", "گدام", "مقدار", "قیمت فروش", "ارزش", "تاریخ"],
        openingRaw.map((r) => [
          r.itemName,
          r.warehouseName,
          r.quantity,
          r.salePrice,
          r.valueBase,
          dateOf(r.occurredOn, cal),
        ]),
      ),
    );
  }

  push(
    sheet(
      "طرف‌حساب‌ها",
      ["نام", "نوع", "تلفن", "دسته", "وظیفه", "مرحله", "استخدام", "معاش", "یادداشت"],
      cats.parties.map((p) => [
        p.name,
        PARTY_KIND_LABEL[p.kind],
        p.phone,
        p.categoryName || "",
        p.jobTypeName || "",
        p.stageName || "",
        p.kind === "worker" ? EMPLOYMENT_LABELS[p.employment] : "",
        p.kind === "worker" ? p.salary : "",
        p.notes || "",
      ]),
    ),
  );

  push(
    sheet(
      "اجناس",
      ["نام", "نوع", "دسته", "واحد", "حداقل", "قیمت فروش", "قیمت خرید"],
      cats.items.map((i) => [
        i.name,
        ITEM_KIND_LABEL[i.kind],
        i.categoryName || "",
        i.unitName || "",
        i.minQty,
        i.salePrice,
        i.purchasePrice,
      ]),
    ),
  );

  if (!sheets.length) throw new Error("empty");
  const company = boot.company?.name || "دفتر حساب";
  const day = dateOf(new Date().toISOString().slice(0, 10), cal);
  await downloadExcel(`${company} ${day}`, sheets);
}
