import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { formatMoney, nextInvoiceNo, num, text } from "@/lib/format";
import type { InventoryData, ProductionStage, WorkOrder } from "@/lib/types";
import { isLastStage } from "@/lib/types";
import { loadInventoryState, requireWriteAny, sqlOf, assertUniqueItemName, getRoleCodes, wageForProduct, assertAccountantPin } from "./helpers";
import { encodeUsageError, type UsageFocus } from "@/lib/usage-focus";

async function snapshotWage(
  sql: Awaited<ReturnType<typeof sqlOf>>,
  userId: string,
  workerId: number | null,
  productName: string,
): Promise<number> {
  const worker = workerId == null
    ? []
    : await sql<{ job_type_id: number | null }>`
        select job_type_id from parties where id = ${workerId} and user_id = ${userId}
      `;
  const rates = await sql<{ job_type_id: number; product_model: string; wage_per_unit: unknown }>`
    select job_type_id, product_model, wage_per_unit from wage_rates where user_id = ${userId}
  `;
  return wageForProduct(
    productName,
    worker[0]?.job_type_id == null ? null : num(worker[0].job_type_id),
    rates.map((r) => ({
      jobTypeId: num(r.job_type_id),
      productModel: text(r.product_model),
      wagePerUnit: num(r.wage_per_unit),
    })),
  );
}

export const getInventory = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<InventoryData> => {
    const sql = await sqlOf();
    return loadInventoryState(sql, context.userId);
  });

async function recipeForOrder(
  sql: Awaited<ReturnType<typeof sqlOf>>,
  userId: string,
  rootId: number,
  productId: number,
) {
  const snap = await sql<{ raw_item_id: number; qty_per_unit: unknown; raw_item_name: string }>`
    select raw_item_id, qty_per_unit, raw_item_name
    from work_order_alloc
    where work_order_id = ${rootId} and user_id = ${userId}
    order by id
  `;
  if (snap.length) {
    return snap.map((line) => ({
      rawItemId: num(line.raw_item_id),
      name: text(line.raw_item_name),
      quantity: num(line.qty_per_unit),
    }));
  }
  const bom = await sql<{ raw_item_id: number; quantity: unknown; name: string }>`
    select b.raw_item_id, b.quantity, i.name
    from bom_lines b
    join items i on i.id = b.raw_item_id
    where b.product_id = ${productId} and b.user_id = ${userId}
  `;
  return bom.map((line) => ({
    rawItemId: num(line.raw_item_id),
    name: text(line.name),
    quantity: num(line.quantity),
  }));
}

export const saveCatalogItem = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      kind: "product" | "raw";
      name: string;
      categoryId: number | null;
      unitId: number | null;
      minQty: number;
      salePrice?: number;
      purchasePrice?: number;
      image?: string | null;
      notes?: string;
      bom?: { rawItemId: number; quantity: number }[];
      overheads?: { title: string; amount: number }[];
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["warehouses", "purchase", "sales"]);
    const name = data.name.trim();
    if (!name) throw new Error("نام لازم است");
    const kind = data.kind === "raw" ? "raw" : "product";
    const minQty = Math.max(0, data.minQty);
    const salePrice = Math.max(0, data.salePrice ?? 0);
    const purchasePrice = Math.max(0, data.purchasePrice ?? 0);
    const notes = (data.notes ?? "").trim();
    const bom = data.bom ?? [];
    if (kind === "product") {
      const seen = new Set<number>();
      for (const line of bom) {
        if (line.quantity <= 0) throw new Error("مقدار مواد خام در فرمول باید بزرگ‌تر از صفر باشد");
        if (seen.has(line.rawItemId)) throw new Error("هر ماده خام فقط یک‌بار در فرمول می‌تواند باشد");
        seen.add(line.rawItemId);
      }
    }
    let id = data.id;
    await assertUniqueItemName(sql, context.userId, name, kind, id);
    if (id) {
      const row = await sql<{ id: number }>`
        select id from items where id = ${id} and user_id = ${context.userId}
      `;
      if (!row[0]) throw new Error("کالا یافت نشد");
      if (data.image === undefined) {
        await sql`
          update items set
            name = ${name}, kind = ${kind}, category_id = ${data.categoryId},
            unit_id = ${data.unitId}, min_qty = ${minQty}, sale_price = ${salePrice},
            purchase_price = ${purchasePrice}, notes = ${notes}
          where id = ${id} and user_id = ${context.userId}
        `;
      } else {
        await sql`
          update items set
            name = ${name}, kind = ${kind}, category_id = ${data.categoryId},
            unit_id = ${data.unitId}, min_qty = ${minQty}, sale_price = ${salePrice},
            purchase_price = ${purchasePrice}, image = ${data.image}, notes = ${notes}
          where id = ${id} and user_id = ${context.userId}
        `;
      }
    } else {
      const rows = await sql<{ id: number }>`
        insert into items (user_id, name, kind, category_id, unit_id, min_qty, sale_price, purchase_price, image, notes)
        values (
          ${context.userId}, ${name}, ${kind}, ${data.categoryId}, ${data.unitId}, ${minQty}, ${salePrice},
          ${purchasePrice}, ${data.image ?? null}, ${notes}
        )
        returning id
      `;
      id = rows[0].id;
    }
    if (kind === "product") {
      await sql`delete from bom_lines where product_id = ${id} and user_id = ${context.userId}`;
      for (const line of bom) {
        const raw = await sql<{ id: number; kind: string }>`
          select id, kind from items where id = ${line.rawItemId} and user_id = ${context.userId}
        `;
        if (!raw[0] || raw[0].kind !== "raw") throw new Error("ماده خام نامعتبر است");
        await sql`
          insert into bom_lines (user_id, product_id, raw_item_id, quantity)
          values (${context.userId}, ${id}, ${line.rawItemId}, ${line.quantity})
        `;
      }
      await sql`delete from item_overheads where item_id = ${id} and user_id = ${context.userId}`;
      for (const row of data.overheads ?? []) {
        const title = row.title.trim();
        const amount = Math.max(0, row.amount);
        if (!title || amount <= 0) continue;
        await sql`
          insert into item_overheads (user_id, item_id, title, amount)
          values (${context.userId}, ${id}, ${title}, ${amount})
        `;
      }
    }
    return { id };
  });

async function findItemUsage(
  sql: Awaited<ReturnType<typeof sqlOf>>,
  userId: string,
  itemId: number,
  itemName: string,
): Promise<UsageFocus | null> {
  const purchase = await sql<{ id: number | null; receive_status: string | null }>`
    select i.id, i.receive_status
    from purchases p
    left join purchase_invoices i on i.id = p.invoice_id and i.user_id = p.user_id
    where p.user_id = ${userId} and p.item_id = ${itemId}
    order by p.id desc
    limit 1
  `;
  if (purchase[0]) {
    return {
      page: "purchase",
      path: "/purchase",
      invoiceId: purchase[0].id == null ? undefined : num(purchase[0].id),
      tab: purchase[0].receive_status === "arrived" ? "arrived" : "in_transit",
    };
  }
  const sale = await sql<{ id: number | null; kind: string | null }>`
    select i.id, i.kind
    from sales s
    left join sale_invoices i on i.id = s.invoice_id and i.user_id = s.user_id
    where s.user_id = ${userId} and s.item_id = ${itemId}
    order by s.id desc
    limit 1
  `;
  if (sale[0]) {
    return {
      page: "sales",
      path: "/sales",
      invoiceId: sale[0].id == null ? undefined : num(sale[0].id),
      tab: sale[0].kind === "raw" ? "raw" : "product",
    };
  }
  const bom = await sql<{ product_id: number; name: string }>`
    select b.product_id, it.name
    from bom_lines b
    join items it on it.id = b.product_id
    where b.user_id = ${userId} and b.raw_item_id = ${itemId}
    order by b.id desc
    limit 1
  `;
  if (bom[0]) {
    return {
      page: "warehouses",
      path: "/warehouses",
      tab: "product",
      itemId: num(bom[0].product_id),
      query: text(bom[0].name),
    };
  }
  const order = await sql<{ id: number; name: string }>`
    select o.id, it.name
    from work_orders o
    join items it on it.id = o.product_id
    where o.user_id = ${userId} and o.product_id = ${itemId}
    order by o.id desc
    limit 1
  `;
  if (order[0]) {
    return {
      page: "warehouses",
      path: "/warehouses",
      tab: "worker",
      orderId: num(order[0].id),
      query: text(order[0].name),
    };
  }
  const alloc = await sql<{ work_order_id: number; name: string }>`
    select a.work_order_id, coalesce(it.name, a.raw_item_name) as name
    from work_order_alloc a
    left join items it on it.id = a.raw_item_id
    where a.user_id = ${userId} and a.raw_item_id = ${itemId}
    order by a.id desc
    limit 1
  `;
  if (alloc[0]) {
    return {
      page: "warehouses",
      path: "/warehouses",
      tab: "worker",
      orderId: num(alloc[0].work_order_id),
      itemId,
      query: text(alloc[0].name),
    };
  }
  const opening = await sql<{ kind: string }>`
    select kind from opening_stock
    where user_id = ${userId} and item_name = ${itemName}
    order by id desc
    limit 1
  `;
  if (opening[0]) {
    return {
      page: "opening",
      path: "/finance/opening",
      tab: opening[0].kind === "raw" ? "raw" : "finished",
      query: itemName,
    };
  }
  return null;
}

export const deleteCatalogItem = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["warehouses"]);
    const item = await sql<{ id: number; name: string }>`
      select id, name from items where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!item[0]) throw new Error("کالا یافت نشد");
    const usage = await findItemUsage(sql, context.userId, data.id, item[0].name);
    if (usage) throw encodeUsageError(usage);
    await sql`delete from bom_lines where product_id = ${data.id} and user_id = ${context.userId}`;
    await sql`delete from items where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const patchItemImage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; image: string | null }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["warehouses", "purchase", "sales"]);
    await sql`
      update items set image = ${data.image}
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const listWorkOrders = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<WorkOrder[]> => {
    const sql = await sqlOf();
    const [rows, stageRows] = await Promise.all([
      sql<Record<string, unknown>>`
        select o.*, p.name as worker_name, st.name as stage_name
        from work_orders o
        left join parties p on p.id = o.worker_id
        left join production_stages st on st.id = o.stage_id
        where o.user_id = ${context.userId}
        order by o.occurred_on desc, o.id desc
      `,
      sql<Record<string, unknown>>`
        select * from production_stages where user_id = ${context.userId} order by sort_order, id
      `,
    ]);
    const stages: ProductionStage[] = stageRows.map((s) => ({
      id: num(s.id),
      name: text(s.name),
      sortOrder: num(s.sort_order),
    }));
    return rows.map((r) => {
      const qty = num(r.quantity);
      const delivered = num(r.delivered_qty);
      const stageId = r.stage_id == null ? null : num(r.stage_id);
      const rootId = r.root_id == null ? null : num(r.root_id);
      return {
        id: num(r.id),
        workerId: r.worker_id == null ? null : num(r.worker_id),
        workerName: text(r.worker_name),
        productId: num(r.product_id),
        productName: text(r.product_name),
        quantity: qty,
        deliveredQty: delivered,
        remaining: Math.max(0, qty - delivered),
        occurredOn: text(r.occurred_on),
        notes: text(r.notes),
        invoiceNo: text(r.invoice_no) || `W-${num(r.id)}`,
        stageId,
        stageName: text(r.stage_name),
        rootId,
        isLastStage: isLastStage(stages, stageId),
      };
    });
  });

async function workerStageId(
  sql: Awaited<ReturnType<typeof sqlOf>>,
  userId: string,
  workerId: number | null,
): Promise<number | null> {
  if (workerId == null) return null;
  const row = await sql<{ stage_id: number | null }>`
    select stage_id from parties where id = ${workerId} and user_id = ${userId} and kind = ${"worker"}
  `;
  return row[0]?.stage_id == null ? null : num(row[0].stage_id);
}

export const createWorkOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: { workerId: number | null; productId: number; quantity: number; occurredOn: string; notes: string; invoiceNo?: string }) => d,
  )
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["warehouses", "workers"]);
    if (data.quantity <= 0) throw new Error("تعداد سفارش باید بزرگ‌تر از صفر باشد");
    const product = await sql<{ id: number; name: string; kind: string }>`
      select id, name, kind from items where id = ${data.productId} and user_id = ${context.userId}
    `;
    if (!product[0] || product[0].kind !== "product") throw new Error("کالا یافت نشد");
    const stageId = await workerStageId(sql, context.userId, data.workerId);
    if (data.workerId != null) {
      const w = await sql<{ employment: string | null }>`
        select employment from parties where id = ${data.workerId} and user_id = ${context.userId}
      `;
      if (w[0] && text(w[0].employment) === "salaried") {
        throw new Error("سفارش تولید فقط به کارگر کانتراتی داده می‌شود");
      }
    }
    const bom = await sql<{ raw_item_id: number; quantity: unknown; name: string }>`
      select b.raw_item_id, b.quantity, i.name
      from bom_lines b
      join items i on i.id = b.raw_item_id
      where b.product_id = ${data.productId} and b.user_id = ${context.userId}
    `;
    if (!bom.length) throw new Error("فرمول مواد خام این کالا ثبت نشده است");
    const inv = await loadInventoryState(sql, context.userId);
    const short: string[] = [];
    for (const line of bom) {
      const need = num(line.quantity) * data.quantity;
      const have = inv.raw.find((r) => r.itemId === num(line.raw_item_id))?.qty ?? 0;
      if (have + 1e-9 < need) {
        short.push(`${text(line.name)} (موجود ${formatMoney(have)}، لازم ${formatMoney(need)})`);
      }
    }
    if (short.length) throw new Error(`موجودی مواد خام کافی نیست:\n${short.join("\n")}`);
    const existingNos = await sql<{ invoice_no: string | null }>`
      select invoice_no from work_orders where user_id = ${context.userId}
    `;
    const invoiceNo = (data.invoiceNo || "").trim() || nextInvoiceNo(
      existingNos.map((r) => text(r.invoice_no)),
      "W",
    );
    const rows = await sql<{ id: number }>`
      insert into work_orders (
        user_id, worker_id, product_id, product_name, quantity, delivered_qty, occurred_on, notes, invoice_no, stage_id
      ) values (
        ${context.userId}, ${data.workerId}, ${data.productId}, ${product[0].name}, ${data.quantity},
        ${0}, ${data.occurredOn}, ${data.notes}, ${invoiceNo}, ${stageId}
      )
      returning id
    `;
    const id = rows[0].id;
    await sql`update work_orders set root_id = ${id} where id = ${id} and user_id = ${context.userId}`;
    for (const line of bom) {
      const per = num(line.quantity);
      await sql`
        insert into work_order_alloc (
          user_id, work_order_id, raw_item_id, raw_item_name, qty_per_unit, allocated_qty
        ) values (
          ${context.userId}, ${id}, ${num(line.raw_item_id)}, ${text(line.name)}, ${per},
          ${per * data.quantity}
        )
      `;
    }
    return { id };
  });

export const listPriorProductGivers = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { workerId: number; productId: number }) => d)
  .handler(async ({ context, data }): Promise<number[]> => {
    const sql = await sqlOf();
    const rows = await sql<{ worker_id: number }>`
      select distinct o.worker_id
      from work_deliveries d
      join work_orders o on o.id = d.work_order_id and o.user_id = d.user_id
      where d.user_id = ${context.userId}
        and d.to_worker_id = ${data.workerId}
        and o.product_id = ${data.productId}
        and o.worker_id is not null
    `;
    return rows.map((r) => num(r.worker_id));
  });

export const deliverWorkOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id: number;
      quantity: number;
      occurredOn: string;
      notes: string;
      toWorkerId?: number | null;
      toWarehouse?: boolean;
      invoiceNo?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["warehouses", "workers"]);
    if (data.quantity <= 0) throw new Error("تعداد تحویل باید بزرگ‌تر از صفر باشد");
    const order = await sql<{
      id: number;
      quantity: unknown;
      delivered_qty: unknown;
      product_id: number;
      product_name: string;
      worker_id: number | null;
      stage_id: number | null;
      root_id: number | null;
    }>`
      select id, quantity, delivered_qty, product_id, product_name, worker_id, stage_id, root_id
      from work_orders where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!order[0]) throw new Error("سفارش یافت نشد");
    await sql.query("alter table work_deliveries add column if not exists wage_per_unit numeric");
    const wage = await snapshotWage(
      sql,
      context.userId,
      order[0].worker_id == null ? null : num(order[0].worker_id),
      text(order[0].product_name),
    );
    const remaining = num(order[0].quantity) - num(order[0].delivered_qty);
    if (data.quantity - remaining > 1e-9) {
      throw new Error(`بیش از باقی‌مانده سفارش (${formatMoney(remaining)}) نمی‌توان تحویل داد`);
    }
    const rootId = order[0].root_id == null ? num(order[0].id) : num(order[0].root_id);
    const weekNo = (data.invoiceNo || "").trim();
    if (weekNo) {
      await sql`
        update work_orders set invoice_no = ${weekNo}
        where id = ${data.id} and user_id = ${context.userId}
      `;
    }

    if (data.toWarehouse) {
      const bomLines = await recipeForOrder(sql, context.userId, rootId, num(order[0].product_id));
      const inv = await loadInventoryState(sql, context.userId);
      const short: string[] = [];
      for (const line of bomLines) {
        const need = line.quantity * data.quantity;
        const have = inv.workerRaw.find((r) => r.itemId === line.rawItemId)?.qty ?? 0;
        if (have + 1e-9 < need) {
          short.push(`${line.name} (موجود ${formatMoney(have)}، لازم ${formatMoney(need)})`);
        }
      }
      if (short.length) throw new Error(`موجودی مواد نزد کارگران کافی نیست:\n${short.join("\n")}`);
      await sql`
        insert into work_deliveries (
          user_id, work_order_id, quantity, occurred_on, notes, to_worker_id, to_work_order_id, wage_per_unit
        ) values (
          ${context.userId}, ${data.id}, ${data.quantity}, ${data.occurredOn}, ${data.notes}, ${null}, ${null}, ${wage}
        )
      `;
      await sql`
        update work_orders set delivered_qty = delivered_qty + ${data.quantity}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { ok: true as const, toWarehouse: true as const };
    }

    const toWorkerId = data.toWorkerId ?? null;
    if (toWorkerId == null) throw new Error("کارگر مرحله بعد را انتخاب کنید");
    if (toWorkerId === (order[0].worker_id == null ? null : num(order[0].worker_id))) {
      throw new Error("نمی‌توان به همان کارگر تحویل داد");
    }
    const target = await sql<{ id: number; stage_id: number | null; name: string; employment: string | null }>`
      select id, stage_id, name, employment from parties
      where id = ${toWorkerId} and user_id = ${context.userId} and kind = ${"worker"}
    `;
    if (!target[0]) throw new Error("کارگر یافت نشد");
    if (text(target[0].employment) === "salaried") throw new Error("تحویل فقط به کارگر کانتراتی است");
    const giverId = order[0].worker_id == null ? null : num(order[0].worker_id);
    if (giverId != null) {
      const back = await sql<{ worker_id: number }>`
        select o.worker_id
        from work_deliveries d
        join work_orders o on o.id = d.work_order_id and o.user_id = d.user_id
        where d.user_id = ${context.userId}
          and d.to_worker_id = ${giverId}
          and o.product_id = ${num(order[0].product_id)}
          and o.worker_id = ${toWorkerId}
        limit 1
      `;
      if (back[0]) throw new Error("تحویل این کالا به کسی که همین مدل را از او گرفته‌اید مجاز نیست");
    }
    const targetStage = target[0].stage_id == null ? null : num(target[0].stage_id);

    const existingChild = await sql<{ id: number }>`
      select id from work_orders
      where user_id = ${context.userId} and root_id = ${rootId}
        and worker_id = ${toWorkerId} and product_id = ${num(order[0].product_id)}
      order by id
      limit 1
    `;
    let childId = existingChild[0]?.id ?? null;
    if (childId == null) {
      const invoiceNo = weekNo || nextInvoiceNo(
        (
          await sql<{ invoice_no: string | null }>`
            select invoice_no from work_orders where user_id = ${context.userId}
          `
        ).map((r) => text(r.invoice_no)),
        "W",
      );
      const note = `تحویل از سفارش ${text(order[0].product_name)}`;
      const inserted = await sql<{ id: number }>`
        insert into work_orders (
          user_id, worker_id, product_id, product_name, quantity, delivered_qty, occurred_on, notes, invoice_no,
          stage_id, root_id
        ) values (
          ${context.userId}, ${toWorkerId}, ${num(order[0].product_id)}, ${text(order[0].product_name)},
          ${data.quantity}, ${0}, ${data.occurredOn}, ${note}, ${invoiceNo}, ${targetStage}, ${rootId}
        )
        returning id
      `;
      childId = inserted[0].id;
    } else {
      await sql`
        update work_orders set quantity = quantity + ${data.quantity}
        where id = ${childId} and user_id = ${context.userId}
      `;
    }
    await sql`
      insert into work_deliveries (
        user_id, work_order_id, quantity, occurred_on, notes, to_worker_id, to_work_order_id, wage_per_unit
      ) values (
        ${context.userId}, ${data.id}, ${data.quantity}, ${data.occurredOn}, ${data.notes},
        ${toWorkerId}, ${childId}, ${wage}
      )
    `;
    await sql`
      update work_orders set delivered_qty = delivered_qty + ${data.quantity}
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return { ok: true as const, toWarehouse: false as const, toWorkOrderId: childId };
  });

export const updateWorkOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id: number;
      workerId: number | null;
      productId: number;
      quantity: number;
      occurredOn: string;
      notes: string;
      invoiceNo?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["warehouses", "workers"]);
    if (data.quantity <= 0) throw new Error("تعداد سفارش باید بزرگ‌تر از صفر باشد");
    const order = await sql<{
      id: number;
      product_id: number;
      quantity: unknown;
      delivered_qty: unknown;
      root_id: number | null;
    }>`
      select id, product_id, quantity, delivered_qty, root_id
      from work_orders where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!order[0]) throw new Error("سفارش یافت نشد");
    const delivered = num(order[0].delivered_qty);
    if (data.quantity + 1e-9 < delivered) {
      throw new Error(`تعداد نمی‌تواند از تحویل‌شده (${formatMoney(delivered)}) کمتر باشد`);
    }
    const productChanged = data.productId !== num(order[0].product_id);
    if (productChanged && delivered > 1e-9) {
      throw new Error("پس از تحویل نمی‌توان مدل کالا را عوض کرد");
    }
    const stageId = await workerStageId(sql, context.userId, data.workerId);
    if (data.workerId != null) {
      const w = await sql<{ employment: string | null }>`
        select employment from parties where id = ${data.workerId} and user_id = ${context.userId}
      `;
      if (w[0] && text(w[0].employment) === "salaried") {
        throw new Error("سفارش تولید فقط به کارگر کانتراتی داده می‌شود");
      }
    }
    const rootId = order[0].root_id;
    const isRoot = rootId == null || num(rootId) === num(order[0].id);
    const product = await sql<{ id: number; name: string; kind: string }>`
      select id, name, kind from items where id = ${data.productId} and user_id = ${context.userId}
    `;
    if (!product[0] || product[0].kind !== "product") throw new Error("کالا یافت نشد");
    if (isRoot) {
      const bom = await sql<{ raw_item_id: number; quantity: unknown; name: string }>`
        select b.raw_item_id, b.quantity, i.name
        from bom_lines b
        join items i on i.id = b.raw_item_id
        where b.product_id = ${data.productId} and b.user_id = ${context.userId}
      `;
      if (!bom.length) throw new Error("فرمول مواد خام این کالا ثبت نشده است");
      const oldAlloc = await sql<{ raw_item_id: number; allocated_qty: unknown }>`
        select raw_item_id, allocated_qty from work_order_alloc
        where work_order_id = ${data.id} and user_id = ${context.userId}
      `;
      const inv = await loadInventoryState(sql, context.userId);
      const short: string[] = [];
      for (const line of bom) {
        const need = num(line.quantity) * data.quantity;
        const prev = oldAlloc.find((a) => num(a.raw_item_id) === num(line.raw_item_id));
        const released = num(prev?.allocated_qty);
        const have = (inv.raw.find((r) => r.itemId === num(line.raw_item_id))?.qty ?? 0) + released;
        if (have + 1e-9 < need) {
          short.push(`${text(line.name)} (موجود ${formatMoney(have)}، لازم ${formatMoney(need)})`);
        }
      }
      if (short.length) throw new Error(`موجودی مواد خام کافی نیست:\n${short.join("\n")}`);
      await sql`delete from work_order_alloc where work_order_id = ${data.id} and user_id = ${context.userId}`;
      for (const line of bom) {
        const per = num(line.quantity);
        await sql`
          insert into work_order_alloc (
            user_id, work_order_id, raw_item_id, raw_item_name, qty_per_unit, allocated_qty
          ) values (
            ${context.userId}, ${data.id}, ${num(line.raw_item_id)}, ${text(line.name)}, ${per},
            ${per * data.quantity}
          )
        `;
      }
    }
    await sql`
      update work_orders set
        worker_id = ${data.workerId}, product_id = ${data.productId}, product_name = ${product[0].name},
        quantity = ${data.quantity}, occurred_on = ${data.occurredOn}, notes = ${data.notes},
        stage_id = ${stageId}
      where id = ${data.id} and user_id = ${context.userId}
    `;
    const weekNo = (data.invoiceNo || "").trim();
    if (weekNo && delivered < 1e-9) {
      await sql`
        update work_orders set invoice_no = ${weekNo}
        where id = ${data.id} and user_id = ${context.userId}
      `;
    }
    return { id: data.id };
  });

export const deleteWorkOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["warehouses", "workers"]);
    const order = await sql<{ id: number; delivered_qty: unknown; root_id: number | null }>`
      select id, delivered_qty, root_id from work_orders where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!order[0]) throw new Error("سفارش یافت نشد");
    if (num(order[0].delivered_qty) > 1e-9) throw new Error("سفارش تحویل‌شده حذف نمی‌شود");
    const children = await sql<{ id: number; delivered_qty: unknown }>`
      select id, delivered_qty from work_orders
      where user_id = ${context.userId} and root_id = ${data.id} and id <> ${data.id}
    `;
    if (children.some((c) => num(c.delivered_qty) > 1e-9)) {
      throw new Error("این سفارش مرحلهٔ بعدی تحویل‌شده دارد و حذف نمی‌شود");
    }
    for (const c of children) {
      await sql`delete from work_order_alloc where work_order_id = ${c.id} and user_id = ${context.userId}`;
      await sql`delete from work_deliveries where to_work_order_id = ${c.id} and user_id = ${context.userId}`;
      await sql`delete from work_orders where id = ${c.id} and user_id = ${context.userId}`;
    }
    await sql`delete from work_order_alloc where work_order_id = ${data.id} and user_id = ${context.userId}`;
    await sql`delete from work_deliveries where work_order_id = ${data.id} and user_id = ${context.userId}`;
    await sql`delete from work_orders where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const resetWorkerMaterials = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { code: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["warehouses", "workers"]);
    const codes = await getRoleCodes(sql, context.userId);
    assertAccountantPin(codes, data.code);
    await sql`delete from work_deliveries where user_id = ${context.userId}`;
    await sql`delete from work_order_alloc where user_id = ${context.userId}`;
    await sql`delete from work_orders where user_id = ${context.userId}`;
    return { ok: true as const };
  });
