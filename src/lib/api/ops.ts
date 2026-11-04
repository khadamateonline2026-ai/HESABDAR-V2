import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { convertAmount, num, text, todayIso } from "@/lib/format";
import type { ExpenseCategory, RecurringCadence, RecurringDue, RecurringDueAnchor, RecurringExpense } from "@/lib/types";
import { parseCadence, parseDueAnchor } from "@/lib/types";
import type { Sql } from "@/lib/db";
import {
  docStatusOf,
  getRoleCodes,
  guard,
  invoiceOf,
  itemKindOf,
  loadCatalogs,
  sqlOf,
} from "./helpers";

async function settleExpenseAccount(
  sql: Sql,
  userId: string,
  args: {
    accountId: number | null;
    amount: number;
    currencyId: number;
    expenseId?: number;
  },
): Promise<{ accountId: number | null; asDebt: boolean }> {
  if (args.accountId == null) return { accountId: null, asDebt: true };
  const catalogs = await loadCatalogs(sql, userId);
  const acc = catalogs.accounts.find((a) => a.id === args.accountId);
  if (!acc) return { accountId: null, asDebt: true };
  const fromRate = catalogs.currencies.find((c) => c.id === args.currencyId)?.rateToBase || 1;
  const toRate = catalogs.currencies.find((c) => c.id === acc.currencyId)?.rateToBase || 1;
  let available = acc.balance;
  if (args.expenseId) {
    const old = await sql<{ account_id: number | null; amount: unknown; currency_id: number; as_debt: unknown }>`
      select account_id, amount, currency_id, as_debt from expenses
      where id = ${args.expenseId} and user_id = ${userId}
    `;
    if (old[0] && !old[0].as_debt && old[0].account_id != null && num(old[0].account_id) === acc.id) {
      const oldRate = catalogs.currencies.find((c) => c.id === num(old[0].currency_id))?.rateToBase || 1;
      available += convertAmount(num(old[0].amount), oldRate, toRate);
    }
  }
  const need = convertAmount(args.amount, fromRate, toRate);
  if (need > available + 1e-9) return { accountId: null, asDebt: true };
  return { accountId: acc.id, asDebt: false };
}

export const listPurchases = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    const rows = await sql<Record<string, unknown>>`
      select p.*, v.name as vendor_name, u.name as unit_name, c.symbol as currency_symbol,
        a.name as account_name, i.kind as item_kind
      from purchases p
      left join parties v on v.id = p.vendor_id
      left join units u on u.id = p.unit_id
      join currencies c on c.id = p.currency_id
      left join accounts a on a.id = p.account_id
      left join items i on i.id = p.item_id
      where p.user_id = ${context.userId}
      order by p.occurred_on desc, p.id desc
    `;
    return rows.map((r) => ({
      id: num(r.id),
      vendorId: r.vendor_id == null ? null : num(r.vendor_id),
      vendorName: text(r.vendor_name),
      itemId: r.item_id == null ? null : num(r.item_id),
      itemName: text(r.item_name),
      quantity: num(r.quantity),
      receivedQty: r.received_qty == null ? num(r.quantity) : num(r.received_qty),
      unitId: r.unit_id == null ? null : num(r.unit_id),
      unitName: text(r.unit_name),
      unitPrice: num(r.unit_price),
      currencyId: num(r.currency_id),
      currencySymbol: text(r.currency_symbol),
      accountId: r.account_id == null ? null : num(r.account_id),
      accountName: text(r.account_name),
      warehouseName: text(r.warehouse_name),
      occurredOn: text(r.occurred_on),
      notes: text(r.notes),
      total: num(r.quantity) * num(r.unit_price),
      invoiceNo: invoiceOf("خرید", num(r.id), r.invoice_no),
      status: docStatusOf(r.status),
      itemKind: itemKindOf(r.item_kind),
      invoiceId: r.invoice_id == null ? null : num(r.invoice_id),
      lineNo: num(r.line_no) || 1,
    }));
  });

export const savePurchase = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      vendorId: number | null;
      itemId: number | null;
      itemName: string;
      quantity: number;
      unitId: number | null;
      unitPrice: number;
      currencyId: number;
      accountId: number | null;
      warehouseName: string;
      occurredOn: string;
      notes: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "purchase");
    if (data.id) {
      await sql`
        update purchases set
          vendor_id = ${data.vendorId}, item_id = ${data.itemId}, item_name = ${data.itemName},
          quantity = ${data.quantity}, unit_id = ${data.unitId}, unit_price = ${data.unitPrice},
          currency_id = ${data.currencyId}, account_id = ${data.accountId}, warehouse_name = ${data.warehouseName},
          occurred_on = ${data.occurredOn}, notes = ${data.notes}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into purchases (
        user_id, vendor_id, item_id, item_name, quantity, unit_id, unit_price, currency_id,
        account_id, warehouse_name, occurred_on, notes, status
      ) values (
        ${context.userId}, ${data.vendorId}, ${data.itemId}, ${data.itemName}, ${data.quantity}, ${data.unitId},
        ${data.unitPrice}, ${data.currencyId}, ${data.accountId}, ${data.warehouseName}, ${data.occurredOn}, ${data.notes},
        ${"final"}
      ) returning id
    `;
    const id = rows[0].id;
    const invoice = `خرید-${id}`;
    await sql`update purchases set invoice_no = ${invoice} where id = ${id} and user_id = ${context.userId}`;
    return { id };
  });

export const deletePurchase = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "purchase");
    await sql`delete from purchases where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listSales = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    const rows = await sql<Record<string, unknown>>`
      select s.*, c.name as customer_name, u.name as unit_name, cur.symbol as currency_symbol,
        a.name as account_name, i.kind as item_kind
      from sales s
      left join parties c on c.id = s.customer_id
      left join units u on u.id = s.unit_id
      join currencies cur on cur.id = s.currency_id
      left join accounts a on a.id = s.account_id
      left join items i on i.id = s.item_id
      where s.user_id = ${context.userId}
      order by s.occurred_on desc, s.id desc
    `;
    return rows.map((r) => ({
      id: num(r.id),
      customerId: r.customer_id == null ? null : num(r.customer_id),
      customerName: text(r.customer_name),
      itemId: r.item_id == null ? null : num(r.item_id),
      itemName: text(r.item_name),
      quantity: num(r.quantity),
      unitId: r.unit_id == null ? null : num(r.unit_id),
      unitName: text(r.unit_name),
      unitPrice: num(r.unit_price),
      currencyId: num(r.currency_id),
      currencySymbol: text(r.currency_symbol),
      accountId: r.account_id == null ? null : num(r.account_id),
      accountName: text(r.account_name),
      occurredOn: text(r.occurred_on),
      notes: text(r.notes),
      total: num(r.quantity) * num(r.unit_price),
      invoiceNo: invoiceOf("فروش", num(r.id), r.invoice_no),
      status: docStatusOf(r.status),
      itemKind: itemKindOf(r.item_kind),
      invoiceId: r.invoice_id == null ? null : num(r.invoice_id),
      lineNo: num(r.line_no) || 1,
    }));
  });

export const saveSale = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      customerId: number | null;
      itemId: number | null;
      itemName: string;
      quantity: number;
      unitId: number | null;
      unitPrice: number;
      currencyId: number;
      accountId: number | null;
      occurredOn: string;
      notes: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "sales");
    if (data.id) {
      await sql`
        update sales set
          customer_id = ${data.customerId}, item_id = ${data.itemId}, item_name = ${data.itemName},
          quantity = ${data.quantity}, unit_id = ${data.unitId}, unit_price = ${data.unitPrice},
          currency_id = ${data.currencyId}, account_id = ${data.accountId},
          occurred_on = ${data.occurredOn}, notes = ${data.notes}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into sales (
        user_id, customer_id, item_id, item_name, quantity, unit_id, unit_price, currency_id, account_id, occurred_on, notes, status
      ) values (
        ${context.userId}, ${data.customerId}, ${data.itemId}, ${data.itemName}, ${data.quantity}, ${data.unitId},
        ${data.unitPrice}, ${data.currencyId}, ${data.accountId}, ${data.occurredOn}, ${data.notes}, ${"final"}
      ) returning id
    `;
    const id = rows[0].id;
    const invoice = `فروش-${id}`;
    await sql`update sales set invoice_no = ${invoice} where id = ${id} and user_id = ${context.userId}`;
    return { id };
  });

export const deleteSale = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "sales");
    await sql`delete from sales where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listExpenses = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    const rows = await sql<Record<string, unknown>>`
      select e.*, c.symbol as currency_symbol, a.name as account_name,
        cat.name as category_name, p.name as party_name
      from expenses e
      join currencies c on c.id = e.currency_id
      left join accounts a on a.id = e.account_id
      left join expense_categories cat on cat.id = e.category_id
      left join parties p on p.id = e.party_id
      where e.user_id = ${context.userId}
      order by e.occurred_on desc, e.id desc
    `;
    return rows.map((r) => ({
      id: num(r.id),
      title: text(r.title),
      amount: num(r.amount),
      currencyId: num(r.currency_id),
      currencySymbol: text(r.currency_symbol),
      accountId: r.account_id == null ? null : num(r.account_id),
      accountName: text(r.account_name),
      occurredOn: text(r.occurred_on),
      notes: text(r.notes),
      categoryId: r.category_id == null ? null : num(r.category_id),
      categoryName: text(r.category_name),
      partyId: r.party_id == null ? null : num(r.party_id),
      partyName: text(r.party_name),
      asDebt: Boolean(r.as_debt),
    }));
  });

export const saveExpense = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      title: string;
      amount: number;
      currencyId: number;
      accountId: number | null;
      occurredOn: string;
      notes: string;
      categoryId?: number | null;
      partyId?: number | null;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "expenses");
    const categoryId = data.categoryId ?? null;
    const partyId = data.partyId ?? null;
    const paid = await settleExpenseAccount(sql, context.userId, {
      accountId: data.accountId,
      amount: data.amount,
      currencyId: data.currencyId,
      expenseId: data.id,
    });
    if (data.id) {
      await sql`
        update expenses set
          title = ${data.title}, amount = ${data.amount}, currency_id = ${data.currencyId},
          account_id = ${paid.accountId}, occurred_on = ${data.occurredOn}, notes = ${data.notes},
          category_id = ${categoryId}, party_id = ${partyId}, as_debt = ${paid.asDebt}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id, asDebt: paid.asDebt };
    }
    const rows = await sql<{ id: number }>`
      insert into expenses (
        user_id, title, amount, currency_id, account_id, occurred_on, notes, category_id, party_id, as_debt
      ) values (
        ${context.userId}, ${data.title}, ${data.amount}, ${data.currencyId}, ${paid.accountId},
        ${data.occurredOn}, ${data.notes}, ${categoryId}, ${partyId}, ${paid.asDebt}
      )
      returning id
    `;
    return { id: rows[0].id, asDebt: paid.asDebt };
  });

export const deleteExpense = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "expenses");
    await sql`delete from expenses where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const resetExpenseHistory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { code: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "expenses");
    const codes = await getRoleCodes(sql, context.userId);
    if (codes.accountant !== data.code.trim()) throw new Error("کد نقش حسابدار نادرست است");
    await sql`delete from expenses where user_id = ${context.userId}`;
    await sql`
      delete from recurring_periods
      where user_id = ${context.userId}
        and recurring_id in (
          select id from recurring_expenses
          where user_id = ${context.userId} and worker_id is null
        )
    `;
    return { ok: true as const };
  });

function monthLength(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function addMonthsKeepDay(iso: string, months: number): string {
  const [y, m, orig] = iso.split("-").map(Number);
  let mm = m + months;
  let yy = y;
  while (mm > 12) {
    mm -= 12;
    yy += 1;
  }
  while (mm < 1) {
    mm += 12;
    yy -= 1;
  }
  const day = Math.min(orig, monthLength(yy, mm));
  return `${yy}-${pad2(mm)}-${pad2(day)}`;
}

function nextDue(iso: string, cadence: RecurringCadence): string {
  if (cadence === "weekly") return addDays(iso, 7);
  if (cadence === "quarterly") return addMonthsKeepDay(iso, 3);
  if (cadence === "semiannual") return addMonthsKeepDay(iso, 6);
  if (cadence === "yearly") return addMonthsKeepDay(iso, 12);
  return addMonthsKeepDay(iso, 1);
}

function periodKey(iso: string, cadence: RecurringCadence): string {
  const [y, m] = iso.split("-");
  if (cadence === "weekly") return iso;
  if (cadence === "yearly") return y;
  if (cadence === "quarterly") return `${y}-Q${Math.ceil(Number(m) / 3)}`;
  if (cadence === "semiannual") return `${y}-H${Number(m) <= 6 ? 1 : 2}`;
  return `${y}-${m}`;
}

export function duePeriods(
  startOn: string,
  today: string,
  cadence: RecurringCadence = "monthly",
  anchor: RecurringDueAnchor = "start",
): { period: string; dueOn: string }[] {
  if (!startOn || !today) return [];
  const out: { period: string; dueOn: string }[] = [];
  let cur = startOn;
  let guard = 0;
  while (guard < 520) {
    const dueOn = anchor === "end" ? addDays(nextDue(cur, cadence), 1) : cur;
    if (dueOn > today) break;
    out.push({ period: periodKey(cur, cadence), dueOn });
    const next = nextDue(cur, cadence);
    if (next <= cur) break;
    cur = next;
    guard += 1;
  }
  return out;
}

export async function loadRecurringDues(sql: Sql, userId: string): Promise<RecurringDue[]> {
  const [recs, periods] = await Promise.all([
    sql<Record<string, unknown>>`
      select r.*, c.symbol as currency_symbol, p.name as party_name
      from recurring_expenses r
      join currencies c on c.id = r.currency_id
      left join parties p on p.id = r.party_id
      where r.user_id = ${userId}
    `,
    sql<Record<string, unknown>>`
      select * from recurring_periods where user_id = ${userId}
    `,
  ]);
  const today = todayIso();
  const dues: RecurringDue[] = [];
  for (const r of recs) {
    const marks = periods.filter((p) => num(p.recurring_id) === num(r.id));
    const cadence = parseCadence(text(r.cadence));
    const anchor = r.worker_id != null ? "end" : parseDueAnchor(text(r.due_anchor));
    for (const slot of duePeriods(text(r.start_on), today, cadence, anchor)) {
      const mark = marks.find((p) => text(p.period) === slot.period);
      dues.push({
        id: mark ? num(mark.id) : null,
        recurringId: num(r.id),
        title: text(r.title),
        amount: num(r.amount),
        currencyId: num(r.currency_id),
        currencySymbol: text(r.currency_symbol),
        period: slot.period,
        dueOn: slot.dueOn,
        status: text(mark?.status) === "paid" ? "paid" : "unpaid",
        partyId: r.party_id == null ? null : num(r.party_id),
        partyName: text(r.party_name),
        workerId: r.worker_id == null ? null : num(r.worker_id),
      });
    }
  }
  return dues.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));
}


export const listExpenseCategories = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ExpenseCategory[]> => {
    const sql = await sqlOf();
    const rows = await sql<Record<string, unknown>>`
      select * from expense_categories where user_id = ${context.userId} order by id
    `;
    return rows.map((r) => ({
      id: num(r.id),
      name: text(r.name),
      kind: text(r.kind) === "recurring" ? ("recurring" as const) : ("misc" as const),
    }));
  });

export const saveExpenseCategory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: number; name: string; kind: "misc" | "recurring" }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "expenses");
    const name = data.name.trim();
    if (!name) throw new Error("نام لازم است");
    const kind = data.kind === "recurring" ? "recurring" : "misc";
    if (data.id) {
      await sql`
        update expense_categories set name = ${name}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into expense_categories (user_id, name, kind)
      values (${context.userId}, ${name}, ${kind})
      returning id
    `;
    return { id: rows[0].id };
  });

export const deleteExpenseCategory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "expenses");
    await sql`delete from expense_categories where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listRecurringExpenses = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<RecurringExpense[]> => {
    const sql = await sqlOf();
    const rows = await sql<Record<string, unknown>>`
      select r.*, c.symbol as currency_symbol, cat.name as category_name, a.name as account_name, p.name as party_name
      from recurring_expenses r
      join currencies c on c.id = r.currency_id
      left join expense_categories cat on cat.id = r.category_id
      left join accounts a on a.id = r.account_id
      left join parties p on p.id = r.party_id
      where r.user_id = ${context.userId} and r.worker_id is null
      order by r.id desc
    `;
    return rows.map((r) => ({
      id: num(r.id),
      title: text(r.title),
      amount: num(r.amount),
      currencyId: num(r.currency_id),
      currencySymbol: text(r.currency_symbol),
      categoryId: r.category_id == null ? null : num(r.category_id),
      categoryName: text(r.category_name),
      startOn: text(r.start_on),
      cadence: parseCadence(text(r.cadence)),
      dueAnchor: parseDueAnchor(text(r.due_anchor)),
      notes: text(r.notes),
      accountId: r.account_id == null ? null : num(r.account_id),
      accountName: text(r.account_name),
      partyId: r.party_id == null ? null : num(r.party_id),
      partyName: text(r.party_name),
      workerId: r.worker_id == null ? null : num(r.worker_id),
    }));
  });

export const saveRecurringExpense = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      title: string;
      amount: number;
      currencyId: number;
      categoryId: number | null;
      startOn: string;
      cadence: RecurringCadence;
      dueAnchor?: RecurringDueAnchor;
      notes: string;
      accountId?: number | null;
      partyId?: number | null;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "expenses");
    const title = data.title.trim();
    if (!title) throw new Error("تشریح لازم است");
    if (data.amount <= 0) throw new Error("مبلغ باید بزرگ‌تر از صفر باشد");
    const cadence = parseCadence(data.cadence);
    const dueAnchor = parseDueAnchor(data.dueAnchor);
    if (!data.startOn) throw new Error("تاریخ شروع لازم است");
    const accountId = data.accountId ?? null;
    const partyId = data.partyId ?? null;
    if (data.id) {
      await sql`
        update recurring_expenses set
          title = ${title}, amount = ${data.amount}, currency_id = ${data.currencyId},
          category_id = ${data.categoryId}, start_on = ${data.startOn}, cadence = ${cadence},
          due_anchor = ${dueAnchor}, notes = ${data.notes}, account_id = ${accountId}, party_id = ${partyId}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into recurring_expenses (
        user_id, title, amount, currency_id, category_id, start_on, cadence, due_anchor, notes, account_id, party_id
      ) values (
        ${context.userId}, ${title}, ${data.amount}, ${data.currencyId}, ${data.categoryId},
        ${data.startOn}, ${cadence}, ${dueAnchor}, ${data.notes}, ${accountId}, ${partyId}
      )
      returning id
    `;
    return { id: rows[0].id };
  });

export const deleteRecurringExpense = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "expenses");
    await sql`delete from recurring_expenses where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listRecurringDues = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    return loadRecurringDues(sql, context.userId);
  });

