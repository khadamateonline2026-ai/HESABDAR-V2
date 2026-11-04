import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { num, text } from "@/lib/format";
import { convertAmount } from "@/lib/format";
import {
  fxToBase,
  getRoleCodes,
  guard,
  invoiceOf,
  isFinalStatus,
  itemKindLabel,
  itemKindOf,
  loadCatalogs,
  loadInventoryState,
  requireProfile,
  sqlOf,
  assertCashAvailable,
} from "./helpers";
import { loadRecurringDues } from "./ops";
import type { Item, ModelSummary, PartyPayment, PartySummary, PurchaseLedgerRow, SaleLedgerRow } from "@/lib/types";
import type { Sql } from "@/lib/db";

function inRange(iso: string, from?: string | null, to?: string | null): boolean {
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

export type ExpenseDebt = {
  id: number;
  title: string;
  amount: number;
  amountBase: number;
  currencySymbol: string;
  occurredOn: string;
  partyName: string;
  source: "expense" | "recurring" | "salary";
};

export async function loadExpenseDebts(
  sql: Sql,
  userId: string,
  from?: string | null,
  to?: string | null,
): Promise<ExpenseDebt[]> {
  const rows = await sql<Record<string, unknown>>`
    select e.id, e.title, e.amount, e.occurred_on, e.currency_id, c.symbol as currency_symbol, c.rate_to_base,
      p.name as party_name
    from expenses e
    join currencies c on c.id = e.currency_id
    left join parties p on p.id = e.party_id
    where e.user_id = ${userId} and e.as_debt = true
    order by e.occurred_on desc, e.id desc
  `;
  const debts: ExpenseDebt[] = rows
    .filter((r) => inRange(text(r.occurred_on), from, to))
    .map((r) => {
      const amount = num(r.amount);
      const rate = num(r.rate_to_base) || 1;
      return {
        id: num(r.id),
        title: text(r.title),
        amount,
        amountBase: amount * rate,
        currencySymbol: text(r.currency_symbol) || "؋",
        occurredOn: text(r.occurred_on),
        partyName: text(r.party_name),
        source: "expense" as const,
      };
    });
  const dues = await loadRecurringDues(sql, userId);
  const currencies = await sql<{ id: number; rate_to_base: unknown }>`
    select id, rate_to_base from currencies where user_id = ${userId}
  `;
  const dueRate = (id: number) => currencies.find((c) => num(c.id) === id)?.rate_to_base;
  const pays = await sql<{ worker_id: number; amount: unknown }>`
    select worker_id, amount from worker_payments where user_id = ${userId}
  `;
  const paidLeft = new Map<number, number>();
  for (const p of pays) {
    paidLeft.set(num(p.worker_id), (paidLeft.get(num(p.worker_id)) ?? 0) + num(p.amount));
  }
  const unpaid = dues
    .filter((x) => x.status === "unpaid")
    .slice()
    .sort((a, b) => (a.dueOn === b.dueOn ? a.period.localeCompare(b.period) : a.dueOn.localeCompare(b.dueOn)));
  for (const d of unpaid) {
    if (!inRange(d.dueOn, from, to)) continue;
    let amount = d.amount;
    if (d.workerId != null) {
      const left = paidLeft.get(d.workerId) ?? 0;
      if (left + 1e-9 >= amount) {
        paidLeft.set(d.workerId, left - amount);
        continue;
      }
      if (left > 1e-9) {
        amount -= left;
        paidLeft.set(d.workerId, 0);
      }
    }
    const rate = num(dueRate(d.currencyId)) || 1;
    debts.push({
      id: -(d.recurringId * 10000 + d.period.split("").reduce((s, c) => s + c.charCodeAt(0), 0)),
      title: d.title,
      amount,
      amountBase: amount * rate,
      currencySymbol: d.currencySymbol,
      occurredOn: d.dueOn,
      partyName: d.partyName,
      source: d.workerId ? "salary" : "recurring",
    });
  }
  return debts;
}

function rateMap(rows: { id: number; rate_to_base: unknown }[]) {
  const m = new Map<number, number>();
  for (const r of rows) m.set(num(r.id), num(r.rate_to_base) || 1);
  return m;
}

function invRate(row: Record<string, unknown>, rates: Map<number, number>): number {
  return fxToBase(row.fx_enabled, row.fx_rate, rates.get(num(row.inv_currency_id ?? row.currency_id)) ?? 1);
}

type ImpliedFx = Map<string, { orig: number; base: number }>;

function fxKey(partyId: number, currencyId: number) {
  return `${partyId}:${currencyId}`;
}

function addImplied(map: ImpliedFx, partyId: number, currencyId: number, orig: number, base: number) {
  const k = fxKey(partyId, currencyId);
  const cur = map.get(k) ?? { orig: 0, base: 0 };
  cur.orig += orig;
  cur.base += base;
  map.set(k, cur);
}

function settleRate(
  implied: ImpliedFx,
  partyId: number,
  currencyId: number,
  rates: Map<number, number>,
  registered?: number,
  override?: number,
): number {
  if (override && override > 1e-12) return override;
  const cid = num(currencyId);
  const imp = implied.get(fxKey(partyId, cid));
  if (imp && Math.abs(imp.orig) > 1e-9) return imp.base / imp.orig;
  if (registered && registered > 0) return registered;
  return rates.get(cid) ?? 1;
}

function paymentRate(
  row: { fx_rate?: unknown; rate_to_base?: unknown; currency_id?: unknown },
  implied: ImpliedFx,
  partyId: number,
  rates: Map<number, number>,
): number {
  return settleRate(implied, partyId, num(row.currency_id), rates, num(row.rate_to_base), num(row.fx_rate));
}

function signedPaidBase(partyKind: "customer" | "vendor", payKind: string, amountBase: number): number {
  const incoming = payKind === "receipt";
  if (partyKind === "customer") return incoming ? amountBase : -amountBase;
  return incoming ? -amountBase : amountBase;
}

export async function loadPartySummaries(
  sql: Sql,
  userId: string,
  kind: "customer" | "vendor",
  from?: string | null,
  to?: string | null,
): Promise<{
  parties: { id: number; name: string }[];
  summaries: PartySummary[];
  rates: Map<number, number>;
  implied: ImpliedFx;
}> {
  const [partyRows, currencies] = await Promise.all([
    sql<{ id: number; name: string }>`
      select id, name from parties where user_id = ${userId} and kind = ${kind} order by name
    `,
    sql<{ id: number; rate_to_base: unknown }>`select id, rate_to_base from currencies where user_id = ${userId}`,
  ]);
  const rates = rateMap(currencies);
  const parties = partyRows.map((p) => ({ id: num(p.id), name: text(p.name) }));
  const invoiced = new Map<number, number>();
  const paid = new Map<number, number>();
  const implied: ImpliedFx = new Map();
  const bump = (map: Map<number, number>, id: number, amt: number) => map.set(id, (map.get(id) ?? 0) + amt);

  if (kind === "customer") {
    await sql.query("alter table sale_invoices add column if not exists cash_included_base double precision not null default 0");
    await sql.query("alter table party_payments add column if not exists applied_sale_id bigint");
    const sales = await sql<Record<string, unknown>>`
      select s.customer_id as party_id, s.quantity, s.unit_price, s.status, s.currency_id, s.occurred_on,
        inv.fx_enabled, inv.fx_rate, inv.currency_id as inv_currency_id
      from sales s
      left join sale_invoices inv on inv.id = s.invoice_id
      where s.user_id = ${userId}
    `;
    for (const r of sales) {
      if (!isFinalStatus(r.status) || r.party_id == null) continue;
      if (!inRange(text(r.occurred_on), from, to)) continue;
      const partyId = num(r.party_id);
      const orig = num(r.quantity) * num(r.unit_price);
      const rate = invRate(r, rates);
      bump(invoiced, partyId, orig * rate);
      addImplied(implied, partyId, num(r.inv_currency_id ?? r.currency_id), orig, orig * rate);
    }
    const extras = await sql<{ customer_id: number | null; cash_included_base: unknown; occurred_on: string }>`
      select customer_id, cash_included_base, occurred_on from sale_invoices
      where user_id = ${userId} and cash_included_base > 0
    `;
    for (const e of extras) {
      if (e.customer_id == null) continue;
      if (!inRange(text(e.occurred_on), from, to)) continue;
      bump(invoiced, num(e.customer_id), num(e.cash_included_base));
    }
    const pays = await sql<Record<string, unknown>>`
      select p.party_id, p.amount, p.currency_id, p.occurred_on, p.kind, p.fx_rate, c.rate_to_base
      from party_payments p
      join currencies c on c.id = p.currency_id
      join parties pt on pt.id = p.party_id
      where p.user_id = ${userId} and pt.kind = ${"customer"} and p.applied_sale_id is null and p.sale_invoice_id is null
    `;
    for (const p of pays) {
      if (!inRange(text(p.occurred_on), from, to)) continue;
      const partyId = num(p.party_id);
      const amountBase = num(p.amount) * paymentRate(p, implied, partyId, rates);
      if (text(p.kind) === "payment") bump(invoiced, partyId, amountBase);
      else bump(paid, partyId, signedPaidBase("customer", text(p.kind), amountBase));
    }
    const linked = await sql<Record<string, unknown>>`
      select i.id, i.customer_id, i.occurred_on, i.fx_enabled, i.fx_rate, i.currency_id,
        i.received_amount, i.received_fx_rate, i.refund_amount, i.cash_included_base,
        coalesce(sum(s.quantity * s.unit_price), 0) as goods
      from sale_invoices i
      left join sales s on s.invoice_id = i.id and s.user_id = i.user_id
      where i.user_id = ${userId}
      group by i.id
    `;
    for (const h of linked) {
      if (h.customer_id == null) continue;
      if (!inRange(text(h.occurred_on), from, to)) continue;
      const rate = invRate(h, rates);
      const invoiceBase = num(h.goods) * rate + num(h.cash_included_base);
      const recvRate = num(h.received_fx_rate) > 0 ? num(h.received_fx_rate) : rate;
      const receivedBase = num(h.received_amount) * recvRate;
      const refund = num(h.refund_amount);
      const settled = refund > 1e-9 ? Math.min(invoiceBase, Math.max(0, receivedBase - refund)) : receivedBase;
      bump(paid, num(h.customer_id), settled);
    }
  } else {
    const purchases = await sql<Record<string, unknown>>`
      select p.vendor_id as party_id, p.quantity, p.unit_price, p.status, p.currency_id, p.occurred_on,
        inv.fx_enabled, inv.fx_rate, inv.currency_id as inv_currency_id
      from purchases p
      left join purchase_invoices inv on inv.id = p.invoice_id
      where p.user_id = ${userId}
    `;
    for (const r of purchases) {
      if (!isFinalStatus(r.status) || r.party_id == null) continue;
      if (!inRange(text(r.occurred_on), from, to)) continue;
      const partyId = num(r.party_id);
      const orig = num(r.quantity) * num(r.unit_price);
      const rate = invRate(r, rates);
      bump(invoiced, partyId, orig * rate);
      addImplied(implied, partyId, num(r.inv_currency_id ?? r.currency_id), orig, orig * rate);
    }
    const pays = await sql<Record<string, unknown>>`
      select p.party_id, p.amount, p.currency_id, p.occurred_on, p.kind, p.fx_rate, c.rate_to_base
      from party_payments p
      join currencies c on c.id = p.currency_id
      join parties pt on pt.id = p.party_id
      where p.user_id = ${userId} and pt.kind = ${"vendor"}
    `;
    for (const p of pays) {
      if (!inRange(text(p.occurred_on), from, to)) continue;
      const partyId = num(p.party_id);
      const amountBase = num(p.amount) * paymentRate(p, implied, partyId, rates);
      bump(paid, partyId, signedPaidBase("vendor", text(p.kind), amountBase));
    }
  }

  const summaries = parties
    .map((p) => {
      const invoicedBase = invoiced.get(p.id) ?? 0;
      const paidBase = paid.get(p.id) ?? 0;
      return { id: p.id, name: p.name, invoicedBase, paidBase, remainingBase: invoicedBase - paidBase };
    })
    .filter((s) => Math.abs(s.invoicedBase) > 1e-9 || Math.abs(s.paidBase) > 1e-9)
    .sort((a, b) => b.remainingBase - a.remainingBase);

  return { parties, summaries, rates, implied };
}

export const getSalesLedger = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { itemId?: number | null }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    const [items, currencies, sales] = await Promise.all([
      sql<Record<string, unknown>>`select id, name, kind from items where user_id = ${context.userId} order by name`,
      sql<{ id: number; rate_to_base: unknown }>`select id, rate_to_base from currencies where user_id = ${context.userId}`,
      sql<Record<string, unknown>>`
        select s.*, i.kind as item_kind
        from sales s
        left join items i on i.id = s.item_id
        where s.user_id = ${context.userId}
        order by s.occurred_on, s.id
      `,
    ]);
    const rates = rateMap(currencies);
    const itemById = new Map(items.map((i) => [num(i.id), i]));
    const itemByName = new Map(items.map((i) => [text(i.name), i]));

    const models = items
      .filter((i) => itemKindOf(i.kind) === "product")
      .map((i) => ({ id: num(i.id), name: text(i.name) }));

    const liveSales = sales.filter((r) => isFinalStatus(r.status));

    const rows: SaleLedgerRow[] = liveSales
      .map((r) => {
        const kind = resolveKind(r, itemById, itemByName);
        if (kind !== "product" && kind !== "raw") return null;
        const rate = rates.get(num(r.currency_id)) ?? 1;
        const qty = num(r.quantity);
        const price = num(r.unit_price) * rate;
        return {
          id: num(r.id),
          occurredOn: text(r.occurred_on),
          invoiceNo: invoiceOf("فروش", num(r.id), r.invoice_no),
          itemKind: kind,
          itemKindLabel: itemKindLabel(kind),
          itemName: text(r.item_name),
          quantity: qty,
          unitPriceBase: price,
          totalBase: qty * price,
        };
      })
      .filter((r): r is SaleLedgerRow => r != null);

    let summary: ModelSummary | null = null;
    if (data.itemId) {
      const item = itemById.get(data.itemId);
      if (item && itemKindOf(item.kind) === "product") {
        const name = text(item.name);
        const modelSales = liveSales.filter(
          (r) => num(r.item_id) === data.itemId || text(r.item_name) === name,
        );
        const qtySold = modelSales.reduce((s, r) => s + num(r.quantity), 0);
        const amountSold = modelSales.reduce((s, r) => {
          const rate = rates.get(num(r.currency_id)) ?? 1;
          return s + num(r.quantity) * num(r.unit_price) * rate;
        }, 0);
        const inv = await loadInventoryState(sql, context.userId);
        const card =
          inv.products.find((p) => p.itemId === data.itemId) ??
          inv.products.find((p) => p.name === name);
        summary = {
          itemId: data.itemId,
          itemName: name,
          qtySold,
          amountSold,
          stockQty: card?.qty ?? 0,
          unitCost: card?.unitCost ?? 0,
        };
      }
    }

    return { models, summary, rows };
  });

