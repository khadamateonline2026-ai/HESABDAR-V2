import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { withTransaction, type Sql } from "@/lib/db";
import { convertAmount, formatMoney, num, text, todayIso } from "@/lib/format";
import type { InvoiceLine, Item, PurchaseInvoice, ReceiveStatus, SaleInvoice } from "@/lib/types";
import { syncLinkedPayment } from "./linked-payment";
import {
  assertCashAvailable,
  guard,
  itemKindOf,
  loadCatalogs,
  loadInventoryState,
  loadWarehouseStock,
  lockStock,
  MAIN_WAREHOUSE,
  nextDocNo,
  requireProfile,
  sqlOf,
} from "./helpers";
import { assertOwned } from "./ownership";
import { idempotent } from "./idempotency";
import { validInput } from "./validate";

type PurchaseIn = {
  id?: number;
  vendorId: number | null;
  occurredOn: string;
  expectedOn: string;
  currencyId: number;
  fxEnabled: boolean;
  fxRate: number;
  paidAmount: number;
  accountId: number | null;
  notes: string;
  lines: LineIn[];
};

type ReceiveIn = {
  id: number;
  warehouseName: string;
  categoryId: number | null;
  mode: "full" | "partial";
  lines: { id: number; receivedQty: number; notes: string }[];
};

type LineIn = {
  /** ACC-09: id of an existing purchase line being edited (absent for new lines). */
  id?: number | null;
  itemId: number | null;
  itemName: string;
  quantity: number;
  unitId: number | null;
  unitPrice: number;
  notes?: string;
};

function fxRate(enabled: boolean, rate: number, stored: number) {
  if (!enabled) return 1;
  return rate > 0 ? rate : stored || 1;
}

async function requireAccount(
  sql: Awaited<ReturnType<typeof sqlOf>>,
  userId: string,
  accountId: number | null,
): Promise<{ id: number; balance: number; currencyId: number; rateToBase: number }> {
  if (accountId == null) throw new Error("حساب انتخاب نشده است");
  const catalogs = await loadCatalogs(sql, userId);
  const acc = catalogs.accounts.find((a) => a.id === accountId);
  if (!acc) throw new Error("حساب انتخاب نشده است");
  const rate = catalogs.currencies.find((c) => c.id === acc.currencyId)?.rateToBase || 1;
  return { id: acc.id, balance: acc.balance, currencyId: acc.currencyId, rateToBase: rate };
}

async function assertPurchaseFunds(
  sql: Awaited<ReturnType<typeof sqlOf>>,
  userId: string,
  args: {
    accountId: number | null;
    paidAmount: number;
    currencyId: number;
    fxEnabled: boolean;
    fxRate: number;
    invoiceId?: number;
  },
) {
  const acc = await requireAccount(sql, userId, args.accountId);
  if (args.paidAmount <= 0) return;
  const catalogs = await loadCatalogs(sql, userId);
  const invoiceRate = args.fxEnabled
    ? args.fxRate || 1
    : catalogs.currencies.find((c) => c.id === args.currencyId)?.rateToBase || 1;
  let available = acc.balance;
  if (args.invoiceId) {
    const old = await sql<{
      paid_amount: unknown;
      account_id: number | null;
      fx_enabled: unknown;
      fx_rate: unknown;
      currency_id: number;
    }>`
      select paid_amount, account_id, fx_enabled, fx_rate, currency_id
      from purchase_invoices where id = ${args.invoiceId} and user_id = ${userId}
    `;
    if (old[0] && old[0].account_id != null && num(old[0].account_id) === acc.id) {
      const oldRate = old[0].fx_enabled
        ? num(old[0].fx_rate) || 1
        : catalogs.currencies.find((c) => c.id === num(old[0].currency_id))?.rateToBase || 1;
      available += convertAmount(num(old[0].paid_amount), oldRate, acc.rateToBase);
    }
  }
  const need = convertAmount(args.paidAmount, invoiceRate, acc.rateToBase);
  if (need > available + 1e-9) throw new Error("موجودی ناکافی هست");
}


function mapLines(
  rows: Record<string, unknown>[],
  received: boolean,
): InvoiceLine[] {
  return rows.map((r) => ({
    id: num(r.id),
    itemId: r.item_id == null ? null : num(r.item_id),
    itemName: text(r.item_name),
    quantity: num(r.quantity),
    receivedQty: received ? (r.received_qty == null ? num(r.quantity) : num(r.received_qty)) : num(r.quantity),
    unitId: r.unit_id == null ? null : num(r.unit_id),
    unitName: text(r.unit_name),
    unitPrice: num(r.unit_price),
    notes: text(r.notes),
    itemKind: itemKindOf(r.item_kind),
    lineNo: num(r.line_no) || 1,
  }));
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

async function allocInvoiceNo(
  sql: Sql,
  userId: string,
  table: "sale_invoices" | "purchase_invoices",
  prefix: "S" | "B",
) {
  await sql.query("select pg_advisory_xact_lock(hashtext($1))", [`${userId}:${prefix}`]);
  const nos = await sql.query<{ invoice_no: string }>(`select invoice_no from ${table} where user_id = $1`, [userId]);
  return nextDocNo(
    nos.map((n) => n.invoice_no),
    prefix,
  );
}


export const listPurchaseInvoices = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    const headers = await sql<Record<string, unknown>>`
      select i.*, v.name as vendor_name, c.symbol as currency_symbol, a.name as account_name
      from purchase_invoices i
      left join parties v on v.id = i.vendor_id and v.user_id = i.user_id
      join currencies c on c.id = i.currency_id and c.user_id = i.user_id
      left join accounts a on a.id = i.account_id and a.user_id = i.user_id
      where i.user_id = ${context.userId}
      order by i.occurred_on desc, i.id desc
    `;
    const lines = await sql<Record<string, unknown>>`
      select p.*, u.name as unit_name, it.kind as item_kind
      from purchases p
      left join units u on u.id = p.unit_id and u.user_id = p.user_id
      left join items it on it.id = p.item_id and it.user_id = p.user_id
      where p.user_id = ${context.userId}
      order by p.line_no, p.id
    `;
    const byInv = new Map<number, Record<string, unknown>[]>();
    for (const l of lines) {
      const id = l.invoice_id == null ? 0 : num(l.invoice_id);
      const arr = byInv.get(id) ?? [];
      arr.push(l);
      byInv.set(id, arr);
    }
    return headers.map((h) => toPurchaseInvoice(h, byInv.get(num(h.id)) ?? []));
  });

function toPurchaseInvoice(h: Record<string, unknown>, lineRows: Record<string, unknown>[]): PurchaseInvoice {
  const rate = num(h.fx_rate) || 1;
  const enabled = Boolean(h.fx_enabled);
  const r = fxRate(enabled, rate, rate);
  const lines = mapLines(lineRows, true);
  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const totalBase = total * r;
  const paid = num(h.paid_amount);
  return {
    id: num(h.id),
    vendorId: h.vendor_id == null ? null : num(h.vendor_id),
    vendorName: text(h.vendor_name),
    invoiceNo: text(h.invoice_no),
    occurredOn: text(h.occurred_on),
    expectedOn: text(h.expected_on),
    currencyId: num(h.currency_id),
    currencySymbol: text(h.currency_symbol) || "؋",
    fxEnabled: enabled,
    fxRate: r,
    paidAmount: paid,
    accountId: h.account_id == null ? null : num(h.account_id),
    accountName: text(h.account_name),
    notes: text(h.notes),
    receiveStatus: text(h.receive_status) === "arrived" ? "arrived" : "in_transit",
    lines,
    total,
    totalBase,
    remainingBase: totalBase - paid * r,
  };
}

export async function savePurchaseInvoiceTx(sql: Sql, userId: string, data: PurchaseIn) {
  const cleanLines = data.lines.filter((l) => l.itemName.trim() && l.quantity > 0);
  if (!cleanLines.length) throw new Error("حداقل یک ردیف کالا لازم است");
        await assertOwned(sql, userId, [
          ["parties", data.vendorId],
          ["accounts", data.accountId],
          ["currencies", data.currencyId],
          ["purchase_invoices", data.id],
          ...cleanLines.flatMap((l) => [["items", l.itemId] as const, ["units", l.unitId] as const]),
        ]);
  await assertPurchaseFunds(sql, userId, {
    accountId: data.accountId,
    paidAmount: data.paidAmount,
    currencyId: data.currencyId,
    fxEnabled: data.fxEnabled,
    fxRate: data.fxRate,
    invoiceId: data.id,
  });
  const rate = fxRate(data.fxEnabled, data.fxRate, 1);
  let id = data.id;
  let invoiceNo = "";
  // ACC-08/ACC-09: stock lock first — editing can remove received goods.
  await lockStock(sql, userId);
  const oldLines = id
    ? await sql<{ id: number; item_id: number | null; item_name: string; received_qty: unknown }>`
        select id, item_id, item_name, received_qty from purchases
        where invoice_id = ${id} and user_id = ${userId}
      `
    : [];
  if (id) {
    const row = await sql<{ invoice_no: string }>`
      select invoice_no from purchase_invoices where id = ${id} and user_id = ${userId}
    `;
    if (!row[0]) throw new Error("فاکتور یافت نشد");
    invoiceNo = row[0].invoice_no;
    await sql`
      update purchase_invoices set
        vendor_id = ${data.vendorId}, occurred_on = ${data.occurredOn}, expected_on = ${data.expectedOn || null},
        currency_id = ${data.currencyId}, fx_enabled = ${data.fxEnabled}, fx_rate = ${rate},
        paid_amount = ${data.paidAmount}, account_id = ${data.accountId}, notes = ${data.notes}
      where id = ${id} and user_id = ${userId}
    `;
  } else {
    invoiceNo = await allocInvoiceNo(sql, userId, "purchase_invoices", "B");
    const rows = await sql<{ id: number }>`
      insert into purchase_invoices (
        user_id, vendor_id, invoice_no, occurred_on, expected_on, currency_id, fx_enabled, fx_rate,
        paid_amount, account_id, notes, receive_status
      ) values (
        ${userId}, ${data.vendorId}, ${invoiceNo}, ${data.occurredOn}, ${data.expectedOn || null},
        ${data.currencyId}, ${data.fxEnabled}, ${rate}, ${data.paidAmount}, ${data.accountId}, ${data.notes},
        ${"in_transit"}
      ) returning id
    `;
    id = rows[0].id;
  }
  if (!id) throw new Error("فاکتور ذخیره نشد");
  // ACC-09: existing lines are updated in place (matched by line id), so
  // their receipts (quantity, warehouse, date) are kept. Clients that do
  // not send line ids yet fall back to matching by item name.
  const byId = new Map(oldLines.map((o) => [num(o.id), o]));
  const sendsIds = cleanLines.some((l) => l.id != null);
  const used = new Set<number>();
  const removed: { itemId: number | null; itemName: string; qty: number }[] = [];
  const trims: [number, number][] = [];
  let lineNo = 1;
  let allArrived = cleanLines.length > 0;
  for (const l of cleanLines) {
    const name = l.itemName.trim();
    const lid = l.id == null ? null : Number(l.id);
    let match = lid != null && !used.has(lid) ? byId.get(lid) : undefined;
    if (!match && !sendsIds) match = oldLines.find((o) => !used.has(num(o.id)) && text(o.item_name) === name);
    if (match) {
      const mid = num(match.id);
      used.add(mid);
      const rec = match.received_qty == null ? 0 : num(match.received_qty);
      const oldItem = match.item_id == null ? null : num(match.item_id);
      const sameItem = l.itemId != null ? oldItem === l.itemId : text(match.item_name) === name;
      if (rec > 1e-9 && !sameItem) {
        throw new Error(`ردیف «${text(match.item_name)}» رسیده است و کالای آن را نمی‌توان عوض کرد؛ ردیف تازه اضافه کنید`);
      }
      if (rec > l.quantity + 1e-9) {
        removed.push({ itemId: l.itemId, itemName: name, qty: rec - l.quantity });
        trims.push([mid, rec - l.quantity]);
      }
      if (Math.min(rec, l.quantity) + 1e-9 < l.quantity) allArrived = false;
      await sql`
        update purchases set
          vendor_id = ${data.vendorId}, item_id = ${l.itemId}, item_name = ${name}, quantity = ${l.quantity},
          unit_id = ${l.unitId}, unit_price = ${l.unitPrice}, currency_id = ${data.currencyId},
          account_id = ${data.accountId}, occurred_on = ${data.occurredOn}, notes = ${l.notes ?? ""},
          invoice_no = ${invoiceNo}, line_no = ${lineNo}
        where id = ${mid} and user_id = ${userId}
      `;
    } else {
      allArrived = false;
      await sql`
        insert into purchases (
          user_id, vendor_id, item_id, item_name, quantity, received_qty, unit_id, unit_price, currency_id,
          account_id, warehouse_name, occurred_on, notes, status, invoice_no, invoice_id, line_no
        ) values (
          ${userId}, ${data.vendorId}, ${l.itemId}, ${name}, ${l.quantity}, ${0},
          ${l.unitId}, ${l.unitPrice}, ${data.currencyId}, ${data.accountId}, ${""}, ${data.occurredOn},
          ${l.notes ?? ""}, ${"final"}, ${invoiceNo}, ${id}, ${lineNo}
        )
      `;
    }
    lineNo += 1;
  }
  const dropped = oldLines.filter((o) => !used.has(num(o.id)));
  for (const o of dropped) {
    removed.push({
      itemId: o.item_id == null ? null : num(o.item_id),
      itemName: text(o.item_name),
      qty: o.received_qty == null ? 0 : num(o.received_qty),
    });
  }
  // ACC-11: received goods that were already sold or used cannot be removed.
  await assertReceiptsRemovable(sql, userId, removed);
  for (const [pid, qty] of trims) await trimReceipts(sql, userId, pid, qty);
  for (const o of dropped) await sql`delete from purchases where id = ${num(o.id)} and user_id = ${userId}`;
  const status: ReceiveStatus = allArrived && oldLines.length > 0 ? "arrived" : "in_transit";
  await sql`
    update purchase_invoices set receive_status = ${status}
    where id = ${id} and user_id = ${userId}
  `;
  await syncLinkedPayment(sql, {
    userId: userId,
    kind: "payment",
    partyId: data.vendorId,
    amount: data.paidAmount,
    currencyId: data.currencyId,
    accountId: data.accountId,
    occurredOn: data.occurredOn,
    purchaseInvoiceId: id,
    label: `پرداخت فاکتور ${invoiceNo}`,
  });
  return { id, invoiceNo };
}

export const savePurchaseInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: PurchaseIn) => validInput(d))
  .handler(async ({ context, data }) =>
    // STR-04: a replayed offline save returns its first result.
    idempotent(context.userId, async () => {
      await guard(context.userId, "purchase");
      const cleanLines = data.lines.filter((l) => l.itemName.trim() && l.quantity > 0);
      if (!cleanLines.length) throw new Error("حداقل یک ردیف کالا لازم است");
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await withTransaction((sql) => savePurchaseInvoiceTx(sql, context.userId, data));
        } catch (err) {
          if (data.id || attempt === 4 || !isUniqueViolation(err)) throw err;
        }
      }
      throw new Error("فاکتور ذخیره نشد");
    }),
  );

/**
 * ACC-11: stock received on purchase lines must still be on hand before the
 * lines are removed; otherwise goods already sold or used in production would
 * lose their source and stock would go negative. Call inside the transaction,
 * after lockStock.
 */
export async function assertReceiptsRemovable(
  sql: Sql,
  userId: string,
  removed: { itemId: number | null; itemName: string; qty: number }[],
): Promise<void> {
  const byItem = new Map<string, { name: string; qty: number; itemId: number | null }>();
  for (const r of removed) {
    if (r.qty <= 1e-9) continue;
    const k = r.itemId != null ? `id:${r.itemId}` : `name:${r.itemName}`;
    const cur = byItem.get(k) ?? { name: r.itemName, qty: 0, itemId: r.itemId };
    cur.qty += r.qty;
    byItem.set(k, cur);
  }
  if (!byItem.size) return;
  const inv = await loadInventoryState(sql, userId);
  const short: string[] = [];
  for (const it of byItem.values()) {
    const card = inv.raw.find((c) => (it.itemId != null && c.itemId === it.itemId) || c.name === it.name);
    const onHand = card?.qty ?? 0;
    if (onHand + 1e-9 < it.qty) {
      short.push(`${it.name} (رسیده ${formatMoney(it.qty)}، موجود ${formatMoney(onHand)})`);
    }
  }
  if (short.length) {
    throw new Error(
      `کالای این خرید فروخته یا در تولید مصرف شده است؛ حذف آن موجودی را منفی می‌کند:\n${short.join("\n")}\nنخست فروش یا مصرف مربوط را اصلاح کنید.`,
    );
  }
}

/** ACC-09: take `qty` back off a line's receipts, newest first. */
export async function trimReceipts(sql: Sql, userId: string, purchaseId: number, qty: number): Promise<void> {
  let left = qty;
  const rows = await sql<{ id: number; quantity: unknown }>`
    select id, quantity from purchase_receipts
    where purchase_id = ${purchaseId} and user_id = ${userId}
    order by occurred_on desc, id desc
  `;
  for (const r of rows) {
    if (left <= 1e-9) break;
    const q = num(r.quantity);
    if (q <= left + 1e-9) {
      await sql`delete from purchase_receipts where id = ${r.id} and user_id = ${userId}`;
      left -= q;
    } else {
      await sql`update purchase_receipts set quantity = ${q - left} where id = ${r.id} and user_id = ${userId}`;
      left = 0;
    }
  }
  await sql`
    update purchases set received_qty = greatest(0, coalesce(received_qty, 0) - ${qty})
    where id = ${purchaseId} and user_id = ${userId}
  `;
}

/** ACC-11: delete a purchase invoice only when its received goods are still in stock. */
export async function deletePurchaseInvoiceTx(tx: Sql, userId: string, id: number): Promise<void> {
  await lockStock(tx, userId);
  const lines = await tx<{ item_id: number | null; item_name: string; received_qty: unknown }>`
    select item_id, item_name, received_qty from purchases where invoice_id = ${id} and user_id = ${userId}
  `;
  await assertReceiptsRemovable(
    tx,
    userId,
    lines.map((l) => ({
      itemId: l.item_id == null ? null : num(l.item_id),
      itemName: text(l.item_name),
      qty: l.received_qty == null ? 0 : num(l.received_qty),
    })),
  );
  await tx`delete from purchases where invoice_id = ${id} and user_id = ${userId}`;
  await tx`delete from party_payments where purchase_invoice_id = ${id} and user_id = ${userId}`;
  await tx`delete from purchase_invoices where id = ${id} and user_id = ${userId}`;
}

export const deletePurchaseInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => validInput(d))
  .handler(async ({ context, data }) => {
    await guard(context.userId, "purchase");
    await withTransaction((tx) => deletePurchaseInvoiceTx(tx, context.userId, data.id));
    return { ok: true as const };
  });

export async function receivePurchaseInvoiceTx(sql: Sql, userId: string, data: ReceiveIn) {
  // ACC-08: stock lock first (a receive can also lower received quantities).
  await lockStock(sql, userId);
  await assertOwned(sql, userId, [["item_categories", data.categoryId]]);
  const header = await sql<{ id: number }>`
    select id from purchase_invoices where id = ${data.id} and user_id = ${userId}
    for update
  `;
  if (!header[0]) throw new Error("فاکتور یافت نشد");
  const lines = await sql<{
    id: number;
    quantity: unknown;
    received_qty: unknown;
    item_id: number | null;
    item_name: string;
    warehouse_name: string;
  }>`
    select id, quantity, received_qty, item_id, item_name, warehouse_name from purchases
    where invoice_id = ${data.id} and user_id = ${userId}
  `;
  const wh = data.warehouseName.trim();
  if (!wh) throw new Error("گدام را انتخاب کنید");
  // ACC-09: each receipt is its own row (quantity, warehouse, date); the
  // line keeps the running total and the latest warehouse only.
  const today = todayIso();
  const wanted =
    data.mode === "full"
      ? lines.map((row) => ({ row, next: num(row.quantity), notes: null as string | null }))
      : data.lines.flatMap((l) => {
          const row = lines.find((x) => x.id === l.id);
          if (!row) return [];
          const prev = row.received_qty == null ? 0 : num(row.received_qty);
          return [{ row, next: Math.min(num(row.quantity), Math.max(0, prev + l.receivedQty)), notes: l.notes }];
        });
  const lowered = wanted.filter((w) => w.next + 1e-9 < (w.row.received_qty == null ? 0 : num(w.row.received_qty)));
  if (lowered.length) {
    await assertReceiptsRemovable(
      sql,
      userId,
      lowered.map((w) => ({
        itemId: w.row.item_id == null ? null : num(w.row.item_id),
        itemName: text(w.row.item_name),
        qty: num(w.row.received_qty) - w.next,
      })),
    );
  }
  for (const w of wanted) {
    const prev = w.row.received_qty == null ? 0 : num(w.row.received_qty);
    const delta = w.next - prev;
    if (delta > 1e-9) {
      await sql`
        insert into purchase_receipts (user_id, purchase_id, quantity, warehouse_name, occurred_on)
        values (${userId}, ${w.row.id}, ${delta}, ${wh}, ${today})
      `;
    } else if (delta < -1e-9) {
      await trimReceipts(sql, userId, w.row.id, -delta);
    }
    await sql`
      update purchases set received_qty = ${w.next},
        warehouse_name = ${delta > 1e-9 ? wh : text(w.row.warehouse_name)},
        notes = coalesce(${w.notes}, notes)
      where id = ${w.row.id} and user_id = ${userId}
    `;
  }
  if (data.categoryId) {
    for (const l of lines) {
      if (l.item_id) {
        await sql`update items set category_id = ${data.categoryId} where id = ${l.item_id} and user_id = ${userId}`;
      }
    }
  }
  const after = await sql<{ quantity: unknown; received_qty: unknown }>`
    select quantity, received_qty from purchases where invoice_id = ${data.id} and user_id = ${userId}
  `;
  const arrived = after.every((l) => num(l.received_qty) + 1e-9 >= num(l.quantity));
  const status: ReceiveStatus = arrived ? "arrived" : "in_transit";
  await sql`
    update purchase_invoices set receive_status = ${status}
    where id = ${data.id} and user_id = ${userId}
  `;
  return { status };
}

export const receivePurchaseInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: ReceiveIn) => validInput(d))
  .handler(async ({ context, data }) =>
    // STR-04: a replayed offline save returns its first result.
    idempotent(context.userId, async () => {
      await guard(context.userId, "purchase");
      // STR-03: line quantities, item categories and the invoice status change together; the invoice row is locked so two partial receives are applied one after the other.
      return withTransaction((sql) => receivePurchaseInvoiceTx(sql, context.userId, data));
    }),
  );

export const listSaleInvoices = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    const headers = await sql<Record<string, unknown>>`
      select i.*, p.name as customer_name, c.symbol as currency_symbol, a.name as account_name
      from sale_invoices i
      left join parties p on p.id = i.customer_id and p.user_id = i.user_id
      join currencies c on c.id = i.currency_id and c.user_id = i.user_id
      left join accounts a on a.id = i.account_id and a.user_id = i.user_id
      where i.user_id = ${context.userId}
      order by i.occurred_on desc, i.id desc
    `;
    const lines = await sql<Record<string, unknown>>`
      select s.*, u.name as unit_name, it.kind as item_kind
      from sales s
      left join units u on u.id = s.unit_id and u.user_id = s.user_id
      left join items it on it.id = s.item_id and it.user_id = s.user_id
      where s.user_id = ${context.userId}
      order by s.line_no, s.id
    `;
    const byInv = new Map<number, Record<string, unknown>[]>();
    for (const l of lines) {
      const id = l.invoice_id == null ? 0 : num(l.invoice_id);
      const arr = byInv.get(id) ?? [];
      arr.push(l);
      byInv.set(id, arr);
    }
    return headers.map((h) => toSaleInvoice(h, byInv.get(num(h.id)) ?? []));
  });

function toSaleInvoice(h: Record<string, unknown>, lineRows: Record<string, unknown>[]): SaleInvoice {
  const rate = num(h.fx_rate) || 1;
  const enabled = Boolean(h.fx_enabled);
  const r = fxRate(enabled, rate, rate);
  const lines = mapLines(lineRows, false);
  const goods = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const goodsBase = goods * r;
  const cash = num(h.cash_included_base);
  const received = num(h.received_amount);
  const recvRate = num(h.received_fx_rate) > 0 ? num(h.received_fx_rate) : r;
  const refund = num(h.refund_amount);
  return {
    id: num(h.id),
    customerId: h.customer_id == null ? null : num(h.customer_id),
    customerName: text(h.customer_name),
    invoiceNo: text(h.invoice_no),
    occurredOn: text(h.occurred_on),
    currencyId: num(h.currency_id),
    currencySymbol: text(h.currency_symbol) || "؋",
    fxEnabled: enabled,
    fxRate: r,
    receivedAmount: received,
    receivedFxRate: recvRate,
    accountId: h.account_id == null ? null : num(h.account_id),
    accountName: text(h.account_name),
    notes: text(h.notes),
    kind: itemKindOf(h.kind),
    closed: h.closed === true || h.closed === "t" || h.closed === "true",
    refundAmount: refund,
    refundAccountId: h.refund_account_id == null ? null : num(h.refund_account_id),
    cashIncludedBase: cash,
    warehouseName: text(h.warehouse_name).trim() || null,
    lines,
    total: goods,
    totalBase: goodsBase + cash,
    remainingBase: goodsBase + cash - received * recvRate + refund,
  };
}