export const setRecurringPeriodStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { recurringId: number; period: string; status: "paid" | "unpaid" }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "expenses");
    const rec = await sql<Record<string, unknown>>`
      select * from recurring_expenses where id = ${data.recurringId} and user_id = ${context.userId}
    `;
    if (!rec[0]) throw new Error("هزینه تکراری یافت نشد");
    const existing = await sql<Record<string, unknown>>`
      select * from recurring_periods
      where recurring_id = ${data.recurringId} and period = ${data.period} and user_id = ${context.userId}
    `;
    if (data.status === "unpaid") {
      if (existing[0]?.expense_id != null) {
        await sql`delete from expenses where id = ${num(existing[0].expense_id)} and user_id = ${context.userId}`;
      }
      if (existing[0]) {
        await sql`
          delete from recurring_periods where id = ${num(existing[0].id)} and user_id = ${context.userId}
        `;
      }
      return { ok: true as const };
    }
    const accounts = await sql<{ id: number }>`
      select id from accounts where user_id = ${context.userId} order by id limit 1
    `;
    const recAccount = rec[0].account_id == null ? accounts[0]?.id ?? null : num(rec[0].account_id);
    const paid = await settleExpenseAccount(sql, context.userId, {
      accountId: recAccount,
      amount: num(rec[0].amount),
      currencyId: num(rec[0].currency_id),
    });
    const recParty = rec[0].party_id == null ? null : num(rec[0].party_id);
    let expenseId = existing[0]?.expense_id == null ? null : num(existing[0].expense_id);
    if (expenseId == null) {
      const inserted = await sql<{ id: number }>`
        insert into expenses (
          user_id, title, amount, currency_id, account_id, occurred_on, notes, category_id, party_id, as_debt
        ) values (
          ${context.userId}, ${text(rec[0].title)}, ${num(rec[0].amount)}, ${num(rec[0].currency_id)},
          ${paid.accountId}, ${todayIso()}, ${`دوره ${data.period}`},
          ${rec[0].category_id == null ? null : num(rec[0].category_id)}, ${recParty}, ${paid.asDebt}
        )
        returning id
      `;
      expenseId = inserted[0].id;
    }
    if (existing[0]) {
      await sql`
        update recurring_periods set status = ${"paid"}, paid_on = ${todayIso()}, expense_id = ${expenseId}
        where id = ${num(existing[0].id)} and user_id = ${context.userId}
      `;
    } else {
      await sql`
        insert into recurring_periods (user_id, recurring_id, period, status, paid_on, expense_id)
        values (
          ${context.userId}, ${data.recurringId}, ${data.period}, ${"paid"}, ${todayIso()}, ${expenseId}
        )
      `;
    }
    return { ok: true as const };
  });

export const getReports = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    const catalogs = await loadCatalogs(sql, context.userId);
    const sales = await sql<{ quantity: unknown; unit_price: unknown; currency_id: number; occurred_on: string; status: string | null }>`
      select quantity, unit_price, currency_id, occurred_on, status from sales where user_id = ${context.userId}
    `;
    const purchases = await sql<{ quantity: unknown; unit_price: unknown; currency_id: number; status: string | null }>`
      select quantity, unit_price, currency_id, status from purchases where user_id = ${context.userId}
    `;
    const expenses = await sql<{ amount: unknown; currency_id: number; as_debt?: unknown }>`
      select amount, currency_id, as_debt from expenses where user_id = ${context.userId}
    `;
    const capital = await sql<{ kind: string; amount: unknown; currency_id: number }>`
      select kind, amount, currency_id from capital_moves where user_id = ${context.userId}
    `;
    const rate = (id: number) => catalogs.currencies.find((c) => c.id === id)?.rateToBase ?? 1;
    const toBase = (amount: number, currencyId: number) => amount * rate(currencyId);
    const liveSales = sales.filter((r) => (text(r.status) || "final") === "final");
    const livePurchases = purchases.filter((r) => (text(r.status) || "final") === "final");
    const salesBase = liveSales.reduce((s, r) => s + toBase(num(r.quantity) * num(r.unit_price), r.currency_id), 0);
    const purchaseBase = livePurchases.reduce(
      (s, r) => s + toBase(num(r.quantity) * num(r.unit_price), r.currency_id),
      0,
    );
    const expenseBase = expenses
      .filter((r) => !r.as_debt)
      .reduce((s, r) => s + toBase(num(r.amount), r.currency_id), 0);
    const capitalAdd = capital
      .filter((r) => r.kind === "add")
      .reduce((s, r) => s + toBase(num(r.amount), r.currency_id), 0);
    const capitalOut = capital
      .filter((r) => r.kind === "withdraw")
      .reduce((s, r) => s + toBase(num(r.amount), r.currency_id), 0);
    const cashBase = catalogs.accounts.reduce((s, a) => s + a.balance * rate(a.currencyId), 0);
    const today = new Date().toISOString().slice(0, 10);
    const todaySales = liveSales
      .filter((r) => text(r.occurred_on) === today)
      .reduce((s, r) => s + toBase(num(r.quantity) * num(r.unit_price), r.currency_id), 0);
    return {
      cashBase,
      salesBase,
      purchaseBase,
      expenseBase,
      capitalAdd,
      capitalOut,
      todaySales,
      accountCount: catalogs.accounts.length,
      partyCount: catalogs.parties.length,
    };
  });