function cashPartyOptionId(accountId: number) {
  return -accountId;
}

function accountIdFromCashOption(selectId: number | null | undefined): number | null {
  if (selectId == null || selectId >= 0) return null;
  return -selectId;
}

async function loadCashPartyPaymentRows(
  sql: Sql,
  userId: string,
  kind: "receipt" | "payment",
): Promise<PartyPayment[]> {
  const rows = await sql<Record<string, unknown>>`
    select t.*, a1.name as from_name, a2.name as to_name,
      a1.kind as from_kind, a2.kind as to_kind,
      a1.currency_id as from_cur, a2.currency_id as to_cur,
      c.symbol as currency_symbol, c.rate_to_base
    from transfers t
    join accounts a1 on a1.id = t.from_account_id
    join accounts a2 on a2.id = t.to_account_id
    join currencies c on c.id = a1.currency_id
    where t.user_id = ${userId}
    order by t.occurred_on desc, t.id desc
  `;
  const out: PartyPayment[] = [];
  for (const r of rows) {
    const fromKind = text(r.from_kind);
    const toKind = text(r.to_kind);
    const fromIsCash = fromKind === "counterparty";
    const toIsCash = toKind === "counterparty";
    if (fromIsCash === toIsCash) continue;
    const isReceipt = fromIsCash;
    if ((kind === "receipt") !== isReceipt) continue;
    const amount = num(r.amount);
    const fxRate = num(r.rate_to_base) || 1;
    const cashId = isReceipt ? num(r.from_account_id) : num(r.to_account_id);
    const tillId = isReceipt ? num(r.to_account_id) : num(r.from_account_id);
    const cashName = isReceipt ? text(r.from_name) : text(r.to_name);
    const tillName = isReceipt ? text(r.to_name) : text(r.from_name);
    out.push({
      id: -num(r.id),
      partyId: cashPartyOptionId(cashId),
      partyName: cashName,
      partyKind: "",
      categoryName: "نقدی",
      kind,
      amount,
      amountBase: amount * fxRate,
      currencyId: num(r.from_cur),
      currencySymbol: text(r.currency_symbol) || "؋",
      fxRate,
      accountId: tillId,
      accountName: tillName,
      receiptNo: "انتقال",
      occurredOn: text(r.occurred_on),
      notes: text(r.notes),
    });
  }
  return out;
}

function cashLedgerInvoice(
  id: number,
  occurredOn: string,
  invoiceNo: string,
  itemName: string,
  totalBase: number,
): SaleLedgerRow {
  return {
    id,
    occurredOn,
    invoiceNo,
    itemKind: "product",
    itemKindLabel: "نقدی",
    itemName,
    quantity: 1,
    unitPriceBase: totalBase,
    totalBase,
  };
}

async function loadCashPartyStatement(
  sql: Sql,
  userId: string,
  kind: "customer" | "vendor",
  accountId: number,
  from: string | null | undefined,
  to: string | null | undefined,
  parties: { id: number; name: string }[],
  summaries: PartySummary[],
) {
  const catalogs = await loadCatalogs(sql, userId);
  const acc = catalogs.accounts.find((a) => a.id === accountId && a.kind === "counterparty");
  if (!acc) {
    return {
      parties,
      summaries,
      invoices: [] as SaleLedgerRow[],
      payments: [] as PartyPayment[],
      invoiced: 0,
      paid: 0,
      remaining: 0,
      partyName: "",
      expenseDebts: [] as ExpenseDebt[],
    };
  }
  const rateOf = (currencyId: number) => catalogs.currencies.find((c) => c.id === currencyId)?.rateToBase || 1;
  const accRate = rateOf(acc.currencyId);
  const recv = kind === "customer";

  const [transferRows, openingRows] = await Promise.all([
    sql<Record<string, unknown>>`
      select t.*, a1.name as from_name, a2.name as to_name, a1.currency_id as from_cur
      from transfers t
      join accounts a1 on a1.id = t.from_account_id
      join accounts a2 on a2.id = t.to_account_id
      where t.user_id = ${userId} and (t.from_account_id = ${accountId} or t.to_account_id = ${accountId})
      order by t.occurred_on desc, t.id desc
    `,
    sql<Record<string, unknown>>`
      select o.*, c.symbol as currency_symbol, c.rate_to_base
      from opening_cash o
      join currencies c on c.id = o.currency_id
      where o.user_id = ${userId} and o.account_id = ${accountId}
      order by o.occurred_on desc, o.id desc
    `,
  ]);

  const invoices: SaleLedgerRow[] = [];
  const payments: PartyPayment[] = [];

  const pushPay = (row: Omit<PartyPayment, "partyId" | "partyName" | "partyKind" | "categoryName" | "kind">) => {
    payments.push({
      partyId: cashPartyOptionId(accountId),
      partyName: acc.name,
      partyKind: "",
      categoryName: "",
      kind: recv ? "receipt" : "payment",
      ...row,
    });
  };

  if (Math.abs(acc.openingBalance) > 1e-9 && inRange("", from, to)) {
    const openBase = Math.abs(acc.openingBalance) * accRate;
    const asInvoice = recv ? acc.openingBalance > 0 : acc.openingBalance < 0;
    if (asInvoice) {
      invoices.push(cashLedgerInvoice(0, "", "موجودی اولیه", recv ? "طلب اولیه" : "بدهی اولیه", openBase));
    } else {
      pushPay({
        id: 0,
        amount: Math.abs(acc.openingBalance),
        amountBase: openBase,
        currencyId: acc.currencyId,
        currencySymbol: acc.currencySymbol,
        fxRate: accRate,
        accountId: acc.id,
        accountName: acc.name,
        receiptNo: "موجودی اولیه",
        occurredOn: "",
        notes: "",
      });
    }
  }

  for (const r of openingRows) {
    if (!inRange(text(r.occurred_on), from, to)) continue;
    const amt = num(r.amount);
    if (Math.abs(amt) <= 1e-9) continue;
    const rrate = num(r.rate_to_base) || 1;
    const base = Math.abs(amt) * rrate;
    const asInvoice = recv ? amt > 0 : amt < 0;
    if (asInvoice) {
      invoices.push(
        cashLedgerInvoice(1_000_000 + num(r.id), text(r.occurred_on), "تعدیل", text(r.notes) || "تعدیل موجودی", base),
      );
    } else {
      pushPay({
        id: -num(r.id),
        amount: Math.abs(amt),
        amountBase: base,
        currencyId: num(r.currency_id),
        currencySymbol: text(r.currency_symbol) || acc.currencySymbol,
        fxRate: rrate,
        accountId: acc.id,
        accountName: acc.name,
        receiptNo: "تعدیل",
        occurredOn: text(r.occurred_on),
        notes: text(r.notes),
      });
    }
  }

  for (const t of transferRows) {
    if (!inRange(text(t.occurred_on), from, to)) continue;
    const amt = num(t.amount);
    if (amt <= 1e-9) continue;
    const fromCur = num(t.from_cur);
    const base = amt * rateOf(fromCur);
    const incoming = num(t.to_account_id) === accountId;
    const asInvoice = recv ? incoming : !incoming;
    const otherName = incoming ? text(t.from_name) : text(t.to_name);
    if (asInvoice) {
      invoices.push(cashLedgerInvoice(2_000_000 + num(t.id), text(t.occurred_on), "انتقال", otherName, base));
    } else {
      pushPay({
        id: num(t.id),
        amount: amt,
        amountBase: base,
        currencyId: fromCur,
        currencySymbol: catalogs.currencies.find((c) => c.id === fromCur)?.symbol || acc.currencySymbol,
        fxRate: rateOf(fromCur),
        accountId: incoming ? num(t.from_account_id) : num(t.to_account_id),
        accountName: otherName,
        receiptNo: "انتقال",
        occurredOn: text(t.occurred_on),
        notes: text(t.notes),
      });
    }
  }

  const invoiced = invoices.reduce((s, r) => s + r.totalBase, 0);
  const paid = payments.reduce((s, p) => s + p.amountBase, 0);
  return {
    parties,
    summaries,
    invoices,
    payments,
    invoiced,
    paid,
    remaining: invoiced - paid,
    partyName: `${acc.name} (نقدی)`,
    expenseDebts: kind === "vendor" ? await loadExpenseDebts(sql, userId, from, to) : ([] as ExpenseDebt[]),
  };
}

