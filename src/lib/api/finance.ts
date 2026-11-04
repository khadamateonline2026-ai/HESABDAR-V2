import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { convertAmount, num, text } from "@/lib/format";
import { sqlOf, guard, assertCashAvailable, loadCatalogs, loadInventoryState, fxToBase } from "./helpers";

export const saveAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: number; name: string; currencyId: number; openingBalance: number; kind?: "cash" | "counterparty" }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "accounts");
    const kind = data.kind === "counterparty" ? "counterparty" : "cash";
    if (data.id) {
      await sql`
        update accounts set name = ${data.name.trim()}, currency_id = ${data.currencyId}, opening_balance = ${data.openingBalance}, kind = ${kind}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into accounts (user_id, name, currency_id, opening_balance, kind)
      values (${context.userId}, ${data.name.trim()}, ${data.currencyId}, ${data.openingBalance}, ${kind})
      returning id
    `;
    return { id: rows[0].id };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "accounts");
    await sql`delete from accounts where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listTransfers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    const rows = await sql<Record<string, unknown>>`
      select t.*, a1.name as from_name, a2.name as to_name
      from transfers t
      join accounts a1 on a1.id = t.from_account_id
      join accounts a2 on a2.id = t.to_account_id
      where t.user_id = ${context.userId}
      order by t.occurred_on desc, t.id desc
    `;
    return rows.map((r) => ({
      id: num(r.id),
      fromAccountId: num(r.from_account_id),
      fromAccountName: text(r.from_name),
      toAccountId: num(r.to_account_id),
      toAccountName: text(r.to_name),
      amount: num(r.amount),
      occurredOn: text(r.occurred_on),
      notes: text(r.notes),
    }));
  });

export const saveTransfer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      fromAccountId: number;
      toAccountId: number;
      amount: number;
      occurredOn: string;
      notes: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "transfers");
    if (data.fromAccountId === data.toAccountId) throw new Error("حساب مبدأ و مقصد باید متفاوت باشند");
    const catalogs = await loadCatalogs(sql, context.userId);
    const fromAcc = catalogs.accounts.find((a) => a.id === data.fromAccountId);
    const fromRate = catalogs.currencies.find((c) => c.id === fromAcc?.currencyId)?.rateToBase || 1;
    let creditBack = 0;
    if (data.id) {
      const old = await sql<{ from_account_id: number; amount: unknown }>`
        select from_account_id, amount from transfers where id = ${data.id} and user_id = ${context.userId}
      `;
      if (old[0] && num(old[0].from_account_id) === data.fromAccountId) creditBack = num(old[0].amount);
    }
    await assertCashAvailable(sql, context.userId, {
      accountId: data.fromAccountId,
      amount: data.amount,
      amountRate: fromRate,
      creditBack,
    });
    if (data.id) {
      await sql`
        update transfers
        set from_account_id = ${data.fromAccountId}, to_account_id = ${data.toAccountId},
            amount = ${data.amount}, occurred_on = ${data.occurredOn}, notes = ${data.notes}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into transfers (user_id, from_account_id, to_account_id, amount, occurred_on, notes)
      values (${context.userId}, ${data.fromAccountId}, ${data.toAccountId}, ${data.amount}, ${data.occurredOn}, ${data.notes})
      returning id
    `;
    return { id: rows[0].id };
  });

export const deleteTransfer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "transfers");
    await sql`delete from transfers where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listCapital = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    const rows = await sql<Record<string, unknown>>`
      select c.*, a.name as account_name, cur.symbol as currency_symbol
      from capital_moves c
      join accounts a on a.id = c.account_id
      join currencies cur on cur.id = c.currency_id
      where c.user_id = ${context.userId}
      order by c.occurred_on desc, c.id desc
    `;
    return rows.map((r) => ({
      id: num(r.id),
      kind: text(r.kind) as "add" | "withdraw",
      accountId: num(r.account_id),
      accountName: text(r.account_name),
      currencyId: num(r.currency_id),
      currencySymbol: text(r.currency_symbol),
      amount: num(r.amount),
      occurredOn: text(r.occurred_on),
      notes: text(r.notes),
    }));
  });

export const saveCapital = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      kind: "add" | "withdraw";
      accountId: number;
      currencyId: number;
      amount: number;
      occurredOn: string;
      notes: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "capital");
    if (data.kind === "withdraw") {
      const catalogs = await loadCatalogs(sql, context.userId);
      const amountRate = catalogs.currencies.find((c) => c.id === data.currencyId)?.rateToBase || 1;
      let creditBack = 0;
      if (data.id) {
        const old = await sql<{ account_id: number; amount: unknown; currency_id: number; kind: string }>`
          select account_id, amount, currency_id, kind from capital_moves
          where id = ${data.id} and user_id = ${context.userId}
        `;
        if (old[0] && old[0].kind === "withdraw" && num(old[0].account_id) === data.accountId) {
          const acc = catalogs.accounts.find((a) => a.id === data.accountId);
          const accRate = catalogs.currencies.find((c) => c.id === acc?.currencyId)?.rateToBase || 1;
          const oldRate = catalogs.currencies.find((c) => c.id === num(old[0].currency_id))?.rateToBase || 1;
          creditBack = convertAmount(num(old[0].amount), oldRate, accRate);
        }
      }
      await assertCashAvailable(sql, context.userId, {
        accountId: data.accountId,
        amount: data.amount,
        amountRate,
        creditBack,
      });
    }
    if (data.id) {
      await sql`
        update capital_moves
        set kind = ${data.kind}, account_id = ${data.accountId}, currency_id = ${data.currencyId},
            amount = ${data.amount}, occurred_on = ${data.occurredOn}, notes = ${data.notes}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into capital_moves (user_id, kind, account_id, currency_id, amount, occurred_on, notes)
      values (${context.userId}, ${data.kind}, ${data.accountId}, ${data.currencyId}, ${data.amount}, ${data.occurredOn}, ${data.notes})
      returning id
    `;
    return { id: rows[0].id };
  });

export const deleteCapital = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "capital");
    await sql`delete from capital_moves where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listOpeningCash = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    const rows = await sql<Record<string, unknown>>`
      select o.*, a.name as account_name, c.symbol as currency_symbol
      from opening_cash o
      join accounts a on a.id = o.account_id
      join currencies c on c.id = o.currency_id
      where o.user_id = ${context.userId}
      order by o.occurred_on desc, o.id desc
    `;
    return rows.map((r) => ({
      id: num(r.id),
      accountId: num(r.account_id),
      accountName: text(r.account_name),
      currencyId: num(r.currency_id),
      currencySymbol: text(r.currency_symbol),
      amount: num(r.amount),
      occurredOn: text(r.occurred_on),
      notes: text(r.notes),
    }));
  });

export const saveOpeningCash = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      accountId: number;
      currencyId: number;
      amount: number;
      occurredOn: string;
      notes: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "opening");
    const mag = Math.abs(data.amount);
    if (mag <= 1e-9) throw new Error("مبلغ باید بزرگ‌تر از صفر باشد");
    if (data.amount < 0) {
      let creditBack = 0;
      if (data.id) {
        const old = await sql<{ amount: unknown; account_id: number }>`
          select amount, account_id from opening_cash where id = ${data.id} and user_id = ${context.userId}
        `;
        if (old[0] && old[0].account_id === data.accountId && num(old[0].amount) < 0) {
          creditBack = Math.abs(num(old[0].amount));
        }
      }
      const catalogs = await loadCatalogs(sql, context.userId);
      const rate = catalogs.currencies.find((c) => c.id === data.currencyId)?.rateToBase || 1;
      await assertCashAvailable(sql, context.userId, {
        accountId: data.accountId,
        amount: mag,
        amountRate: rate,
        creditBack,
      });
    }
    if (data.id) {
      await sql`
        update opening_cash
        set account_id = ${data.accountId}, currency_id = ${data.currencyId}, amount = ${data.amount},
            occurred_on = ${data.occurredOn}, notes = ${data.notes}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into opening_cash (user_id, account_id, currency_id, amount, occurred_on, notes)
      values (${context.userId}, ${data.accountId}, ${data.currencyId}, ${data.amount}, ${data.occurredOn}, ${data.notes})
      returning id
    `;
    return { id: rows[0].id };
  });

export const deleteOpeningCash = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "opening");
    await sql`delete from opening_cash where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listOpeningStock = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { kind: "finished" | "raw" }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    const rows = await sql<Record<string, unknown>>`
      select * from opening_stock where user_id = ${context.userId} and kind = ${data.kind}
      order by occurred_on desc, id desc
    `;
    return rows.map((r) => ({
      id: num(r.id),
      kind: text(r.kind) as "finished" | "raw",
      itemName: text(r.item_name),
      warehouseName: text(r.warehouse_name),
      quantity: num(r.quantity),
      valueBase: num(r.value_base),
      salePrice: num(r.sale_price),
      unitCost:
        num(r.unit_cost) ||
        (num(r.quantity) > 1e-9 ? num(r.value_base) / num(r.quantity) : 0),
      occurredOn: text(r.occurred_on),
      notes: text(r.notes),
    }));
  });

