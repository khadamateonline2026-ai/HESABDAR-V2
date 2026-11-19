/**
 * «روزنامچه دخل»: every amount that came into or left each account (cash box)
 * for one day or a date range, plus non-cash items for information only.
 *
 * Read-only. Uses exactly the same sources and frozen-rate conversion as
 * `withBalances` (helpers.ts) — which is NOT modified — so for every account
 * opening + in − out of the whole history equals the balance shown in حساب‌ها.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { convertAmount, num, text } from "@/lib/format";
import type { Sql } from "@/lib/db";
import { requireProfile, sqlOf } from "./helpers";
import { validInput } from "./validate";

export type CashGroup =
  | "opening"
  | "capital_in"
  | "capital_out"
  | "sale_receipt"
  | "sale_refund"
  | "receipt"
  | "purchase_payment"
  | "payment"
  | "expense"
  | "worker"
  | "transfer";

export const CASH_GROUP_LABEL: Record<CashGroup, string> = {
  opening: "موجودی اولیه نقد",
  capital_in: "افزایش سرمایه",
  capital_out: "برداشت سرمایه",
  sale_receipt: "دریافت فاکتور فروش",
  sale_refund: "پرداخت باقی‌مانده فروش",
  receipt: "دریافتی‌ها (طلبات)",
  purchase_payment: "پرداخت فاکتور خرید",
  payment: "پرداختی به طرف حساب",
  expense: "هزینه‌ها",
  worker: "پرداخت کارگران",
  transfer: "انتقالات",
};

const GROUP_ORDER: CashGroup[] = [
  "opening",
  "capital_in",
  "sale_receipt",
  "receipt",
  "transfer",
  "capital_out",
  "sale_refund",
  "purchase_payment",
  "payment",
  "expense",
  "worker",
];

export type CashMovement = {
  key: string;
  date: string;
  group: CashGroup;
  typeLabel: string;
  description: string;
  party: string;
  docNo: string;
  accountId: number;
  accountName: string;
  currencySymbol: string;
  /** In the account's own currency. */
  amountIn: number;
  amountOut: number;
  /** Base currency at the rate frozen on the record. */
  baseIn: number;
  baseOut: number;
  /** Original amount/currency when it was entered in another currency (else null). */
  originalAmount: number | null;
  originalSymbol: string;
  /** Running balance of the account (only filled when one account is selected). */
  running: number | null;
};

export type CashAccountSummary = {
  accountId: number;
  name: string;
  kind: string;
  currencyId: number;
  currencySymbol: string;
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  baseIn: number;
  baseOut: number;
  /** Opening / closing converted at today's rate of the account currency. */
  openingBaseNow: number;
  closingBaseNow: number;
};

export type NonCashRow = {
  key: string;
  date: string;
  kind: "credit_sale" | "credit_purchase" | "debt_expense";
  label: string;
  party: string;
  docNo: string;
  amountBase: number;
};

export type CashbookData = {
  from: string;
  to: string;
  accounts: CashAccountSummary[];
  movements: CashMovement[];
  groups: { group: CashGroup; label: string; baseIn: number; baseOut: number; count: number }[];
  totals: { baseIn: number; baseOut: number; openingBaseNow: number; closingBaseNow: number };
  nonCash: NonCashRow[];
};

type Raw = Omit<CashMovement, "running" | "accountName" | "currencySymbol"> & { rank: number; id: number };