export const getPartyStatement = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { kind: "customer" | "vendor"; partyId?: number | null; from?: string | null; to?: string | null }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    const { parties: partyRows, summaries, rates, implied } = await loadPartySummaries(
      sql,
      context.userId,
      data.kind,
      data.from,
      data.to,
    );
    const catalogs = await loadCatalogs(sql, context.userId);
    const cashParties = catalogs.accounts
      .filter((a) => a.kind === "counterparty")
      .map((a) => ({ id: cashPartyOptionId(a.id), name: `${a.name} (نقدی)` }));
    const parties = [...partyRows, ...cashParties];
    const cashAccountId = accountIdFromCashOption(data.partyId);
    if (cashAccountId != null) {
      return loadCashPartyStatement(
        sql,
        context.userId,
        data.kind,
        cashAccountId,
        data.from,
        data.to,
        parties,
        summaries,
      );
    }
    if (!data.partyId) {
      const expenseDebts =
        data.kind === "vendor" ? await loadExpenseDebts(sql, context.userId, data.from, data.to) : [];
      const customerCredit =
        data.kind === "vendor"
          ? (await loadPartySummaries(sql, context.userId, "customer", data.from, data.to)).summaries
              .filter((s) => s.remainingBase < -1e-9)
              .map((s) => ({
                ...s,
                name: `${s.name} (طلب از شرکت)`,
                remainingBase: Math.abs(s.remainingBase),
              }))
          : [];
      const prepaid =
        data.kind === "customer"
          ? (await loadPartySummaries(sql, context.userId, "vendor", data.from, data.to)).summaries
              .filter((s) => s.remainingBase < -1e-9)
              .map((s) => ({
                ...s,
                remainingBase: Math.abs(s.remainingBase),
                prepaid: true as const,
              }))
          : [];
      return {
        parties,
        summaries:
          data.kind === "vendor"
            ? [...summaries.filter((s) => s.remainingBase > 1e-9), ...customerCredit]
            : [...summaries.filter((s) => s.remainingBase > 1e-9), ...prepaid],
        invoices: [] as (SaleLedgerRow | PurchaseLedgerRow)[],
        payments: [] as PartyPayment[],
        invoiced: 0,
        paid: 0,
        remaining: 0,
        partyName: "",
        expenseDebts,
      };
    }

    const items = await sql<Record<string, unknown>>`select id, name, kind from items where user_id = ${context.userId}`;
    const itemById = new Map(items.map((i) => [num(i.id), i]));
    const itemByName = new Map(items.map((i) => [text(i.name), i]));
    const party = parties.find((p) => p.id === data.partyId);
    const partyName = party?.name ?? "";

    const payRows = await sql<Record<string, unknown>>`
      select p.*, c.symbol as currency_symbol, c.rate_to_base, a.name as account_name, pt.name as party_name
      from party_payments p
      join currencies c on c.id = p.currency_id
      left join accounts a on a.id = p.account_id
      join parties pt on pt.id = p.party_id
      where p.user_id = ${context.userId} and p.party_id = ${data.partyId}
      order by p.occurred_on desc, p.id desc
    `;
    const saleLink = new Map<number, number>();
    const appliedCash = new Set<number>();
    const payments: PartyPayment[] = payRows.map((r) => {
      const currencyId = num(r.currency_id);
      const amount = num(r.amount);
      const fxRate = paymentRate(r, implied, num(r.party_id), rates);
      const id = num(r.id);
      if (r.sale_invoice_id != null) saleLink.set(id, num(r.sale_invoice_id));
      if (r.applied_sale_id != null) appliedCash.add(id);
      return {
        id,
        partyId: num(r.party_id),
        partyName: text(r.party_name),
        partyKind: "",
        categoryName: "",
        kind: text(r.kind) === "payment" ? "payment" : "receipt",
        amount,
        amountBase: amount * fxRate,
        currencyId,
        currencySymbol: text(r.currency_symbol) || "؋",
        fxRate,
        accountId: r.account_id == null ? null : num(r.account_id),
        accountName: text(r.account_name),
        receiptNo: text(r.receipt_no),
        occurredOn: text(r.occurred_on),
        notes: text(r.notes),
      };
    });

    if (data.kind === "customer") {
      const sales = await sql<Record<string, unknown>>`
        select s.*, i.kind as item_kind, inv.fx_enabled, inv.fx_rate, inv.currency_id as inv_currency_id
        from sales s
        left join items i on i.id = s.item_id
        left join sale_invoices inv on inv.id = s.invoice_id
        where s.user_id = ${context.userId} and s.customer_id = ${data.partyId}
        order by s.occurred_on desc, s.id desc
      `;
      const invoices: SaleLedgerRow[] = sales.filter((r) => isFinalStatus(r.status)).map((r) => {
        const kind = resolveKind(r, itemById, itemByName);
        const rate = invRate(r, rates);
        const qty = num(r.quantity);
        const price = num(r.unit_price) * rate;
        return {
          id: num(r.id),
          occurredOn: text(r.occurred_on),
          invoiceNo: invoiceOf("فروش", num(r.id), r.invoice_no),
          itemKind: kind,
          itemKindLabel: itemKindLabel(kind),
          itemName: text(r.item_name),
          quantity: qty,
          unitPriceBase: price,
          totalBase: qty * price,
        };
      });
      for (const p of payments) {
        if (p.kind !== "payment" || saleLink.has(p.id) || appliedCash.has(p.id)) continue;
        invoices.push({
          id: -p.id,
          occurredOn: p.occurredOn,
          invoiceNo: p.receiptNo || "بردگی نقدی",
          itemKind: "raw",
          itemKindLabel: "بردگی نقدی",
          itemName: p.notes.trim() || "بردگی نقدی",
          quantity: 1,
          unitPriceBase: p.amountBase,
          totalBase: p.amountBase,
        });
      }
      const invoiced = invoices.reduce((s, r) => s + r.totalBase, 0);
      const settledByInvoice = new Map<number, number>();
      const heads = await sql<Record<string, unknown>>`
        select i.id, i.fx_enabled, i.fx_rate, i.currency_id, i.received_amount, i.received_fx_rate,
          i.refund_amount, i.cash_included_base, coalesce(sum(s.quantity * s.unit_price), 0) as goods
        from sale_invoices i
        left join sales s on s.invoice_id = i.id and s.user_id = i.user_id
        where i.user_id = ${context.userId} and i.customer_id = ${data.partyId}
        group by i.id
      `;
      for (const h of heads) {
        if (num(h.refund_amount) <= 1e-9) continue;
        const rate = invRate(h, rates);
        const invoiceBase = num(h.goods) * rate + num(h.cash_included_base);
        const recvRate = num(h.received_fx_rate) > 0 ? num(h.received_fx_rate) : rate;
        const receivedBase = num(h.received_amount) * recvRate;
        settledByInvoice.set(num(h.id), Math.min(invoiceBase, Math.max(0, receivedBase - num(h.refund_amount))));
      }
      const shown = payments
        .filter((p) => p.kind === "receipt")
        .map((p) => {
          const invoiceId = saleLink.get(p.id);
          const settled = invoiceId == null ? undefined : settledByInvoice.get(invoiceId);
          if (settled == null) return p;
          return { ...p, amount: settled, amountBase: settled, currencySymbol: "؋", fxRate: 1 };
        });
      const paid = shown.reduce((s, p) => s + p.amountBase, 0);
      return {
        parties,
        summaries,
        invoices,
        payments: shown,
        invoiced,
        paid,
        remaining: invoiced - paid,
        partyName,
        expenseDebts: [] as ExpenseDebt[],
      };
    }

    const purchases = await sql<Record<string, unknown>>`
      select p.*, i.kind as item_kind, inv.fx_enabled, inv.fx_rate, inv.currency_id as inv_currency_id
      from purchases p
      left join items i on i.id = p.item_id
      left join purchase_invoices inv on inv.id = p.invoice_id
      where p.user_id = ${context.userId} and p.vendor_id = ${data.partyId}
      order by p.occurred_on desc, p.id desc
    `;
    const invoices: PurchaseLedgerRow[] = purchases.filter((r) => isFinalStatus(r.status)).map((r) => {
      const kind = resolveKind(r, itemById, itemByName);
      const rate = invRate(r, rates);
      const qty = num(r.quantity);
      const price = num(r.unit_price) * rate;
      return {
        id: num(r.id),
        occurredOn: text(r.occurred_on),
        invoiceNo: invoiceOf("خرید", num(r.id), r.invoice_no),
        itemKind: kind,
        itemKindLabel: itemKindLabel(kind),
        itemName: text(r.item_name),
        quantity: qty,
        unitPriceBase: price,
        totalBase: qty * price,
      };
    });
    const invoiced = invoices.reduce((s, r) => s + r.totalBase, 0);
    const paid = payments.reduce(
      (s, p) => s + signedPaidBase("vendor", p.kind, p.amountBase),
      0,
    );
    return {
      parties,
      summaries,
      invoices,
      payments: payments.filter((p) => p.kind === "payment"),
      invoiced,
      paid,
      remaining: invoiced - paid,
      partyName,
      expenseDebts: await loadExpenseDebts(sql, context.userId),
    };
  });