export const saveSaleInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      customerId: number | null;
      occurredOn: string;
      currencyId: number;
      fxEnabled: boolean;
      fxRate: number;
      receivedAmount: number;
      receivedFxRate: number;
      receivedCurrencyId?: number | null;
      accountId: number | null;
      notes: string;
      kind: Item["kind"];
      closed?: boolean;
      refundAmount?: number;
      refundAccountId?: number | null;
      cashPaymentIds?: number[];
      /** گدام فروش؛ undefined = بدون تغییر (ویرایش) / نامشخص (جدید). */
      warehouseName?: string | null;
      lines: LineIn[];
    }) => validInput(d),
  )
  .handler(async ({ context, data }) =>
    // STR-04: a replayed offline save returns its first result.
    idempotent(context.userId, async () => {
      const { sql } = await guard(context.userId, "sales");
      const cleanLines = data.lines.filter((l) => l.itemName.trim() && l.quantity > 0);
      if (!cleanLines.length) throw new Error("حداقل یک ردیف کالا لازم است");
      if (!data.id && data.customerId == null) throw new Error("مشتری را انتخاب کنید");
      await assertOwned(sql, context.userId, [
        ["parties", data.customerId],
        ["accounts", data.accountId],
        ["accounts", data.refundAccountId],
        ["currencies", data.currencyId],
        ["currencies", data.receivedCurrencyId],
        ["sale_invoices", data.id],
        ...(data.cashPaymentIds ?? []).filter((id) => Number(id) > 0).map((id) => ["party_payments", Number(id)] as const),
        ...cleanLines.flatMap((l) => [["items", l.itemId] as const, ["units", l.unitId] as const]),
      ]);
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await withTransaction(async (sql) => {
      // ACC-08: stock lock first, so the check below sees every earlier sale.
      await lockStock(sql, context.userId);
      const account = await requireAccount(sql, context.userId, data.accountId);
      const kind = data.kind === "raw" ? "raw" : "product";
      const inv = await loadInventoryState(sql, context.userId);
      const pool = kind === "raw" ? inv.raw : inv.products;
      const giveBack = new Map<number, number>();
      if (data.id) {
        const old = await sql<{ item_id: number | null; quantity: unknown }>`
          select item_id, quantity from sales where invoice_id = ${data.id} and user_id = ${context.userId}
        `;
        for (const r of old) {
          if (r.item_id == null) continue;
          const idn = num(r.item_id);
          giveBack.set(idn, (giveBack.get(idn) ?? 0) + num(r.quantity));
        }
      }
      const needBy = new Map<number, { name: string; qty: number }>();
      for (const l of cleanLines) {
        if (l.itemId == null) throw new Error("هر ردیف باید از فهرست کالا انتخاب شود");
        const cur = needBy.get(l.itemId) ?? { name: l.itemName, qty: 0 };
        cur.qty += l.quantity;
        needBy.set(l.itemId, cur);
      }
      const short: string[] = [];
      for (const [itemId, n] of needBy) {
        const card = pool.find((c) => c.itemId === itemId);
        const have = (card?.qty ?? 0) + (giveBack.get(itemId) ?? 0);
        if (have + 1e-9 < n.qty) {
          short.push(`${n.name} (موجود ${formatMoney(have)}، لازم ${formatMoney(n.qty)})`);
        }
      }
      if (short.length) {
        throw new Error(
          kind === "raw"
            ? `مواد خام موجود نیست یا موجودی کافی نیست:\n${short.join("\n")}`
            : `کالای تولیدشده موجود نیست یا موجودی کافی نیست:\n${short.join("\n")}`,
        );
      }
      const rate = fxRate(data.fxEnabled, data.fxRate, 1);
      const recvRate = data.receivedFxRate && data.receivedFxRate > 0 ? data.receivedFxRate : account.rateToBase;
      const closed = Boolean(data.closed);
      const catalogs = await loadCatalogs(sql, context.userId);
      const cashIds = [...new Set((data.cashPaymentIds ?? []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
      let cashPreview = 0;
      for (const payId of cashIds) {
        const row = await sql<{ amount: unknown; fx_rate: unknown; currency_id: number }>`
          select amount, fx_rate, currency_id from party_payments
          where id = ${payId} and user_id = ${context.userId} and party_id = ${data.customerId}
            and kind = ${"payment"} and sale_invoice_id is null
            and (applied_sale_id is null or applied_sale_id = ${data.id ?? 0})
        `;
        if (!row[0]) continue;
        const curRate = catalogs.currencies.find((c) => c.id === num(row[0].currency_id))?.rateToBase || 1;
        const payRate = num(row[0].fx_rate) > 0 ? num(row[0].fx_rate) : curRate;
        cashPreview += num(row[0].amount) * payRate;
      }
      const goodsBasePreview = cleanLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) * rate;
      const overPreview = data.receivedAmount * recvRate - (goodsBasePreview + cashPreview);
      const refundPreview = overPreview > 1e-9 ? Math.max(0, data.refundAmount ?? 0) : 0;
      if (refundPreview - Math.max(0, overPreview) > 1e-9) throw new Error("پرداخت باقی‌مانده از مابه‌التفاوت بیشتر است");
      const saleWh =
        data.warehouseName === undefined ? undefined : (data.warehouseName ?? "").trim() || null;
      if (saleWh && saleWh !== MAIN_WAREHOUSE) {
        const whRow = await sql<{ id: number }>`
          select id from warehouses where user_id = ${context.userId} and name = ${saleWh}
        `;
        if (!whRow[0]) throw new Error("گدام انتخاب‌شده یافت نشد");
      }
      let id = data.id;
      let invoiceNo = "";
      if (id) {
        const row = await sql<{ invoice_no: string }>`
          select invoice_no from sale_invoices where id = ${id} and user_id = ${context.userId}
        `;
        if (!row[0]) throw new Error("فاکتور یافت نشد");
        invoiceNo = row[0].invoice_no;
        await sql`
          update sale_invoices set
            customer_id = ${data.customerId}, occurred_on = ${data.occurredOn},
            currency_id = ${data.currencyId}, fx_enabled = ${data.fxEnabled}, fx_rate = ${rate},
            received_amount = ${data.receivedAmount}, received_fx_rate = ${recvRate},
            account_id = ${data.accountId}, notes = ${data.notes},
            kind = ${kind}, closed = ${closed}
          where id = ${id} and user_id = ${context.userId}
        `;
        if (saleWh !== undefined) {
          await sql`update sale_invoices set warehouse_name = ${saleWh} where id = ${id} and user_id = ${context.userId}`;
        }
        await sql`delete from sales where invoice_id = ${id} and user_id = ${context.userId}`;
      } else {
        invoiceNo = await allocInvoiceNo(sql, context.userId, "sale_invoices", "S");
        const rows = await sql<{ id: number }>`
          insert into sale_invoices (
            user_id, customer_id, invoice_no, occurred_on, currency_id, fx_enabled, fx_rate,
            received_amount, received_fx_rate, account_id, notes, kind, closed, warehouse_name
          ) values (
            ${context.userId}, ${data.customerId}, ${invoiceNo}, ${data.occurredOn}, ${data.currencyId},
            ${data.fxEnabled}, ${rate}, ${data.receivedAmount}, ${recvRate}, ${data.accountId}, ${data.notes}, ${kind},
            ${closed}, ${saleWh ?? null}
          ) returning id
        `;
        id = rows[0].id;
      }
      if (!id) throw new Error("فاکتور ذخیره نشد");
      let lineNo = 1;
      for (const l of cleanLines) {
        await sql`
          insert into sales (
            user_id, customer_id, item_id, item_name, quantity, unit_id, unit_price, currency_id,
            account_id, occurred_on, notes, status, invoice_no, invoice_id, line_no
          ) values (
            ${context.userId}, ${data.customerId}, ${l.itemId}, ${l.itemName.trim()}, ${l.quantity},
            ${l.unitId}, ${l.unitPrice}, ${data.currencyId}, ${data.accountId}, ${data.occurredOn},
            ${l.notes ?? ""}, ${"final"}, ${invoiceNo}, ${id}, ${lineNo}
          )
        `;
        lineNo += 1;
      }
      await syncLinkedPayment(sql, {
        userId: context.userId,
        kind: "receipt",
        partyId: data.customerId,
        amount: data.receivedAmount,
        currencyId: data.receivedCurrencyId ?? account.currencyId,
        fxRate: recvRate,
        accountId: data.accountId,
        occurredOn: data.occurredOn,
        saleInvoiceId: id,
        label: `دریافت فاکتور ${invoiceNo}`,
      });
      const goodsBase = cleanLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) * rate;
      let cashBase = 0;
      await sql`update party_payments set applied_sale_id = null where user_id = ${context.userId} and applied_sale_id = ${id}`;
      for (const payId of cashIds) {
        const row = await sql<{ amount: unknown; fx_rate: unknown; currency_id: number }>`
          update party_payments set applied_sale_id = ${id}
          where id = ${payId} and user_id = ${context.userId} and party_id = ${data.customerId}
            and kind = ${"payment"} and sale_invoice_id is null
            and (applied_sale_id is null or applied_sale_id = ${id})
          returning amount, fx_rate, currency_id
        `;
        if (!row[0]) continue;
        const curRate = catalogs.currencies.find((c) => c.id === num(row[0].currency_id))?.rateToBase || 1;
        const payRate = num(row[0].fx_rate) > 0 ? num(row[0].fx_rate) : curRate;
        cashBase += num(row[0].amount) * payRate;
      }
      const receivedBase = data.receivedAmount * recvRate;
      const over = receivedBase - (goodsBase + cashBase);
      let refund = 0;
      let refundAccount: number | null = null;
      if (over > 1e-9) {
        refund = Math.max(0, data.refundAmount ?? 0);
        if (refund - over > 1e-9) throw new Error("پرداخت باقی‌مانده از مابه‌التفاوت بیشتر است");
        if (refund > 1e-9) {
          if (data.refundAccountId == null) throw new Error("دخل افغانی را انتخاب کنید");
          const refundAcc = await requireAccount(sql, context.userId, data.refundAccountId);
          const afn = catalogs.currencies.find((c) => c.symbol === "؋" || c.name === "افغانی");
          if (!afn || refundAcc.currencyId !== afn.id) throw new Error("پرداخت باقی‌مانده فقط از دخل افغانی است");
          const oldRefund = await sql<{ amount: unknown; account_id: number | null }>`
            select amount, account_id from party_payments
            where user_id = ${context.userId} and sale_invoice_id = ${id} and kind = ${"payment"}
          `;
          const oldRefundAccountId = oldRefund[0]?.account_id == null ? null : num(oldRefund[0].account_id);
          const oldRefundAmount = oldRefund[0] ? num(oldRefund[0].amount) : 0;
          await assertCashAvailable(sql, context.userId, {
            accountId: refundAcc.id,
            amount: refund,
            amountRate: 1,
            creditBack: oldRefundAccountId === refundAcc.id ? oldRefundAmount : 0,
          });
          refundAccount = refundAcc.id;
        }
      }
      await syncLinkedPayment(sql, {
        userId: context.userId,
        kind: "payment",
        partyId: data.customerId,
        amount: refund,
        currencyId: catalogs.currencies.find((c) => c.symbol === "؋" || c.name === "افغانی")?.id ?? account.currencyId,
        fxRate: 1,
        accountId: refundAccount,
        occurredOn: data.occurredOn,
        saleInvoiceId: id,
        label: `بازپرداخت فاکتور ${invoiceNo}`,
      });
      await sql`
        update sale_invoices set cash_included_base = ${cashBase}, refund_amount = ${refund}, refund_account_id = ${refundAccount}
        where id = ${id} and user_id = ${context.userId}
      `;
      return { id, invoiceNo };
          });
        } catch (err) {
          if (data.id || attempt === 4 || !isUniqueViolation(err)) throw err;
        }
      }
      throw new Error("فاکتور ذخیره نشد");
    }),
  );

export const deleteSaleInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => validInput(d))
  .handler(async ({ context, data }) => {
    await guard(context.userId, "sales");
    await withTransaction(async (tx) => {
      await tx`update party_payments set applied_sale_id = null where user_id = ${context.userId} and applied_sale_id = ${data.id}`;
      await tx`delete from sales where invoice_id = ${data.id} and user_id = ${context.userId}`;
      await tx`delete from party_payments where sale_invoice_id = ${data.id} and user_id = ${context.userId}`;
      await tx`delete from sale_invoices where id = ${data.id} and user_id = ${context.userId}`;
    });
    return { ok: true as const };
  });

export const listCustomerCashTakes = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customerId: number; invoiceId?: number | null }) => validInput(d))
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    const rows = await sql<Record<string, unknown>>`
      select p.id, p.amount, p.fx_rate, p.occurred_on, p.notes, p.applied_sale_id, c.symbol, c.rate_to_base
      from party_payments p
      join currencies c on c.id = p.currency_id and c.user_id = p.user_id
      where p.user_id = ${context.userId} and p.party_id = ${data.customerId}
        and p.kind = ${"payment"} and p.sale_invoice_id is null
        and (p.applied_sale_id is null or p.applied_sale_id = ${data.invoiceId ?? 0})
      order by p.occurred_on desc, p.id desc
    `;
    return rows.map((r) => {
      const rate = num(r.fx_rate) > 0 ? num(r.fx_rate) : num(r.rate_to_base) || 1;
      const amount = num(r.amount);
      return {
        id: num(r.id),
        amount,
        amountBase: amount * rate,
        occurredOn: text(r.occurred_on),
        notes: text(r.notes),
        currencySymbol: text(r.symbol) || "؋",
        applied: data.invoiceId != null && num(r.applied_sale_id) === data.invoiceId,
      };
    });
  });

export const getWarehouseStock = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    // ACC-10: same breakdown as the dashboard, built from the stock cards.
    const rows = await loadWarehouseStock(sql, context.userId);
    return rows.map((w) => ({ ...w, items: w.items.filter((i) => Math.abs(i.qty) > 1e-9) }));
  });
