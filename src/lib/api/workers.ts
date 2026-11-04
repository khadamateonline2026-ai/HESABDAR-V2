import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { formatMoney, nextInvoiceNo, num, text, todayIso } from "@/lib/format";
import type { Party, WorkerDeliveryLine, WorkerLedger, WorkerModelAgg, WorkerPayment } from "@/lib/types";
import { planDeliveryQtyChange, type PlanDelivery, type PlanOrder } from "@/lib/worker-delivery-plan";
import { assertCashAvailable, getRoleCodes, guard, loadInventoryState, mapParty, sqlOf, wageForProduct, assertAccountantPin } from "./helpers";
import { loadRecurringDues } from "./ops";

export const getWorkerLedger = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<WorkerLedger[]> => {
    const sql = await sqlOf();
    await sql.query("alter table work_deliveries add column if not exists wage_per_unit numeric");
    const [partyRows, orders, payments, wages, dues, deliveryRows] = await Promise.all([
      sql<Record<string, unknown>>`
        select p.*,
          pc.name as category_name,
          jt.name as job_type_name,
          cur.name as currency_name,
          st.name as stage_name
        from parties p
        left join party_categories pc on pc.id = p.category_id
        left join job_types jt on jt.id = p.job_type_id
        left join currencies cur on cur.id = p.currency_id
        left join production_stages st on st.id = p.stage_id
        where p.user_id = ${context.userId} and p.kind = ${"worker"}
        order by p.id
      `,
      sql<Record<string, unknown>>`
        select * from work_orders where user_id = ${context.userId}
      `,
      sql<Record<string, unknown>>`
        select wp.*, a.name as account_name
        from worker_payments wp
        left join accounts a on a.id = wp.account_id
        where wp.user_id = ${context.userId} order by wp.occurred_on desc, wp.id desc
      `,
      sql<Record<string, unknown>>`
        select job_type_id, product_model, wage_per_unit from wage_rates where user_id = ${context.userId}
      `,
      loadRecurringDues(sql, context.userId),
      sql<Record<string, unknown>>`
        select d.id, d.work_order_id, d.quantity, d.occurred_on, d.notes, d.wage_per_unit,
          d.to_worker_id, d.to_work_order_id,
          o.worker_id, o.product_id, o.product_name, o.root_id, o.stage_id,
          tw.name as to_worker_name
        from work_deliveries d
        join work_orders o on o.id = d.work_order_id and o.user_id = d.user_id
        left join parties tw on tw.id = d.to_worker_id
        where d.user_id = ${context.userId}
        order by d.occurred_on desc, d.id desc
      `,
    ]);
    const rates = wages.map((r) => ({
      jobTypeId: num(r.job_type_id),
      productModel: text(r.product_model),
      wagePerUnit: num(r.wage_per_unit),
    }));
    const paysByWorker = new Map<number, WorkerPayment[]>();
    for (const r of payments) {
      const workerId = num(r.worker_id);
      const row: WorkerPayment = {
        id: num(r.id),
        workerId,
        workerName: "",
        amount: num(r.amount),
        occurredOn: text(r.occurred_on),
        notes: text(r.notes),
        invoiceNo: text(r.invoice_no),
        accountId: r.account_id == null ? null : num(r.account_id),
        accountName: text(r.account_name),
      };
      const arr = paysByWorker.get(workerId) ?? [];
      arr.push(row);
      paysByWorker.set(workerId, arr);
    }
    return partyRows.map((row) => {
      const worker: Party = mapParty(row);
      const mine = orders.filter((o) => num(o.worker_id) === worker.id);
      const byProduct = new Map<number, WorkerModelAgg>();
      for (const o of mine) {
        const pid = num(o.product_id);
        const name = text(o.product_name);
        const cur = byProduct.get(pid) ?? {
          productId: pid,
          productName: name,
          qtyOrdered: 0,
          qtyDelivered: 0,
          wagePerUnit: wageForProduct(name, worker.jobTypeId, rates),
          wageTotal: 0,
        };
        cur.qtyOrdered += num(o.quantity);
        cur.qtyDelivered += num(o.delivered_qty);
        cur.wageTotal = cur.qtyDelivered * cur.wagePerUnit;
        byProduct.set(pid, cur);
      }
      const models = [...byProduct.values()];
      const workerPays = (paysByWorker.get(worker.id) ?? []).map((p) => ({ ...p, workerName: worker.name }));
      const paidTotal = workerPays.reduce((s, p) => s + p.amount, 0);
      const deliveries: WorkerDeliveryLine[] = deliveryRows
        .filter((d) => num(d.worker_id) === worker.id)
        .map((d) => {
          const productName = text(d.product_name);
          const quantity = num(d.quantity);
          const wagePerUnit = d.wage_per_unit == null
            ? wageForProduct(productName, worker.jobTypeId, rates)
            : num(d.wage_per_unit);
          const toWorkerId = d.to_worker_id == null ? null : num(d.to_worker_id);
          return {
            id: num(d.id),
            workOrderId: num(d.work_order_id),
            workerId: worker.id,
            rootId: d.root_id == null ? num(d.work_order_id) : num(d.root_id),
            productId: num(d.product_id),
            productName,
            quantity,
            occurredOn: text(d.occurred_on),
            notes: text(d.notes),
            toWorkerId,
            toWorkerName: toWorkerId == null ? "" : text(d.to_worker_name),
            toWorkOrderId: d.to_work_order_id == null ? null : num(d.to_work_order_id),
            toWarehouse: toWorkerId == null,
            stageId: d.stage_id == null ? null : num(d.stage_id),
            wagePerUnit,
            wageTotal: quantity * wagePerUnit,
          };
        });
      for (const model of models) {
        const mine = deliveries.filter((d) => d.productId === model.productId);
        const covered = mine.reduce((s, d) => s + d.quantity, 0);
        const gap = model.qtyDelivered - covered;
        model.wageTotal = mine.reduce((s, d) => s + d.wageTotal, 0);
        if (gap > 1e-9) model.wageTotal += gap * wageForProduct(model.productName, worker.jobTypeId, rates);
        if (model.qtyDelivered > 1e-9) model.wagePerUnit = model.wageTotal / model.qtyDelivered;
      }
      const workTotal = models.reduce((s, m) => s + m.wageTotal, 0);
      if (worker.employment === "salaried") {
        const earned = dues.filter((d) => d.workerId === worker.id).reduce((s, d) => s + d.amount, 0);
        return {
          worker,
          models: [],
          deliveries: [],
          payments: workerPays,
          workTotal: earned,
          paidTotal,
          owed: earned - paidTotal,
        };
      }
      return {
        worker,
        models,
        deliveries,
        payments: workerPays,
        workTotal,
        paidTotal,
        owed: workTotal - paidTotal,
      };
    });
  });

function isoDay(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text(value));
  return match ? match[1] : "";
}

export type WeekDeliveryRow = {
  id: number;
  occurredOn: string;
  workerName: string;
  productName: string;
  quantity: number;
  stageName: string;
};

export const listWeekDeliveries = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<WeekDeliveryRow[]> => {
    const sql = await sqlOf();
    const rows = await sql<Record<string, unknown>>`
      select d.id, d.quantity, d.occurred_on,
        w.name as worker_name,
        o.product_name,
        st.name as stage_name
      from work_deliveries d
      join work_orders o on o.id = d.work_order_id and o.user_id = d.user_id
      left join parties w on w.id = o.worker_id
      left join production_stages st on st.id = o.stage_id
      where d.user_id = ${context.userId}
      order by d.occurred_on desc, d.id desc
    `;
    return rows.map((r) => ({
      id: num(r.id),
      occurredOn: isoDay(r.occurred_on),
      workerName: text(r.worker_name),
      productName: text(r.product_name),
      quantity: num(r.quantity),
      stageName: text(r.stage_name),
    }));
  });

export const saveWorkerPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      workerId: number;
      amount: number;
      occurredOn: string;
      notes: string;
      accountId?: number | null;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "workers");
    if (data.amount <= 0) throw new Error("مبلغ باید بزرگ‌تر از صفر باشد");
    const worker = await sql<{ id: number }>`
      select id from parties
      where id = ${data.workerId} and user_id = ${context.userId} and kind = ${"worker"}
    `;
    if (!worker[0]) throw new Error("کارگر یافت نشد");
    const accountId = data.accountId ?? null;
    let creditBack = 0;
    if (data.id) {
      const old = await sql<{ account_id: number | null; amount: unknown }>`
        select account_id, amount from worker_payments where id = ${data.id} and user_id = ${context.userId}
      `;
      if (old[0] && old[0].account_id != null && accountId === num(old[0].account_id)) {
        creditBack = num(old[0].amount);
      }
    }
    await assertCashAvailable(sql, context.userId, {
      accountId,
      amount: data.amount,
      amountRate: 1,
      creditBack,
    });
    if (data.id) {
      await sql`
        update worker_payments set
          amount = ${data.amount}, occurred_on = ${data.occurredOn}, notes = ${data.notes}, account_id = ${accountId}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const existing = await sql<{ invoice_no: string }>`
      select invoice_no from worker_payments where user_id = ${context.userId}
    `;
    const invoiceNo = nextInvoiceNo(
      existing.map((r) => text(r.invoice_no)),
      "WP",
    );
    const rows = await sql<{ id: number }>`
      insert into worker_payments (user_id, worker_id, amount, occurred_on, notes, invoice_no, account_id)
      values (
        ${context.userId}, ${data.workerId}, ${data.amount}, ${data.occurredOn}, ${data.notes}, ${invoiceNo}, ${accountId}
      )
      returning id
    `;
    return { id: rows[0].id };
  });

const EPS = 1e-6;

type DeliveryHead = {
  id: number;
  quantity: number;
  occurredOn: string;
  notes: string;
  toWorkerId: number | null;
  toWorkOrderId: number | null;
  toWarehouse: boolean;
  workOrderId: number;
  rootId: number;
  productId: number;
  workerId: number | null;
  stageId: number | null;
};

async function loadDeliveryHead(
  sql: Awaited<ReturnType<typeof sqlOf>>,
  userId: string,
  id: number,
): Promise<DeliveryHead | null> {
  const rows = await sql<Record<string, unknown>>`
    select d.id, d.quantity, d.occurred_on, d.notes, d.to_worker_id, d.to_work_order_id, d.work_order_id,
      o.root_id, o.product_id, o.worker_id, o.stage_id
    from work_deliveries d
    join work_orders o on o.id = d.work_order_id and o.user_id = d.user_id
    where d.id = ${id} and d.user_id = ${userId}
  `;
  const r = rows[0];
  if (!r) return null;
  const toWorkerId = r.to_worker_id == null ? null : num(r.to_worker_id);
  const workOrderId = num(r.work_order_id);
  return {
    id: num(r.id),
    quantity: num(r.quantity),
    occurredOn: text(r.occurred_on),
    notes: text(r.notes),
    toWorkerId,
    toWorkOrderId: r.to_work_order_id == null ? null : num(r.to_work_order_id),
    toWarehouse: toWorkerId == null,
    workOrderId,
    rootId: r.root_id == null ? workOrderId : num(r.root_id),
    productId: num(r.product_id),
    workerId: r.worker_id == null ? null : num(r.worker_id),
    stageId: r.stage_id == null ? null : num(r.stage_id),
  };
}

async function loadRootBundle(sql: Awaited<ReturnType<typeof sqlOf>>, userId: string, rootId: number) {
  const orderRows = await sql<Record<string, unknown>>`
    select id, quantity, delivered_qty
    from work_orders
    where user_id = ${userId} and (id = ${rootId} or root_id = ${rootId})
  `;
  const deliveryRows = await sql<Record<string, unknown>>`
    select d.id, d.work_order_id, d.quantity, d.to_worker_id, d.to_work_order_id
    from work_deliveries d
    where d.user_id = ${userId}
      and d.work_order_id in (
        select id from work_orders where user_id = ${userId} and (id = ${rootId} or root_id = ${rootId})
      )
  `;
  const orders: PlanOrder[] = orderRows.map((o) => ({
    id: num(o.id),
    quantity: num(o.quantity),
    delivered: num(o.delivered_qty),
  }));
  const deliveries: PlanDelivery[] = deliveryRows.map((d) => ({
    id: num(d.id),
    workOrderId: num(d.work_order_id),
    quantity: num(d.quantity),
    toWorkOrderId: d.to_work_order_id == null ? null : num(d.to_work_order_id),
    toWarehouse: d.to_worker_id == null,
  }));
  return { orders, deliveries };
}

async function applyDeliveryPlan(
  sql: Awaited<ReturnType<typeof sqlOf>>,
  userId: string,
  rootId: number,
  productId: number,
  before: { orders: PlanOrder[]; deliveries: PlanDelivery[] },
  after: { orders: PlanOrder[]; deliveries: PlanDelivery[] },
) {
  const oldOrders = new Map(before.orders.map((o) => [o.id, o]));
  const oldDels = new Map(before.deliveries.map((d) => [d.id, d]));
  const rootBefore = oldOrders.get(rootId);
  const rootAfter = after.orders.find((o) => o.id === rootId);
  const qtyDelta = (rootAfter?.quantity ?? 0) - (rootBefore?.quantity ?? 0);
  let productDelta = 0;
  for (const row of after.deliveries) {
    const prev = oldDels.get(row.id);
    if (!prev?.toWarehouse) continue;
    productDelta += row.quantity - prev.quantity;
  }
  if (qtyDelta > EPS || productDelta < -EPS) {
    const inv = await loadInventoryState(sql, userId);
    if (qtyDelta > EPS) {
      const bom = await sql<{ raw_item_id: number; quantity: unknown; name: string }>`
        select b.raw_item_id, b.quantity, i.name
        from bom_lines b
        join items i on i.id = b.raw_item_id
        where b.product_id = ${productId} and b.user_id = ${userId}
      `;
      const short: string[] = [];
      for (const line of bom) {
        const need = num(line.quantity) * qtyDelta;
        const have = inv.raw.find((r) => r.itemId === num(line.raw_item_id))?.qty ?? 0;
        if (have + EPS < need) {
          short.push(`${text(line.name)} (موجود ${formatMoney(have)}، لازم ${formatMoney(need)})`);
        }
      }
      if (short.length) throw new Error(`موجودی مواد خام کافی نیست:\n${short.join("\n")}`);
    }
    if (productDelta < -EPS) {
      const have = inv.products.find((p) => p.itemId === productId)?.qty ?? 0;
      const drop = -productDelta;
      if (have + EPS < drop) {
        throw new Error(`موجودی گدام محصول کافی نیست (موجود ${formatMoney(have)}، کم‌شونده ${formatMoney(drop)})`);
      }
    }
  }

  const dropDeliveries = after.deliveries.filter((d) => {
    const prev = oldDels.get(d.id);
    return prev != null && d.quantity <= EPS && Math.abs(prev.quantity - d.quantity) > EPS;
  });
  const keepDeliveries = after.deliveries.filter((d) => {
    const prev = oldDels.get(d.id);
    return prev != null && d.quantity > EPS && Math.abs(prev.quantity - d.quantity) > EPS;
  });
  const dropOrders = after.orders.filter((o) => {
    const prev = oldOrders.get(o.id);
    if (!prev) return false;
    const changed = Math.abs(prev.quantity - o.quantity) > EPS || Math.abs(prev.delivered - o.delivered) > EPS;
    return changed && o.quantity <= EPS && o.delivered <= EPS;
  });
  const keepOrders = after.orders.filter((o) => {
    const prev = oldOrders.get(o.id);
    if (!prev) return false;
    const changed = Math.abs(prev.quantity - o.quantity) > EPS || Math.abs(prev.delivered - o.delivered) > EPS;
    return changed && !(o.quantity <= EPS && o.delivered <= EPS);
  });

  for (const d of dropDeliveries) {
    await sql`delete from work_deliveries where id = ${d.id} and user_id = ${userId}`;
  }
  for (const d of keepDeliveries) {
    await sql`
      update work_deliveries set quantity = ${d.quantity}
      where id = ${d.id} and user_id = ${userId}
    `;
  }
  for (const o of keepOrders) {
    await sql`
      update work_orders set quantity = ${o.quantity}, delivered_qty = ${o.delivered}
      where id = ${o.id} and user_id = ${userId}
    `;
  }
  const rootDropped = dropOrders.some((o) => o.id === rootId);
  if (!rootDropped && rootAfter && Math.abs(qtyDelta) > EPS) {
    const existing = await sql<{ raw_item_id: number; raw_item_name: string; qty_per_unit: unknown }>`
      select raw_item_id, raw_item_name, qty_per_unit
      from work_order_alloc
      where work_order_id = ${rootId} and user_id = ${userId}
      order by id
    `;
    if (existing.length) {
      for (const line of existing) {
        const per = num(line.qty_per_unit);
        await sql`
          update work_order_alloc
          set allocated_qty = ${per * rootAfter.quantity}
          where work_order_id = ${rootId} and user_id = ${userId} and raw_item_id = ${num(line.raw_item_id)}
        `;
      }
    } else {
      const bom = await sql<{ raw_item_id: number; quantity: unknown; name: string }>`
        select b.raw_item_id, b.quantity, i.name
        from bom_lines b
        join items i on i.id = b.raw_item_id
        where b.product_id = ${productId} and b.user_id = ${userId}
      `;
      for (const line of bom) {
        const per = num(line.quantity);
        await sql`
          insert into work_order_alloc (
            user_id, work_order_id, raw_item_id, raw_item_name, qty_per_unit, allocated_qty
          ) values (
            ${userId}, ${rootId}, ${num(line.raw_item_id)}, ${text(line.name)}, ${per}, ${per * rootAfter.quantity}
          )
        `;
      }
    }
  }
  for (const o of dropOrders) {
    await sql`delete from work_order_alloc where work_order_id = ${o.id} and user_id = ${userId}`;
    await sql`delete from work_deliveries where work_order_id = ${o.id} and user_id = ${userId}`;
    await sql`delete from work_deliveries where to_work_order_id = ${o.id} and user_id = ${userId}`;
    await sql`delete from work_orders where id = ${o.id} and user_id = ${userId}`;
  }
}

async function assertContractOrder(
  sql: Awaited<ReturnType<typeof sqlOf>>,
  userId: string,
  workerId: number | null,
) {
  if (workerId == null) return;
  const w = await sql<{ employment: string | null }>`
    select employment from parties where id = ${workerId} and user_id = ${userId} and kind = ${"worker"}
  `;
  if (w[0] && text(w[0].employment) === "salaried") {
    throw new Error("این ویرایش فقط برای کارگر کانتراتی است");
  }
}

export const updateWorkerDelivery = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id: number;
      quantity: number;
      occurredOn: string;
      toWorkerId?: number | null;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "workers");
    if (!data.occurredOn) throw new Error("تاریخ را وارد کنید");
    if (data.quantity <= EPS) throw new Error("تعداد تحویل باید بزرگ‌تر از صفر باشد");
    const head = await loadDeliveryHead(sql, context.userId, data.id);
    if (!head) throw new Error("ردیف تحویل یافت نشد");
    await assertContractOrder(sql, context.userId, head.workerId);
    const before = await loadRootBundle(sql, context.userId, head.rootId);
    const after = planDeliveryQtyChange(before.orders, before.deliveries, head.rootId, head.id, data.quantity);
    await applyDeliveryPlan(sql, context.userId, head.rootId, head.productId, before, after);
    const still = await loadDeliveryHead(sql, context.userId, head.id);
    if (!still) return { ok: true as const };
    await sql`
      update work_deliveries set occurred_on = ${data.occurredOn}
      where id = ${still.id} and user_id = ${context.userId}
    `;
    if (still.toWarehouse) {
      if (data.toWorkerId != null) throw new Error("تحویل به گدام را نمی‌توان به کارگر منتقل کرد");
      return { ok: true as const };
    }
    const nextId = data.toWorkerId === undefined ? still.toWorkerId : data.toWorkerId;
    if (nextId == null) throw new Error("کارگر مرحله بعد را انتخاب کنید");
    if (nextId === still.toWorkerId) return { ok: true as const };
    await reassignDeliveryWorker(sql, context.userId, still, nextId);
    return { ok: true as const };
  });

async function reassignDeliveryWorker(
  sql: Awaited<ReturnType<typeof sqlOf>>,
  userId: string,
  head: DeliveryHead,
  toWorkerId: number,
) {
  if (head.toWorkOrderId == null) throw new Error("سفارش مرحله بعد یافت نشد");
  if (toWorkerId === head.workerId) throw new Error("نمی‌توان به همان کارگر تحویل داد");
  const target = await sql<{ id: number; stage_id: number | null; employment: string | null; name: string }>`
    select id, stage_id, employment, name from parties
    where id = ${toWorkerId} and user_id = ${userId} and kind = ${"worker"}
  `;
  if (!target[0]) throw new Error("کارگر یافت نشد");
  if (text(target[0].employment) === "salaried") throw new Error("تحویل فقط به کارگر کانتراتی است");
  const targetStage = target[0].stage_id == null ? null : num(target[0].stage_id);
  const clash = await sql<{ id: number }>`
    select id from work_orders
    where user_id = ${userId} and root_id = ${head.rootId}
      and worker_id = ${toWorkerId} and product_id = ${head.productId}
      and id <> ${head.toWorkOrderId}
    limit 1
  `;
  if (clash[0]) throw new Error("این کارگر از قبل همین مدل را در این سفارش دارد");
  await sql`
    update work_orders set worker_id = ${toWorkerId}, stage_id = ${targetStage}
    where id = ${head.toWorkOrderId} and user_id = ${userId}
  `;
  await sql`
    update work_deliveries set to_worker_id = ${toWorkerId}
    where user_id = ${userId} and to_work_order_id = ${head.toWorkOrderId}
  `;
}

export const deleteWorkerDelivery = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "workers");
    const head = await loadDeliveryHead(sql, context.userId, data.id);
    if (!head) throw new Error("ردیف تحویل یافت نشد");
    await assertContractOrder(sql, context.userId, head.workerId);
    const before = await loadRootBundle(sql, context.userId, head.rootId);
    const after = planDeliveryQtyChange(before.orders, before.deliveries, head.rootId, head.id, 0);
    await applyDeliveryPlan(sql, context.userId, head.rootId, head.productId, before, after);
    return { ok: true as const };
  });

export const deleteWorkerPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "workers");
    const rows = await sql<{ id: number; worker_id: number }>`
      select id, worker_id from worker_payments where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!rows[0]) throw new Error("پرداختی یافت نشد");
    const worker = await sql<{ employment: string | null }>`
      select employment from parties where id = ${rows[0].worker_id} and user_id = ${context.userId}
    `;
    if (worker[0] && text(worker[0].employment) === "salaried") {
      throw new Error("حذف پرداختی کارگر ثابت از اینجا انجام نمی‌شود");
    }
    await sql`delete from worker_payments where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const resetWorkerAccounts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { code: string; workerIds: number[] }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "workers");
    const codes = await getRoleCodes(sql, context.userId);
    assertAccountantPin(codes, data.code);
    const wanted = [...new Set(data.workerIds.filter((id) => Number.isFinite(id) && id > 0))];
    if (!wanted.length) throw new Error("کارگر را انتخاب کنید");
    const valid: number[] = [];
    for (const id of wanted) {
      const row = await sql<{ id: number }>`
        select id from parties
        where id = ${id} and user_id = ${context.userId} and kind = ${"worker"}
      `;
      if (row[0]) valid.push(row[0].id);
    }
    if (!valid.length) throw new Error("کارگر یافت نشد");

    for (const workerId of valid) {
      await sql`
        delete from worker_payments where user_id = ${context.userId} and worker_id = ${workerId}
      `;
      const orders = await sql<{ id: number }>`
        select id from work_orders where user_id = ${context.userId} and worker_id = ${workerId}
      `;
      for (const o of orders) {
        await sql`delete from work_order_alloc where user_id = ${context.userId} and work_order_id = ${o.id}`;
        await sql`delete from work_deliveries where user_id = ${context.userId} and work_order_id = ${o.id}`;
        await sql`delete from work_deliveries where user_id = ${context.userId} and to_work_order_id = ${o.id}`;
        await sql`delete from work_orders where id = ${o.id} and user_id = ${context.userId}`;
      }
      const recs = await sql<{ id: number }>`
        select id from recurring_expenses where user_id = ${context.userId} and worker_id = ${workerId}
      `;
      for (const rec of recs) {
        await sql`delete from recurring_periods where user_id = ${context.userId} and recurring_id = ${rec.id}`;
        await sql`
          update recurring_expenses set start_on = ${todayIso()}
          where id = ${rec.id} and user_id = ${context.userId}
        `;
      }
    }
    return { ok: true as const, count: valid.length };
  });