export const listOutstandingParties = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { side: "debtor" | "creditor" }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    const kind = data.side === "debtor" ? "customer" : "vendor";
    const { summaries } = await loadPartySummaries(sql, context.userId, kind);
    if (data.side === "creditor") return summaries.filter((s) => s.remainingBase > 1e-9);
    const vendors = await loadPartySummaries(sql, context.userId, "vendor");
    const prepaid = vendors.summaries
      .filter((s) => s.remainingBase < -1e-9)
      .map((s) => ({ ...s, remainingBase: Math.abs(s.remainingBase), prepaid: true as const }));
    return [...summaries.filter((s) => s.remainingBase > 1e-9), ...prepaid];
  });

export const savePartyPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      partyId: number;
      kind: "receipt" | "payment";
      amount: number;
      currencyId: number;
      fxRate?: number;
      accountId: number | null;
      occurredOn: string;
      notes: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "payments");
    if (data.amount <= 0) throw new Error("مبلغ باید بزرگ‌تر از صفر باشد");
    const catalogs = await loadCatalogs(sql, context.userId);
    const storedRate = data.fxRate && data.fxRate > 1e-12
      ? data.fxRate
      : catalogs.currencies.find((c) => c.id === data.currencyId)?.rateToBase || 1;
    const cashAccountId = accountIdFromCashOption(data.partyId);
    if (cashAccountId != null) {
      if (!data.accountId || data.accountId === cashAccountId) throw new Error("حساب دخل را انتخاب کنید");
      const fromId = data.kind === "receipt" ? cashAccountId : data.accountId;
      const toId = data.kind === "receipt" ? data.accountId : cashAccountId;
      const fromAcc = catalogs.accounts.find((a) => a.id === fromId);
      const fromRate = catalogs.currencies.find((c) => c.id === fromAcc?.currencyId)?.rateToBase || 1;
      const xferAmount = convertAmount(data.amount, storedRate, fromRate);
      const transferId = data.id != null && data.id < 0 ? -data.id : 0;
      let creditBack = 0;
      if (transferId) {
        const old = await sql<{ from_account_id: number; amount: unknown }>`
          select from_account_id, amount from transfers where id = ${transferId} and user_id = ${context.userId}
        `;
        if (old[0] && num(old[0].from_account_id) === fromId) creditBack = num(old[0].amount);
      }
      await assertCashAvailable(sql, context.userId, {
        accountId: fromId,
        amount: xferAmount,
        amountRate: fromRate,
        creditBack,
      });
      if (transferId) {
        await sql`
          update transfers
          set from_account_id = ${fromId}, to_account_id = ${toId},
              amount = ${xferAmount}, occurred_on = ${data.occurredOn}, notes = ${data.notes}
          where id = ${transferId} and user_id = ${context.userId}
        `;
        return { id: -transferId };
      }
      const rows = await sql<{ id: number }>`
        insert into transfers (user_id, from_account_id, to_account_id, amount, occurred_on, notes)
        values (${context.userId}, ${fromId}, ${toId}, ${xferAmount}, ${data.occurredOn}, ${data.notes})
        returning id
      `;
      return { id: -rows[0].id };
    }
    if (data.kind === "payment") {
      let creditBack = 0;
      if (data.id) {
        const old = await sql<{ account_id: number | null; amount: unknown; currency_id: number; kind: string; fx_rate: unknown }>`
          select account_id, amount, currency_id, kind, fx_rate from party_payments
          where id = ${data.id} and user_id = ${context.userId}
        `;
        if (old[0] && old[0].kind === "payment" && old[0].account_id != null && data.accountId === num(old[0].account_id)) {
          const acc = catalogs.accounts.find((a) => a.id === data.accountId);
          const accRate = catalogs.currencies.find((c) => c.id === acc?.currencyId)?.rateToBase || 1;
          const oldRate =
            num(old[0].fx_rate) > 1e-12
              ? num(old[0].fx_rate)
              : catalogs.currencies.find((c) => c.id === num(old[0].currency_id))?.rateToBase || 1;
          creditBack = convertAmount(num(old[0].amount), oldRate, accRate);
        }
      }
      await assertCashAvailable(sql, context.userId, {
        accountId: data.accountId,
        amount: data.amount,
        amountRate: storedRate,
        creditBack,
      });
    }
    if (data.id) {
      await sql`
        update party_payments set
          party_id = ${data.partyId}, kind = ${data.kind}, amount = ${data.amount},
          currency_id = ${data.currencyId}, fx_rate = ${storedRate}, account_id = ${data.accountId},
          occurred_on = ${data.occurredOn}, notes = ${data.notes}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into party_payments (
        user_id, party_id, kind, amount, currency_id, fx_rate, account_id, receipt_no, occurred_on, notes
      ) values (
        ${context.userId}, ${data.partyId}, ${data.kind}, ${data.amount}, ${data.currencyId}, ${storedRate}, ${data.accountId},
        ${"موقت"}, ${data.occurredOn}, ${data.notes}
      ) returning id
    `;
    const id = rows[0].id;
    const receipt = `ق-${id}`;
    await sql`update party_payments set receipt_no = ${receipt} where id = ${id} and user_id = ${context.userId}`;
    return { id };
  });

export const deletePartyPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    if (data.id < 0) {
      const { sql } = await guard(context.userId, "payments");
      await sql`delete from transfers where id = ${-data.id} and user_id = ${context.userId}`;
      return { ok: true as const };
    }
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    const row = await sql<{ kind: string }>`
      select kind from party_payments where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!row[0]) throw new Error("یافت نشد");
    await guard(context.userId, "payments");
    await sql`delete from party_payments where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listPartyPayments = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { kind: "receipt" | "payment" }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    const [cust, vend] = await Promise.all([
      loadPartySummaries(sql, context.userId, "customer"),
      loadPartySummaries(sql, context.userId, "vendor"),
    ]);
    const rates = cust.rates;
    const implied: ImpliedFx = new Map([...cust.implied, ...vend.implied]);
    const rows = await sql<Record<string, unknown>>`
      select p.*, c.symbol as currency_symbol, c.rate_to_base, a.name as account_name, pt.name as party_name,
        pt.kind as party_kind, pc.name as category_name
      from party_payments p
      join currencies c on c.id = p.currency_id
      left join accounts a on a.id = p.account_id
      join parties pt on pt.id = p.party_id
      left join party_categories pc on pc.id = pt.category_id
      where p.user_id = ${context.userId} and p.kind = ${data.kind}
        and p.purchase_invoice_id is null and p.sale_invoice_id is null
      order by p.occurred_on desc, p.id desc
    `;
    return rows.map((r) => {
      const currencyId = num(r.currency_id);
      const amount = num(r.amount);
      const fxRate = paymentRate(r, implied, num(r.party_id), rates);
      return {
        id: num(r.id),
        partyId: num(r.party_id),
        partyName: text(r.party_name),
        partyKind: text(r.party_kind) as PartyPayment["partyKind"],
        categoryName: text(r.category_name),
        kind: text(r.kind) === "payment" ? ("payment" as const) : ("receipt" as const),
        amount,
        amountBase: amount * fxRate,
        currencyId,
        currencySymbol: text(r.currency_symbol) || "؋",
        fxRate,
        accountId: r.account_id == null ? null : num(r.account_id),
        accountName: text(r.account_name),
        receiptNo: text(r.receipt_no),
        occurredOn: text(r.occurred_on),
        notes: text(r.notes),
      };
    }).concat(await loadCashPartyPaymentRows(sql, context.userId, data.kind))
      .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || Math.abs(b.id) - Math.abs(a.id));
  });