const PAYMENT_RANK: Partial<Record<CashGroup, number>> = {
  sale_receipt: 2,
  receipt: 3,
  sale_refund: 6,
  purchase_payment: 7,
  payment: 8,
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** All movements of every account (whole history) with withBalances' conversion. */
async function loadAllMovements(sql: Sql, userId: string) {
  const [currencies, accountRows, transfers, capital, openingCash, expenses, payments, workerPays] = await Promise.all([
    sql<{ id: number; symbol: string; rate_to_base: unknown }>`
      select id, symbol, rate_to_base from currencies where user_id = ${userId} order by id
    `,
    sql<Record<string, unknown>>`
      select a.*, c.symbol as currency_symbol, c.rate_to_base
      from accounts a
      join currencies c on c.id = a.currency_id and c.user_id = a.user_id
      where a.user_id = ${userId}
      order by a.id
    `,
    sql<Record<string, unknown>>`
      select t.id, t.from_account_id, t.to_account_id, t.amount, t.from_rate, t.to_rate, t.occurred_on, t.notes
      from transfers t where t.user_id = ${userId}
    `,
    sql<Record<string, unknown>>`
      select id, account_id, kind, amount, currency_id, fx_rate, account_rate, occurred_on, notes
      from capital_moves where user_id = ${userId}
    `,
    sql<Record<string, unknown>>`
      select id, account_id, amount, currency_id, fx_rate, account_rate, occurred_on, notes
      from opening_cash where user_id = ${userId}
    `,
    sql<Record<string, unknown>>`
      select e.id, e.account_id, e.amount, e.currency_id, e.as_debt, e.fx_rate, e.account_rate, e.occurred_on,
        e.title, e.notes, ec.name as category_name, p.name as party_name
      from expenses e
      left join expense_categories ec on ec.id = e.category_id and ec.user_id = e.user_id
      left join parties p on p.id = e.party_id and p.user_id = e.user_id
      where e.user_id = ${userId}
    `,
    sql<Record<string, unknown>>`
      select pp.id, pp.account_id, pp.kind, pp.amount, pp.currency_id, pp.account_rate, pp.occurred_on,
        pp.receipt_no, pp.notes, pp.sale_invoice_id, pp.purchase_invoice_id,
        pt.name as party_name, si.invoice_no as sale_no, pi.invoice_no as purchase_no,
        coalesce(
          nullif(pp.fx_rate, 0),
          nullif(pi.fx_rate, 0),
          nullif(si.fx_rate, 0),
          c.rate_to_base,
          1
        ) as from_rate
      from party_payments pp
      left join purchase_invoices pi on pi.id = pp.purchase_invoice_id and pi.user_id = pp.user_id
      left join sale_invoices si on si.id = pp.sale_invoice_id and si.user_id = pp.user_id
      left join currencies c on c.id = pp.currency_id and c.user_id = pp.user_id
      left join parties pt on pt.id = pp.party_id and pt.user_id = pp.user_id
      where pp.user_id = ${userId}
    `,
    sql<Record<string, unknown>>`
      select wp.id, wp.account_id, wp.amount, wp.currency_id, wp.account_rate, wp.occurred_on, wp.notes,
        wp.invoice_no, w.name as worker_name,
        case when wp.currency_id is null then 1 else coalesce(nullif(wp.fx_rate, 0), wc.rate_to_base, 1) end as from_rate
      from worker_payments wp
      left join currencies wc on wc.id = wp.currency_id and wc.user_id = wp.user_id
      left join parties w on w.id = wp.worker_id and w.user_id = wp.user_id
      where wp.user_id = ${userId}
    `,
  ]);

  const rateOf = (currencyId: number) => num(currencies.find((c) => num(c.id) === currencyId)?.rate_to_base) || 1;
  const symbolOf = (currencyId: number) => text(currencies.find((c) => num(c.id) === currencyId)?.symbol) || "؋";
  const frozen = (stored: unknown, fallback: number) => (num(stored) > 0 ? num(stored) : fallback);
  const accCurrency = new Map<number, number>();
  for (const a of accountRows) accCurrency.set(num(a.id), num(a.currency_id));
  const accRateNow = (accountId: number) => rateOf(accCurrency.get(accountId) ?? 0);
  const known = (accountId: unknown) => accountId != null && accCurrency.has(num(accountId));

  const out: Raw[] = [];
  const push = (
    r: Record<string, unknown>,
    prefix: string,
    rank: number,
    accountId: number,
    group: CashGroup,
    signedAccountAmount: number,
    signedBase: number,
    extra: { typeLabel?: string; description?: string; party?: string; docNo?: string; original?: { amount: number; symbol: string } | null },
  ) => {
    out.push({
      key: `${prefix}-${num(r.id)}`,
      id: num(r.id),
      rank,
      date: text(r.occurred_on),
      group,
      typeLabel: extra.typeLabel ?? CASH_GROUP_LABEL[group],
      description: extra.description ?? "",
      party: extra.party ?? "",
      docNo: extra.docNo ?? "",
      accountId,
      amountIn: signedAccountAmount > 0 ? signedAccountAmount : 0,
      amountOut: signedAccountAmount < 0 ? -signedAccountAmount : 0,
      baseIn: signedBase > 0 ? signedBase : 0,
      baseOut: signedBase < 0 ? -signedBase : 0,
      originalAmount: extra.original?.amount ?? null,
      originalSymbol: extra.original?.symbol ?? "",
    });
  };
  const originalOf = (amount: number, currencyId: number, accountId: number) =>
    currencyId && currencyId !== accCurrency.get(accountId) ? { amount, symbol: symbolOf(currencyId) } : null;

  for (const r of openingCash) {
    if (!known(r.account_id)) continue;
    const acc = num(r.account_id);
    const fromRate = frozen(r.fx_rate, rateOf(num(r.currency_id)));
    const amt = num(r.amount);
    push(r, "oc", 0, acc, "opening", convertAmount(amt, fromRate, frozen(r.account_rate, accRateNow(acc))), amt * fromRate, {
      description: text(r.notes),
      original: originalOf(amt, num(r.currency_id), acc),
    });
  }
  for (const r of capital) {
    if (!known(r.account_id)) continue;
    const acc = num(r.account_id);
    const add = text(r.kind) === "add";
    const signed = add ? num(r.amount) : -num(r.amount);
    const fromRate = frozen(r.fx_rate, rateOf(num(r.currency_id)));
    push(
      r,
      "cap",
      add ? 1 : 5,
      acc,
      add ? "capital_in" : "capital_out",
      convertAmount(signed, fromRate, frozen(r.account_rate, accRateNow(acc))),
      signed * fromRate,
      { description: text(r.notes), original: originalOf(num(r.amount), num(r.currency_id), acc) },
    );
  }
  const accName = new Map(accountRows.map((a) => [num(a.id), text(a.name)]));
  for (const t of transfers) {
    const amt = num(t.amount);
    const fromAcc = num(t.from_account_id);
    const toAcc = num(t.to_account_id);
    const fromC = accCurrency.get(fromAcc) ?? 0;
    const toC = accCurrency.get(toAcc) ?? 0;
    const fromRate = fromC ? frozen(t.from_rate, rateOf(fromC)) : 1;
    const base = amt * fromRate;
    const desc = `${accName.get(fromAcc) ?? "—"} ← ${accName.get(toAcc) ?? "—"}`;
    if (known(fromAcc)) {
      push(t, "tro", 4, fromAcc, "transfer", -amt, -base, {
        typeLabel: "انتقال (خروج)",
        description: [desc, text(t.notes)].filter(Boolean).join(" — "),
      });
    }
    if (known(toAcc)) {
      const converted = toC && fromC ? (amt * fromRate) / frozen(t.to_rate, rateOf(toC)) : amt;
      push(t, "tri", 4, toAcc, "transfer", converted, base, {
        typeLabel: "انتقال (ورود)",
        description: [desc, text(t.notes)].filter(Boolean).join(" — "),
      });
    }
  }
  for (const r of expenses) {
    if (!known(r.account_id) || Boolean(r.as_debt)) continue;
    const acc = num(r.account_id);
    const fromRate = frozen(r.fx_rate, rateOf(num(r.currency_id)));
    const amt = num(r.amount);
    push(r, "exp", 9, acc, "expense", -convertAmount(amt, fromRate, frozen(r.account_rate, accRateNow(acc))), -amt * fromRate, {
      description: [text(r.title), text(r.category_name)].filter(Boolean).join(" — "),
      party: text(r.party_name),
      original: originalOf(amt, num(r.currency_id), acc),
    });
  }
  for (const r of payments) {
    if (!known(r.account_id)) continue;
    const acc = num(r.account_id);
    const fromRate = num(r.from_rate) || 1;
    const amt = num(r.amount);
    const receipt = text(r.kind) === "receipt";
    const converted = convertAmount(amt, fromRate, frozen(r.account_rate, accRateNow(acc)));
    const sale = r.sale_invoice_id != null;
    const purchase = r.purchase_invoice_id != null;
    const group: CashGroup = sale
      ? receipt
        ? "sale_receipt"
        : "sale_refund"
      : purchase && !receipt
        ? "purchase_payment"
        : receipt
          ? "receipt"
          : "payment";
    const rank = PAYMENT_RANK[group] ?? 3;
    push(r, "pp", rank, acc, group, receipt ? converted : -converted, (receipt ? 1 : -1) * amt * fromRate, {
      description: text(r.notes),
      party: text(r.party_name) || (purchase || sale ? "نقدی" : ""),
      docNo: text(r.sale_no) || text(r.purchase_no) || text(r.receipt_no),
      original: originalOf(amt, num(r.currency_id), acc),
    });
  }
  for (const r of workerPays) {
    if (!known(r.account_id)) continue;
    const acc = num(r.account_id);
    const fromRate = num(r.from_rate) || 1;
    const amt = num(r.amount);
    push(r, "wp", 10, acc, "worker", -convertAmount(amt, fromRate, frozen(r.account_rate, accRateNow(acc))), -amt * fromRate, {
      description: text(r.notes),
      party: text(r.worker_name),
      docNo: text(r.invoice_no),
      original: r.currency_id == null ? null : originalOf(amt, num(r.currency_id), acc),
    });
  }
  out.sort((a, b) =>
    a.date === b.date ? (a.rank === b.rank ? (a.id === b.id ? a.key.localeCompare(b.key) : a.id - b.id) : a.rank - b.rank) : a.date < b.date ? -1 : 1,
  );
  return { accountRows, movements: out, rateOf };
}

async function loadNonCash(sql: Sql, userId: string, from: string, to: string): Promise<NonCashRow[]> {
  const [sales, purchases, debts, currencies] = await Promise.all([
    sql<Record<string, unknown>>`
      select i.id, i.invoice_no, i.occurred_on, i.fx_enabled, i.fx_rate, i.cash_included_base,
        i.received_amount, i.received_fx_rate, i.refund_amount, p.name as party_name,
        coalesce((select sum(s.quantity * s.unit_price) from sales s where s.invoice_id = i.id and s.user_id = i.user_id), 0) as goods
      from sale_invoices i
      left join parties p on p.id = i.customer_id and p.user_id = i.user_id
      where i.user_id = ${userId} and i.occurred_on between ${from} and ${to}
    `,
    sql<Record<string, unknown>>`
      select i.id, i.invoice_no, i.occurred_on, i.fx_enabled, i.fx_rate, i.paid_amount, p.name as party_name,
        coalesce((select sum(x.quantity * x.unit_price) from purchases x where x.invoice_id = i.id and x.user_id = i.user_id), 0) as goods
      from purchase_invoices i
      left join parties p on p.id = i.vendor_id and p.user_id = i.user_id
      where i.user_id = ${userId} and i.occurred_on between ${from} and ${to}
    `,
    sql<Record<string, unknown>>`
      select e.id, e.title, e.amount, e.currency_id, e.occurred_on, p.name as party_name
      from expenses e
      left join parties p on p.id = e.party_id and p.user_id = e.user_id
      where e.user_id = ${userId} and e.as_debt and e.occurred_on between ${from} and ${to}
    `,
    sql<{ id: number; rate_to_base: unknown }>`select id, rate_to_base from currencies where user_id = ${userId}`,
  ]);
  const rows: NonCashRow[] = [];
  // Same formulas as the sale / purchase invoice lists (remainingBase).
  for (const h of sales) {
    const r = h.fx_enabled ? num(h.fx_rate) || 1 : 1;
    const recvRate = num(h.received_fx_rate) > 0 ? num(h.received_fx_rate) : r;
    const remaining = num(h.goods) * r + num(h.cash_included_base) - num(h.received_amount) * recvRate + num(h.refund_amount);
    if (remaining > 1e-6) {
      rows.push({ key: `s-${num(h.id)}`, date: text(h.occurred_on), kind: "credit_sale", label: "فروش نسیه (باقی‌مانده)", party: text(h.party_name), docNo: text(h.invoice_no), amountBase: remaining });
    }
  }
  for (const h of purchases) {
    const r = h.fx_enabled ? num(h.fx_rate) || 1 : 1;
    const remaining = num(h.goods) * r - num(h.paid_amount) * r;
    if (remaining > 1e-6) {
      rows.push({ key: `p-${num(h.id)}`, date: text(h.occurred_on), kind: "credit_purchase", label: "خرید نسیه (باقی‌مانده)", party: text(h.party_name), docNo: text(h.invoice_no), amountBase: remaining });
    }
  }
  const rate = (id: number) => num(currencies.find((c) => num(c.id) === id)?.rate_to_base) || 1;
  for (const e of debts) {
    // Same as the dashboard's expense debt: today's rate.
    rows.push({ key: `e-${num(e.id)}`, date: text(e.occurred_on), kind: "debt_expense", label: "هزینه به شکل بدهی", party: text(e.party_name), docNo: text(e.title), amountBase: num(e.amount) * rate(num(e.currency_id)) });
  }
  return rows.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -1 : 1));
}

