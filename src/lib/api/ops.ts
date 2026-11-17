import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { convertAmount, num, text, todayIso } from "@/lib/format";
import type { ExpenseCategory, RecurringCadence, RecurringDue, RecurringDueAnchor, RecurringExpense } from "@/lib/types";
import { parseCadence, parseDueAnchor } from "@/lib/types";
import { withTransaction, type Sql } from "@/lib/db";
import { guard, loadCatalogs, sqlOf, assertAccountantPin } from "./helpers";
import { assertOwned } from "./ownership";
import { validInput, validPositive } from "./validate";

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
    const old = await sql<{
      account_id: number | null;
      amount: unknown;
      currency_id: number;
      as_debt: unknown;
      fx_rate: unknown;
      account_rate: unknown;
    }>`
      select account_id, amount, currency_id, as_debt, fx_rate, account_rate from expenses
      where id = ${args.expenseId} and user_id = ${userId}
    `;
    if (old[0] && !old[0].as_debt && old[0].account_id != null && num(old[0].account_id) === acc.id) {
      // ACC-01: give back exactly what the balance subtracted (frozen rates).
      const oldRate =
        num(old[0].fx_rate) > 0
          ? num(old[0].fx_rate)
          : catalogs.currencies.find((c) => c.id === num(old[0].currency_id))?.rateToBase || 1;
      const oldAccRate = num(old[0].account_rate) > 0 ? num(old[0].account_rate) : toRate;
      available += convertAmount(num(old[0].amount), oldRate, oldAccRate);
    }
  }
  const need = convertAmount(args.amount, fromRate, toRate);
  if (need > available + 1e-9) return { accountId: null, asDebt: true };
  return { accountId: acc.id, asDebt: false };
}

export const listExpenses = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    const rows = await sql<Record<string, unknown>>`
      select e.*, c.symbol as currency_symbol, a.name as account_name,
        cat.name as category_name, p.name as party_name
      from expenses e
      join currencies c on c.id = e.currency_id and c.user_id = e.user_id
      left join accounts a on a.id = e.account_id and a.user_id = e.user_id
      left join expense_categories cat on cat.id = e.category_id and cat.user_id = e.user_id
      left join parties p on p.id = e.party_id and p.user_id = e.user_id
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
    }) => validPositive(d, "amount"),
  )
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "expenses");
    await assertOwned(sql, context.userId, [
      ["accounts", data.accountId],
      ["currencies", data.currencyId],
      ["expense_categories", data.categoryId],
      ["parties", data.partyId],
      ["expenses", data.id],
    ]);
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
  .validator((d: { id: number }) => validInput(d))
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "expenses");
    await sql`delete from expenses where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const resetExpenseHistory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { code: string }) => validInput(d))
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "expenses");
    await assertAccountantPin(sql, context.userId, data.code);
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

function periodKey(iso: string, cadence: RecurringCadence): string {
  const [y, m] = iso.split("-");
  if (cadence === "weekly") return iso;
  if (cadence === "yearly") return y;
  if (cadence === "quarterly") return `${y}-Q${Math.ceil(Number(m) / 3)}`;
  if (cadence === "semiannual") return `${y}-H${Number(m) <= 6 ? 1 : 2}`;
  return `${y}-${m}`;
}

/** Start of the k-th period, always counted from the original start (ACC-07: no month-end drift). */
function periodStart(startOn: string, k: number, cadence: RecurringCadence): string {
  if (cadence === "weekly") return addDays(startOn, 7 * k);
  const months = cadence === "quarterly" ? 3 : cadence === "semiannual" ? 6 : cadence === "yearly" ? 12 : 1;
  return addMonthsKeepDay(startOn, months * k);
}

/**
 * Due periods up to `today`. Each period starts at start + k·cadence (day
 * clamped to the month's length, so 31 Jan → 28 Feb → 31 Mar). With the
 * "end" anchor (salaries) a period is due the day after it ends, i.e. on the
 * next period's start.
 */
export function duePeriods(
  startOn: string,
  today: string,
  cadence: RecurringCadence = "monthly",
  anchor: RecurringDueAnchor = "start",
): { period: string; dueOn: string }[] {
  if (!startOn || !today) return [];
  const out: { period: string; dueOn: string }[] = [];
  for (let k = 0; k < 520; k++) {
    const cur = periodStart(startOn, k, cadence);
    const dueOn = anchor === "end" ? periodStart(startOn, k + 1, cadence) : cur;
    if (dueOn > today) break;
    out.push({ period: periodKey(cur, cadence), dueOn });
  }
  return out;
}

export async function loadRecurringDues(sql: Sql, userId: string): Promise<RecurringDue[]> {
  const [recs, periods] = await Promise.all([
    sql<Record<string, unknown>>`
      select r.*, c.symbol as currency_symbol, c.rate_to_base as currency_rate, p.name as party_name
      from recurring_expenses r
      join currencies c on c.id = r.currency_id and c.user_id = r.user_id
      left join parties p on p.id = r.party_id and p.user_id = r.user_id
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
        amountBase: num(r.amount) * (num(r.currency_rate) || 1),
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
  .validator((d: { id?: number; name: string; kind: "misc" | "recurring" }) => validInput(d))
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
  .validator((d: { id: number }) => validInput(d))
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
      join currencies c on c.id = r.currency_id and c.user_id = r.user_id
      left join expense_categories cat on cat.id = r.category_id and cat.user_id = r.user_id
      left join accounts a on a.id = r.account_id and a.user_id = r.user_id
      left join parties p on p.id = r.party_id and p.user_id = r.user_id
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
    }) => validPositive(d, "amount"),
  )
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "expenses");
    await assertOwned(sql, context.userId, [
      ["accounts", data.accountId],
      ["currencies", data.currencyId],
      ["expense_categories", data.categoryId],
      ["parties", data.partyId],
    ]);
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
  .validator((d: { id: number }) => validInput(d))
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
  .validator((d: { recurringId: number; period: string; status: "paid" | "unpaid" }) => validInput(d))
  .handler(async ({ context, data }) => {
    await guard(context.userId, "expenses");
    // STR-03: the expense row and the period status change together; the recurring row is locked so a double click cannot create two expenses for one period.
    return withTransaction(async (sql) => {
      await assertOwned(sql, context.userId, [["recurring_expenses", data.recurringId]]);
      const rec = await sql<Record<string, unknown>>`
        select * from recurring_expenses where id = ${data.recurringId} and user_id = ${context.userId}
        for update
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
  });