export const getPartyBalance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { partyId: number }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    const cashAccountId = accountIdFromCashOption(data.partyId);
    if (cashAccountId != null) {
      const catalogs = await loadCatalogs(sql, context.userId);
      const acc = catalogs.accounts.find((a) => a.id === cashAccountId && a.kind === "counterparty");
      if (!acc) throw new Error("طرف حساب یافت نشد");
      const rate = catalogs.currencies.find((c) => c.id === acc.currencyId)?.rateToBase || 1;
      const remaining = acc.balance * rate;
      return {
        partyName: `${acc.name} (نقدی)`,
        invoicedBase: Math.abs(remaining),
        paidBase: 0,
        remainingBase: remaining,
        byCurrency: [
          {
            symbol: acc.currencySymbol,
            invoiced: acc.balance,
            paid: 0,
            remaining: acc.balance,
            rate,
          },
        ],
      };
    }
    const party = await sql<{ id: number; name: string; kind: string }>`
      select id, name, kind from parties where id = ${data.partyId} and user_id = ${context.userId}
    `;
    if (!party[0]) throw new Error("طرف حساب یافت نشد");
    const currencies = await sql<{ id: number; symbol: string }>`
      select id, symbol from currencies where user_id = ${context.userId}
    `;
    const isCustomer = party[0].kind === "customer";
    const kind = isCustomer ? "customer" : "vendor";
    const { summaries, implied, rates } = await loadPartySummaries(sql, context.userId, kind);
    const summary = summaries.find((s) => s.id === data.partyId);
    const byCurrency = new Map<string, { invoiced: number; paid: number; currencyId: number }>();
    const bump = (symbol: string, currencyId: number, field: "invoiced" | "paid", amt: number) => {
      const cur = byCurrency.get(symbol) ?? { invoiced: 0, paid: 0, currencyId };
      cur[field] += amt;
      cur.currencyId = currencyId;
      byCurrency.set(symbol, cur);
    };
    if (isCustomer) {
      const headers = await sql<Record<string, unknown>>`
        select * from sale_invoices where user_id = ${context.userId} and customer_id = ${data.partyId}
      `;
      const lines = await sql<Record<string, unknown>>`
        select * from sales where user_id = ${context.userId} and customer_id = ${data.partyId}
      `;
      for (const h of headers) {
        const ls = lines.filter((l) => num(l.invoice_id) === num(h.id));
        const total = ls.reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0);
        const cid = num(h.currency_id);
        const sym = currencies.find((c) => c.id === cid)?.symbol || "؋";
        bump(sym, cid, "invoiced", total);
      }
    } else {
      const headers = await sql<Record<string, unknown>>`
        select * from purchase_invoices where user_id = ${context.userId} and vendor_id = ${data.partyId}
      `;
      const lines = await sql<Record<string, unknown>>`
        select * from purchases where user_id = ${context.userId} and vendor_id = ${data.partyId}
      `;
      for (const h of headers) {
        const ls = lines.filter((l) => num(l.invoice_id) === num(h.id));
        const total = ls.reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0);
        const cid = num(h.currency_id);
        const sym = currencies.find((c) => c.id === cid)?.symbol || "؋";
        bump(sym, cid, "invoiced", total);
      }
    }
    const pays = await sql<Record<string, unknown>>`
      select * from party_payments where user_id = ${context.userId} and party_id = ${data.partyId}
    `;
    for (const p of pays) {
      const cid = num(p.currency_id);
      const sym = currencies.find((c) => c.id === cid)?.symbol || "؋";
      const signed = signedPaidBase(kind, text(p.kind), num(p.amount));
      bump(sym, cid, "paid", signed);
    }
    return {
      partyName: party[0].name,
      invoicedBase: summary?.invoicedBase ?? 0,
      paidBase: summary?.paidBase ?? 0,
      remainingBase: summary?.remainingBase ?? 0,
      byCurrency: [...byCurrency.entries()].map(([symbol, v]) => ({
        symbol,
        invoiced: v.invoiced,
        paid: v.paid,
        remaining: v.invoiced - v.paid,
        rate: settleRate(implied, data.partyId, v.currencyId, rates),
      })),
    };
  });

function resolveKind(
  row: Record<string, unknown>,
  byId: Map<number, Record<string, unknown>>,
  byName: Map<string, Record<string, unknown>>,
): Item["kind"] {
  if (row.item_id != null) {
    const item = byId.get(num(row.item_id));
    if (item) return itemKindOf(item.kind);
  }
  const named = byName.get(text(row.item_name));
  if (named) return itemKindOf(named.kind);
  return itemKindOf(row.item_kind);
}

export type ActivityLogRow = {
  id: number;
  area: string;
  areaLabel: string;
  action: string;
  title: string;
  detail: string;
  occurredAt: string;
};

const KIND_FA: Record<string, string> = {
  receipt: "دریافت",
  payment: "پرداخت",
  add: "افزودن",
  withdraw: "برداشت",
  cash: "دخل",
  counterparty: "طرف حساب نقدی",
  customer: "مشتری",
  vendor: "فروشنده",
  worker: "کارگر",
  other: "سایر",
  product: "کالای تولید شده",
  raw: "مواد خام",
  contract: "کانتراتی",
  salaried: "ثابت",
  monthly: "ماهانه",
  weekly: "هفتگی",
  yearly: "سالانه",
  start: "اول دوره",
  end: "آخر دوره",
  arrived: "رسیده",
  pending: "در انتظار",
};

function faActivityDetail(detail: string): string {
  if (!detail) return "";
  const keys = Object.keys(KIND_FA).sort((a, b) => b.length - a.length);
  let out = detail;
  for (const k of keys) {
    out = out.replace(new RegExp(`(^|[·\\s,])${k}(?=$|[·\\s,])`, "gi"), (_, p: string) => `${p}${KIND_FA[k]}`);
  }
  return out;
}

const AREA_LABEL: Record<string, string> = {
  sale_invoices: "فروش",
  purchase_invoices: "خرید",
  expenses: "هزینه",
  recurring_expenses: "هزینه تکراری",
  party_payments: "دریافت و پرداخت",
  worker_payments: "پرداخت کارگر",
  transfers: "انتقال",
  capital_moves: "سرمایه",
  opening_cash: "تعدیل دخل",
  opening_stock: "تعدیل موجودی",
  work_orders: "سفارش تولید",
  work_deliveries: "تحویل تولید",
  items: "کالا و مواد خام",
  parties: "طرف‌حساب",
  accounts: "حساب",
};

export const listActivityLog = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ActivityLogRow[]> => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    const rows = await sql<Record<string, unknown>>`
      select id, area, action, title, detail, occurred_at
      from activity_log
      where user_id = ${context.userId}
      order by occurred_at desc, id desc
    `;
    return rows.map((r) => {
      const area = text(r.area);
      return {
        id: num(r.id),
        area,
        areaLabel: AREA_LABEL[area] || area,
        action: text(r.action),
        title: text(r.title),
        detail: faActivityDetail(text(r.detail)),
        occurredAt: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : text(r.occurred_at),
      };
    });
  });

export const deleteActivityLog = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "reports");
    await sql`delete from activity_log where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const resetActivityLog = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { code: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "reports");
    const codes = await getRoleCodes(sql, context.userId);
    if (codes.accountant !== data.code.trim()) throw new Error("کد نقش حسابدار نادرست است");
    await sql`delete from activity_log where user_id = ${context.userId}`;
    return { ok: true as const };
  });