export async function cashbookData(
  sql: Sql,
  userId: string,
  input: { from: string; to: string; accountId?: number | null; currencyId?: number | null },
): Promise<CashbookData> {
  const from = ISO.test(input.from) ? input.from : "";
  const to = ISO.test(input.to) ? input.to : "";
  if (!from || !to) throw new Error("بازه تاریخ نامعتبر است");
  if (from > to) throw new Error("تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد");
  const { accountRows, movements, rateOf } = await loadAllMovements(sql, userId);
  const selected = accountRows.filter(
    (a) =>
      (input.accountId == null || num(a.id) === Number(input.accountId)) &&
      (input.currencyId == null || num(a.currency_id) === Number(input.currencyId)),
  );
  const selIds = new Set(selected.map((a) => num(a.id)));
  const accounts: CashAccountSummary[] = selected.map((a) => {
    const id = num(a.id);
    let opening = num(a.opening_balance);
    let totalIn = 0;
    let totalOut = 0;
    let baseIn = 0;
    let baseOut = 0;
    for (const m of movements) {
      if (m.accountId !== id || m.date > to) continue;
      if (m.date < from) {
        opening += m.amountIn - m.amountOut;
        continue;
      }
      totalIn += m.amountIn;
      totalOut += m.amountOut;
      baseIn += m.baseIn;
      baseOut += m.baseOut;
    }
    const closing = opening + totalIn - totalOut;
    const nowRate = rateOf(num(a.currency_id));
    return {
      accountId: id,
      name: text(a.name),
      kind: text(a.kind) === "counterparty" ? "طرف حساب نقدی" : "دخل",
      currencyId: num(a.currency_id),
      currencySymbol: text(a.currency_symbol) || "؋",
      opening,
      totalIn,
      totalOut,
      closing,
      baseIn,
      baseOut,
      openingBaseNow: opening * nowRate,
      closingBaseNow: closing * nowRate,
    };
  });
  const byAcc = new Map(accounts.map((a) => [a.accountId, a]));
  const single = accounts.length === 1 && input.accountId != null ? accounts[0] : null;
  let running = single?.opening ?? 0;
  const inRange: CashMovement[] = movements
    .filter((m) => selIds.has(m.accountId) && m.date >= from && m.date <= to)
    .map(({ rank: _rank, id: _id, ...m }) => {
      const acc = byAcc.get(m.accountId)!;
      if (single) running += m.amountIn - m.amountOut;
      return { ...m, accountName: acc.name, currencySymbol: acc.currencySymbol, running: single ? running : null };
    });
  const groups = GROUP_ORDER.map((group) => {
    const rows = inRange.filter((m) => m.group === group);
    return {
      group,
      label: CASH_GROUP_LABEL[group],
      baseIn: rows.reduce((s, m) => s + m.baseIn, 0),
      baseOut: rows.reduce((s, m) => s + m.baseOut, 0),
      count: rows.length,
    };
  }).filter((g) => g.count > 0);
  return {
    from,
    to,
    accounts,
    movements: inRange,
    groups,
    totals: {
      baseIn: accounts.reduce((s, a) => s + a.baseIn, 0),
      baseOut: accounts.reduce((s, a) => s + a.baseOut, 0),
      openingBaseNow: accounts.reduce((s, a) => s + a.openingBaseNow, 0),
      closingBaseNow: accounts.reduce((s, a) => s + a.closingBaseNow, 0),
    },
    nonCash: await loadNonCash(sql, userId, from, to),
  };
}

/** Any role (accountant, supervisor, seller) may read this report. */
export const getCashbook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { from: string; to: string; accountId?: number | null; currencyId?: number | null }) => validInput(d))
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    return cashbookData(sql, context.userId, data);
  });