async function lastRawUnitCost(
  sql: Awaited<ReturnType<typeof sqlOf>>,
  userId: string,
  name: string,
): Promise<number> {
  const catalogs = await loadCatalogs(sql, userId);
  const catalogPrice = catalogs.items.find((i) => i.kind === "raw" && i.name === name)?.purchasePrice ?? 0;
  const rows = await sql<{
    unit_price: unknown;
    currency_id: number;
    fx_enabled: boolean | null;
    fx_rate: unknown;
  }>`
    select p.unit_price, p.currency_id, i.fx_enabled, i.fx_rate
    from purchases p
    left join purchase_invoices i on i.id = p.invoice_id and i.user_id = p.user_id
    where p.user_id = ${userId} and p.item_name = ${name}
    order by coalesce(i.occurred_on, p.occurred_on) desc, p.id desc
    limit 1
  `;
  if (!rows[0]) return catalogPrice;
  const cur = await sql<{ rate_to_base: unknown }>`
    select rate_to_base from currencies where id = ${rows[0].currency_id} and user_id = ${userId}
  `;
  const currencyRate = num(cur[0]?.rate_to_base) || 1;
  const fx = fxToBase(rows[0].fx_enabled, rows[0].fx_rate, currencyRate);
  const last = num(rows[0].unit_price) * fx;
  return last > 1e-9 ? last : catalogPrice;
}

export const lastRawPurchaseRate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { itemName: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    const name = data.itemName.trim();
    if (!name) return { rate: 0 };
    return { rate: await lastRawUnitCost(sql, context.userId, name) };
  });

export const saveOpeningStock = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      kind: "finished" | "raw";
      itemName: string;
      warehouseName: string;
      quantity: number;
      valueBase?: number;
      salePrice?: number;
      unitCost?: number;
      occurredOn: string;
      notes: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "opening");
    const qty = data.quantity;
    const name = data.itemName.trim();
    if (Math.abs(qty) <= 1e-9) throw new Error("مقدار باید بزرگ‌تر از صفر باشد");
    let unitCost = 0;
    if (data.kind === "raw") {
      unitCost = await lastRawUnitCost(sql, context.userId, name);
    } else {
      const inv = await loadInventoryState(sql, context.userId);
      unitCost = inv.products.find((c) => c.name === name)?.unitCost ?? 0;
    }
    if (qty < 0) {
      const inv = await loadInventoryState(sql, context.userId);
      const card =
        data.kind === "raw"
          ? inv.raw.find((c) => c.name === name)
          : inv.products.find((c) => c.name === name);
      let available = card?.qty ?? 0;
      if (data.id) {
        const old = await sql<{ quantity: unknown }>`
          select quantity from opening_stock where id = ${data.id} and user_id = ${context.userId}
        `;
        if (old[0]) available -= num(old[0].quantity);
      }
      if (Math.abs(qty) > available + 1e-9) throw new Error("موجودی کافی نیست");
    }
    const valueBase = qty * unitCost;
    let id = data.id;
    if (id) {
      await sql`
        update opening_stock
        set item_name = ${name}, warehouse_name = ${data.warehouseName}, quantity = ${qty},
            value_base = ${valueBase}, occurred_on = ${data.occurredOn}, notes = ${data.notes},
            sale_price = ${0}, unit_cost = ${unitCost}
        where id = ${id} and user_id = ${context.userId}
      `;
    } else {
      const rows = await sql<{ id: number }>`
        insert into opening_stock (
          user_id, kind, item_name, warehouse_name, quantity, value_base, occurred_on, notes, sale_price, unit_cost
        )
        values (
          ${context.userId}, ${data.kind}, ${name}, ${data.warehouseName}, ${qty}, ${valueBase},
          ${data.occurredOn}, ${data.notes}, ${0}, ${unitCost}
        )
        returning id
      `;
      id = rows[0].id;
    }
    return { id };
  });

export const deleteOpeningStock = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "opening");
    await sql`delete from opening_stock where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });
