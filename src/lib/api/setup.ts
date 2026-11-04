import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { num, text } from "@/lib/format";
import type { Sql } from "@/lib/db";
import { guard, requireWriteAny, rethrow, sqlOf, assertUniqueItemName, syncSalariedWorker, getRoleCodes } from "./helpers";

const WAGE_OVERHEAD_TITLE = "نرخ دستمزد";
const WAGE_OVERHEAD_PREFIX = "نرخ دستمزد — ";

async function wageTotalForModel(sql: Sql, userId: string, model: string): Promise<number> {
  const rows = await sql<{ wage_per_unit: unknown }>`
    select wage_per_unit from wage_rates
    where user_id = ${userId} and product_model = ${model}
  `;
  return rows.reduce((s, r) => s + num(r.wage_per_unit), 0);
}

async function syncWageLinkedOverheads(sql: Sql, userId: string) {
  const rates = await sql<{ product_model: string; wage_per_unit: unknown }>`
    select product_model, wage_per_unit from wage_rates where user_id = ${userId}
  `;
  const totals = new Map<string, number>();
  for (const r of rates) {
    const key = text(r.product_model).trim() || "—";
    totals.set(key, (totals.get(key) ?? 0) + num(r.wage_per_unit));
  }
  const pattern = `${WAGE_OVERHEAD_PREFIX}%`;
  const overheads = await sql<{ id: number; title: string }>`
    select id, title from production_overhead_types
    where user_id = ${userId} and title like ${pattern}
  `;
  for (const o of overheads) {
    const model = o.title.slice(WAGE_OVERHEAD_PREFIX.length).trim();
    const total = totals.get(model) ?? 0;
    await sql`update production_overhead_types set amount = ${total} where id = ${o.id} and user_id = ${userId}`;
  }
  const extras = await sql<{ id: number; title: string }>`
    select id, title from item_overheads
    where user_id = ${userId} and title like ${pattern}
  `;
  for (const o of extras) {
    const model = o.title.slice(WAGE_OVERHEAD_PREFIX.length).trim();
    const total = totals.get(model) ?? 0;
    await sql`update item_overheads set amount = ${total} where id = ${o.id} and user_id = ${userId}`;
  }
}

export const saveCurrency = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: number; name: string; symbol: string; rateToBase: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "currencies");
    try {
      if (data.id) {
        await sql`
          update currencies set name = ${data.name.trim()}, symbol = ${data.symbol.trim()}, rate_to_base = ${data.rateToBase}
          where id = ${data.id} and user_id = ${context.userId}
        `;
        return { id: data.id };
      }
      const rows = await sql<{ id: number }>`
        insert into currencies (user_id, name, symbol, rate_to_base)
        values (${context.userId}, ${data.name.trim()}, ${data.symbol.trim()}, ${data.rateToBase})
        returning id
      `;
      return { id: rows[0].id };
    } catch (e) {
      rethrow(e);
    }
  });

export const deleteCurrency = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "currencies");
    await sql`delete from currencies where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const saveUnit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: number; name: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["units", "purchase", "sales"]);
    try {
      if (data.id) {
        await sql`update units set name = ${data.name.trim()} where id = ${data.id} and user_id = ${context.userId}`;
        return { id: data.id };
      }
      const rows = await sql<{ id: number }>`
        insert into units (user_id, name) values (${context.userId}, ${data.name.trim()}) returning id
      `;
      return { id: rows[0].id };
    } catch (e) {
      rethrow(e);
    }
  });

export const deleteUnit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "units");
    await sql`delete from units where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const saveJobType = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: number; name: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "jobs");
    try {
      if (data.id) {
        await sql`update job_types set name = ${data.name.trim()} where id = ${data.id} and user_id = ${context.userId}`;
        return { id: data.id };
      }
      const rows = await sql<{ id: number }>`
        insert into job_types (user_id, name) values (${context.userId}, ${data.name.trim()}) returning id
      `;
      return { id: rows[0].id };
    } catch (e) {
      rethrow(e);
    }
  });

export const deleteJobType = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "jobs");
    await sql`delete from job_types where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const saveProductionStage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: number; name: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "jobs");
    const name = data.name.trim();
    if (!name) throw new Error("نام مرحله لازم است");
    try {
      if (data.id) {
        await sql`
          update production_stages set name = ${name}
          where id = ${data.id} and user_id = ${context.userId}
        `;
        return { id: data.id };
      }
      const last = await sql<{ m: number | null }>`
        select max(sort_order) as m from production_stages where user_id = ${context.userId}
      `;
      const sortOrder = (last[0]?.m ?? -1) + 1;
      const rows = await sql<{ id: number }>`
        insert into production_stages (user_id, name, sort_order)
        values (${context.userId}, ${name}, ${sortOrder})
        returning id
      `;
      return { id: rows[0].id };
    } catch (e) {
      rethrow(e);
    }
  });

export const deleteProductionStage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "jobs");
    await sql`delete from production_stages where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listWageRates = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlOf();
    const rows = await sql<Record<string, unknown>>`
      select w.*, j.name as job_type_name
      from wage_rates w
      join job_types j on j.id = w.job_type_id
      where w.user_id = ${context.userId}
      order by w.id desc
    `;
    return rows.map((r) => ({
      id: num(r.id),
      jobTypeId: num(r.job_type_id),
      jobTypeName: text(r.job_type_name),
      productModel: text(r.product_model),
      wagePerUnit: num(r.wage_per_unit),
      registeredAt: text(r.registered_at),
      notes: text(r.notes),
    }));
  });

export const saveWageRate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      jobTypeId: number;
      productModel: string;
      wagePerUnit: number;
      registeredAt: string;
      notes: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "wages");
    if (data.id) {
      await sql`
        update wage_rates
        set job_type_id = ${data.jobTypeId}, product_model = ${data.productModel},
            wage_per_unit = ${data.wagePerUnit}, registered_at = ${data.registeredAt}, notes = ${data.notes}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      await syncWageLinkedOverheads(sql, context.userId);
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into wage_rates (user_id, job_type_id, product_model, wage_per_unit, registered_at, notes)
      values (${context.userId}, ${data.jobTypeId}, ${data.productModel}, ${data.wagePerUnit}, ${data.registeredAt}, ${data.notes})
      returning id
    `;
    await syncWageLinkedOverheads(sql, context.userId);
    return { id: rows[0].id };
  });

export const deleteWageRate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "wages");
    await sql`delete from wage_rates where id = ${data.id} and user_id = ${context.userId}`;
    await syncWageLinkedOverheads(sql, context.userId);
    return { ok: true as const };
  });

export const savePartyCategory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: number; kind: "customer" | "vendor" | "other" | "worker"; name: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, data.kind === "worker" ? "workers" : "parties");
    if (data.kind === "worker") {
      await sql.query("alter table party_categories drop constraint if exists party_categories_kind_check");
      await sql.query(
        "alter table party_categories add constraint party_categories_kind_check check (kind in ('customer', 'vendor', 'worker', 'other'))",
      );
    }
    if (data.id) {
      await sql`
        update party_categories set name = ${data.name.trim()}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into party_categories (user_id, kind, name)
      values (${context.userId}, ${data.kind}, ${data.name.trim()})
      returning id
    `;
    return { id: rows[0].id };
  });

export const deletePartyCategory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    const row = await sql<{ kind: string }>`
      select kind from party_categories where id = ${data.id} and user_id = ${context.userId}
    `;
    await guard(context.userId, row[0]?.kind === "worker" ? "workers" : "parties");
    await sql`delete from party_categories where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const saveParty = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      kind: "customer" | "vendor" | "worker" | "other";
      name: string;
      phone: string;
      categoryId: number | null;
      notes: string;
      jobTypeId: number | null;
      startDate: string;
      address: string;
      currencyId: number | null;
      stageId?: number | null;
      employment?: "contract" | "salaried";
      salary?: number;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const area =
      data.kind === "worker" ? "workers" : data.kind === "customer" ? "sales" : data.kind === "vendor" ? "purchase" : "parties";
    const { sql } = await guard(context.userId, area);
    const name = data.name.trim();
    if (!name) throw new Error("نام لازم است");
    const stageId = data.kind === "worker" ? (data.stageId ?? null) : null;
    const employment = data.kind === "worker" ? (data.employment === "salaried" ? "salaried" : "contract") : "contract";
    const salary = data.kind === "worker" ? Math.max(0, data.salary ?? 0) : 0;
    if (data.id) {
      await sql`
        update parties set
          name = ${name}, phone = ${data.phone}, category_id = ${data.categoryId},
          notes = ${data.notes}, job_type_id = ${data.jobTypeId}, start_date = ${data.startDate || null},
          address = ${data.address}, currency_id = ${data.currencyId}, stage_id = ${stageId},
          employment = ${employment}, salary = ${salary}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      if (data.kind === "worker") await syncSalariedWorker(sql, context.userId, data.id);
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into parties (
        user_id, kind, name, phone, category_id, notes, job_type_id, start_date, address, currency_id, stage_id,
        employment, salary
      ) values (
        ${context.userId}, ${data.kind}, ${name}, ${data.phone}, ${data.categoryId}, ${data.notes},
        ${data.jobTypeId}, ${data.startDate || null}, ${data.address}, ${data.currencyId}, ${stageId},
        ${employment}, ${salary}
      ) returning id
    `;
    if (data.kind === "worker") await syncSalariedWorker(sql, context.userId, rows[0].id);
    return { id: rows[0].id };
  });

export const deleteParty = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; kind: "customer" | "vendor" | "worker" | "other" }) => d)
  .handler(async ({ context, data }) => {
    const area =
      data.kind === "worker" ? "workers" : data.kind === "customer" ? "sales" : data.kind === "vendor" ? "purchase" : "parties";
    const { sql } = await guard(context.userId, area);
    await sql`delete from parties where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const saveItemCategory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: number; name: string; kind: "product" | "raw" }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["purchase", "warehouses"]);
    const name = data.name.trim();
    if (!name) throw new Error("نام لازم است");
    const kind = data.kind === "raw" ? "raw" : "product";
    if (data.id) {
      await sql`
        update item_categories set name = ${name}, kind = ${kind}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into item_categories (user_id, name, kind)
      values (${context.userId}, ${name}, ${kind})
      returning id
    `;
    return { id: rows[0].id };
  });

export const deleteItemCategory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["purchase", "warehouses"]);
    await sql`delete from item_categories where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const saveItemType = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { name: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "purchase");
    const rows = await sql<{ id: number }>`
      insert into item_types (user_id, name) values (${context.userId}, ${data.name.trim()}) returning id
    `;
    return { id: rows[0].id };
  });

export const saveItem = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id?: number;
      name: string;
      kind?: "product" | "raw";
      typeId: number | null;
      categoryId: number | null;
      unitId: number | null;
      image?: string | null;
      minQty?: number;
      salePrice?: number;
      purchasePrice?: number;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["purchase", "sales", "warehouses"]);
    const name = data.name.trim();
    if (!name) throw new Error("نام لازم است");
    const kind = data.kind === "raw" ? "raw" : "product";
    const minQty = Math.max(0, data.minQty ?? 0);
    const salePrice = Math.max(0, data.salePrice ?? 0);
    const purchasePrice = Math.max(0, data.purchasePrice ?? 0);
    const image = data.image === undefined ? undefined : data.image;
    await assertUniqueItemName(sql, context.userId, name, kind, data.id);
    if (data.id) {
      if (image === undefined) {
        await sql`
          update items set
            name = ${name}, kind = ${kind}, type_id = ${data.typeId},
            category_id = ${data.categoryId}, unit_id = ${data.unitId}, min_qty = ${minQty},
            sale_price = ${salePrice}, purchase_price = ${purchasePrice}
          where id = ${data.id} and user_id = ${context.userId}
        `;
      } else {
        await sql`
          update items set
            name = ${name}, kind = ${kind}, type_id = ${data.typeId},
            category_id = ${data.categoryId}, unit_id = ${data.unitId},
            min_qty = ${minQty}, sale_price = ${salePrice}, purchase_price = ${purchasePrice}, image = ${image}
          where id = ${data.id} and user_id = ${context.userId}
        `;
      }
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into items (user_id, name, kind, type_id, category_id, unit_id, image, min_qty, sale_price, purchase_price)
      values (
        ${context.userId}, ${name}, ${kind}, ${data.typeId}, ${data.categoryId}, ${data.unitId},
        ${image ?? null}, ${minQty}, ${salePrice}, ${purchasePrice}
      )
      returning id
    `;
    return { id: rows[0].id };
  });

export const saveWarehouse = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { name: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["opening", "purchase", "warehouses"]);
    await sql.query("alter table warehouses add column if not exists shop_only boolean not null default false");
    await sql.query(
      "alter table app_settings add column if not exists production_enabled boolean not null default true",
    );
    const prod = await sql<{ production_enabled: boolean | number | string | null }>`
      select production_enabled from app_settings where user_id = ${context.userId}
    `;
    const raw = prod[0]?.production_enabled;
    const productionOn =
      raw == null || (raw !== false && raw !== 0 && String(raw) !== "f" && String(raw) !== "false");
    const shopOnly = !productionOn;
    const rows = await sql<{ id: number }>`
      insert into warehouses (user_id, name, shop_only) values (${context.userId}, ${data.name.trim()}, ${shopOnly}) returning id
    `;
    return { id: rows[0].id };
  });

export const updateWarehouse = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number; name: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["opening", "purchase", "warehouses"]);
    const name = data.name.trim();
    if (!name) throw new Error("نام گدام لازم است");
    const cur = await sql<{ name: string }>`
      select name from warehouses where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!cur[0]) throw new Error("گدام پیدا نشد");
    const dup = await sql<{ id: number }>`
      select id from warehouses where user_id = ${context.userId} and name = ${name} and id <> ${data.id}
    `;
    if (dup[0]) throw new Error("این نام قبلاً ثبت شده");
    const old = cur[0].name;
    await sql`update warehouses set name = ${name} where id = ${data.id} and user_id = ${context.userId}`;
    if (old !== name) {
      await sql`
        update opening_stock set warehouse_name = ${name}
        where user_id = ${context.userId} and warehouse_name = ${old}
      `;
      await sql`
        update purchases set warehouse_name = ${name}
        where user_id = ${context.userId} and warehouse_name = ${old}
      `;
    }
    return { id: data.id };
  });

export const deleteWarehouse = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["opening", "purchase", "warehouses"]);
    const cur = await sql<{ name: string }>`
      select name from warehouses where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!cur[0]) throw new Error("گدام پیدا نشد");
    const name = cur[0].name;
    const used = await sql<{ n: number }>`
      select
        (select count(*) from opening_stock where user_id = ${context.userId} and warehouse_name = ${name})
        + (select count(*) from purchases where user_id = ${context.userId} and warehouse_name = ${name}) as n
    `;
    if (Number(used[0]?.n ?? 0) > 0) throw new Error("این گدام در اسناد استفاده شده و حذف نمی‌شود");
    await sql`delete from warehouses where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const saveProductionEnabled = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { enabled: boolean; code: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await sqlOf();
    await requireWriteAny(sql, context.userId, ["settings"]);
    const codes = await getRoleCodes(sql, context.userId);
    if (codes.accountant !== data.code.trim()) throw new Error("کد نقش حسابدار نادرست است");
    await sql.query(
      "alter table app_settings add column if not exists production_enabled boolean not null default true",
    );
    await sql`
      insert into app_settings (user_id, production_enabled)
      values (${context.userId}, ${data.enabled})
      on conflict (user_id) do update set production_enabled = excluded.production_enabled
    `;
    return { ok: true as const };
  });

export const saveProductionOverhead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: number; title: string; amount: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "units");
    const title = data.title.trim();
    if (!title) throw new Error("تشریح لازم است");
    let amount = Math.max(0, data.amount);
    if (title === WAGE_OVERHEAD_TITLE || title.startsWith(WAGE_OVERHEAD_PREFIX)) {
      const model = title.startsWith(WAGE_OVERHEAD_PREFIX) ? title.slice(WAGE_OVERHEAD_PREFIX.length).trim() : "";
      if (!model) throw new Error("نام کالا لازم است");
      amount = await wageTotalForModel(sql, context.userId, model);
    }
    if (amount <= 0) throw new Error("مبلغ باید بزرگ‌تر از صفر باشد");
    if (data.id) {
      await sql`
        update production_overhead_types set title = ${title}, amount = ${amount}
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into production_overhead_types (user_id, title, amount)
      values (${context.userId}, ${title}, ${amount})
      returning id
    `;
    return { id: rows[0].id };
  });

export const deleteProductionOverhead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "units");
    await sql`delete from production_overhead_types where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });
