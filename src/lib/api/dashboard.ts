import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { num, text, todayIso } from "@/lib/format";
import type { DashboardAlert, DashboardData } from "@/lib/types";
import { fxToBase, loadCatalogs, loadInventoryState, requireProfile, sqlOf, wageForProduct } from "./helpers";
import { loadRecurringDues } from "./ops";
import { loadPartySummaries } from "./reports";

async function productionEnabled(sql: Awaited<ReturnType<typeof sqlOf>>, userId: string) {
  try {
    const rows = await sql<{ production_enabled: unknown }>`
      select production_enabled from app_settings where user_id = ${userId}
    `;
    const v = rows[0]?.production_enabled;
    if (v == null) return true;
    return v !== false && v !== 0 && v !== "f" && v !== "false";
  } catch {
    return true;
  }
}

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<DashboardData> => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    await sql.query("alter table work_deliveries add column if not exists wage_per_unit numeric");
    await sql.query("alter table party_payments add column if not exists applied_sale_id bigint");
    await sql.query("alter table sale_invoices add column if not exists cash_included_base double precision not null default 0");
    const productionOn = await productionEnabled(sql, context.userId);
    const catalogs = await loadCatalogs(sql, context.userId);
    const rate = (id: number) => catalogs.currencies.find((c) => c.id === id)?.rateToBase ?? 1;
    const lineRate = (r: Record<string, unknown>) => fxToBase(r.fx_enabled, r.fx_rate, rate(num(r.currency_id)));
    const toBase = (amount: number, currencyId: number) => amount * rate(currencyId);

    const [sales, purchases, expenses, purchInv, inv, dues, customers, vendors, orders, deliveryRows, workerPays, wages, noteRows] =
      await Promise.all([
      sql<Record<string, unknown>>`
        select s.*, i.fx_enabled, i.fx_rate
        from sales s
        left join sale_invoices i on i.id = s.invoice_id
        where s.user_id = ${context.userId}
      `,
      sql<Record<string, unknown>>`
        select p.*, i.fx_enabled, i.fx_rate
        from purchases p
        left join purchase_invoices i on i.id = p.invoice_id
        where p.user_id = ${context.userId}
      `,
      sql<Record<string, unknown>>`select amount, currency_id, as_debt from expenses where user_id = ${context.userId}`,
      sql<Record<string, unknown>>`select * from purchase_invoices where user_id = ${context.userId}`,
      loadInventoryState(sql, context.userId),
      loadRecurringDues(sql, context.userId),
      loadPartySummaries(sql, context.userId, "customer"),
      loadPartySummaries(sql, context.userId, "vendor"),
      sql<Record<string, unknown>>`select worker_id, product_name, delivered_qty from work_orders where user_id = ${context.userId}`,
      sql<Record<string, unknown>>`
        select o.worker_id, o.product_name, d.quantity, d.wage_per_unit
        from work_deliveries d
        join work_orders o on o.id = d.work_order_id and o.user_id = d.user_id
        where d.user_id = ${context.userId}
      `,
      sql<Record<string, unknown>>`
        select wp.worker_id, wp.amount, p.employment
        from worker_payments wp
        join parties p on p.id = wp.worker_id
        where wp.user_id = ${context.userId}
      `,
      sql<Record<string, unknown>>`
        select job_type_id, product_model, wage_per_unit from wage_rates where user_id = ${context.userId}
      `,
      sql<{ kind: string; body: string }>`
        select kind, body from important_notes where user_id = ${context.userId} order by created_at desc, id desc
      `,
    ]);

    const salesBase = sales.reduce(
      (s, r) => s + num(r.quantity) * num(r.unit_price) * lineRate(r),
      0,
    );
    const expenseBase =
      expenses
        .filter((r) => !r.as_debt)
        .reduce((s, r) => s + toBase(num(r.amount), num(r.currency_id)), 0) +
      workerPays
        .filter((r) => text(r.employment) === "salaried")
        .reduce((s, r) => s + num(r.amount), 0);
    const expenseDebtBase = expenses
      .filter((r) => Boolean(r.as_debt))
      .reduce((s, r) => s + toBase(num(r.amount), num(r.currency_id)), 0);

    const items = catalogs.items;
    let cogsBase = 0;
    const productSales: { name: string; qty: number; amountBase: number; occurredOn: string }[] = [];
    for (const item of items.filter((i) => i.kind === "product")) {
      const modelSales = sales.filter(
        (r) => num(r.item_id) === item.id || text(r.item_name) === item.name,
      );
      const qtySold = modelSales.reduce((s, r) => s + num(r.quantity), 0);
      const card = inv.products.find((c) => c.itemId === item.id || c.name === item.name);
      cogsBase += qtySold * (card?.unitCost ?? 0);
      for (const r of modelSales) {
        productSales.push({
          name: item.name,
          qty: num(r.quantity),
          amountBase: num(r.quantity) * num(r.unit_price) * lineRate(r),
          occurredOn: text(r.occurred_on),
        });
      }
    }
    for (const r of sales) {
      const isProduct = items.some(
        (i) => i.kind === "product" && (i.id === num(r.item_id) || i.name === text(r.item_name)),
      );
      if (isProduct) continue;
      const rawCard = inv.raw.find((c) => c.itemId === num(r.item_id) || c.name === text(r.item_name));
      cogsBase += num(r.quantity) * (rawCard?.unitCost || num(r.unit_price) * lineRate(r));
    }

    const customerReceivableBase = customers.summaries
      .filter((s) => s.remainingBase > 1e-9)
      .reduce((s, x) => s + x.remainingBase, 0);
    const cashTakeRows = await sql<{ amount: unknown; fx_rate: unknown; rate_to_base: unknown }>`
      select p.amount, p.fx_rate, c.rate_to_base
      from party_payments p
      join parties pt on pt.id = p.party_id
      join currencies c on c.id = p.currency_id
      where p.user_id = ${context.userId} and pt.kind = ${"customer"} and p.kind = ${"payment"}
        and p.sale_invoice_id is null and p.applied_sale_id is null
    `;
    const cashTakeBase = cashTakeRows.reduce((s, r) => {
      const rate = num(r.fx_rate) > 0 ? num(r.fx_rate) : num(r.rate_to_base) || 1;
      return s + num(r.amount) * rate;
    }, 0);
    const prepaymentBase = vendors.summaries
      .filter((s) => s.remainingBase < -1e-9)
      .reduce((s, x) => s + Math.abs(x.remainingBase), 0);
    const vendorPayableBase = vendors.summaries
      .filter((s) => s.remainingBase > 1e-9)
      .reduce((s, x) => s + x.remainingBase, 0);

    const unpaidDues = dues.filter((x) => x.status === "unpaid");
    const recurringDueBase = unpaidDues
      .filter((d) => d.workerId == null)
      .reduce((s, d) => s + toBase(d.amount, d.currencyId), 0);
    let salaryDueBase = 0;
    for (const w of catalogs.parties.filter((p) => p.kind === "worker" && p.employment === "salaried")) {
      const earned = dues.filter((d) => d.workerId === w.id).reduce((s, d) => s + toBase(d.amount, d.currencyId), 0);
      const paid = workerPays.filter((p) => num(p.worker_id) === w.id).reduce((s, p) => s + num(p.amount), 0);
      salaryDueBase += Math.max(0, earned - paid);
    }

    const wageRates = wages.map((r) => ({
      jobTypeId: num(r.job_type_id),
      productModel: text(r.product_model),
      wagePerUnit: num(r.wage_per_unit),
    }));
    let workerWagePayableBase = 0;
    for (const w of catalogs.parties.filter((p) => p.kind === "worker" && p.employment !== "salaried")) {
      const mine = orders.filter((o) => num(o.worker_id) === w.id);
      const delivered = mine.reduce((s, o) => s + num(o.delivered_qty), 0);
      const rows = deliveryRows.filter((d) => num(d.worker_id) === w.id);
      let work = 0;
      let covered = 0;
      for (const d of rows) {
        const qty = num(d.quantity);
        covered += qty;
        const rate = d.wage_per_unit == null
          ? wageForProduct(text(d.product_name), w.jobTypeId, wageRates)
          : num(d.wage_per_unit);
        work += qty * rate;
      }
      const gap = delivered - covered;
      if (gap > 1e-9) {
        const name = text(mine[0]?.product_name);
        work += gap * wageForProduct(name, w.jobTypeId, wageRates);
      }
      const paid = workerPays.filter((p) => num(p.worker_id) === w.id).reduce((s, p) => s + num(p.amount), 0);
      workerWagePayableBase += Math.max(0, work - paid);
    }

    const cashAccounts = catalogs.accounts
      .filter((a) => a.kind !== "counterparty")
      .map((a) => ({
        name: a.name,
        balance: a.balance,
        balanceBase: a.balance * rate(a.currencyId),
        currencySymbol: a.currencySymbol,
        isBase: a.currencySymbol === "؋" || a.currencyName === "افغانی",
      }));
    const cashBase = cashAccounts.reduce((s, a) => s + a.balanceBase, 0);
    const cashParties = catalogs.accounts
      .filter((a) => a.kind === "counterparty")
      .map((a) => ({
        name: a.name,
        balance: a.balance,
        balanceBase: a.balance * rate(a.currencyId),
        currencySymbol: a.currencySymbol,
        currencyName: a.currencyName,
        isBase: a.currencySymbol === "؋" || a.currencyName === "افغانی",
      }));
    const cashPartyReceivableBase = cashParties
      .filter((p) => p.balanceBase > 1e-9)
      .reduce((s, p) => s + p.balanceBase, 0);
    const cashPartyPayableBase = cashParties
      .filter((p) => p.balanceBase < -1e-9)
      .reduce((s, p) => s + Math.abs(p.balanceBase), 0);
    const receivableBase = customerReceivableBase + prepaymentBase + cashPartyReceivableBase;
    const payableBase =
      vendorPayableBase +
      expenseDebtBase +
      recurringDueBase +
      salaryDueBase +
      workerWagePayableBase +
      cashPartyPayableBase;

    const whMap = new Map<string, { qty: number; valueBase: number }>();
    const bumpWh = (name: string, qty: number, valueBase: number) => {
      const cur = whMap.get(name) ?? { qty: 0, valueBase: 0 };
      cur.qty += qty;
      cur.valueBase += valueBase;
      whMap.set(name, cur);
    };
    for (const c of inv.products) bumpWh("گدام کالای تولید شده", c.qty, c.valueBase);
    for (const c of inv.raw) bumpWh("گدام مواد خام", c.qty, c.valueBase);
    for (const c of inv.workerRaw) bumpWh("مواد نزد کارگران", c.qty, c.valueBase);
    if (!whMap.has("گدام کالای تولید شده")) bumpWh("گدام کالای تولید شده", 0, 0);
    if (!whMap.has("گدام مواد خام")) bumpWh("گدام مواد خام", 0, 0);
    if (!whMap.has("مواد نزد کارگران")) bumpWh("مواد نزد کارگران", 0, 0);
    const warehouses = [
      { name: "گدام کالای تولید شده", ...(whMap.get("گدام کالای تولید شده") ?? { qty: 0, valueBase: 0 }) },
      { name: "گدام مواد خام", ...(whMap.get("گدام مواد خام") ?? { qty: 0, valueBase: 0 }) },
      { name: "مواد نزد کارگران", ...(whMap.get("مواد نزد کارگران") ?? { qty: 0, valueBase: 0 }) },
    ];

    const purchTotals = purchInv.map((h) => {
      const r = h.fx_enabled ? num(h.fx_rate) || 1 : 1;
      const lines = purchases.filter((s) => num(s.invoice_id) === num(h.id));
      const total = lines.reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0);
      return { totalBase: total * r, paidBase: num(h.paid_amount) * r, status: text(h.receive_status), expected: text(h.expected_on), no: text(h.invoice_no) };
    });

    const alerts: DashboardAlert[] = [];
    const today = todayIso();
    for (const p of purchTotals) {
      if (p.status !== "arrived" && p.expected && p.expected < today) {
        alerts.push({ kind: "warn", section: "خرید", text: `فاکتور ${p.no} هنوز نرسیده و تاریخ تقریبی آن گذشته است` });
      }
    }
    if (cashBase < 0) alerts.push({ kind: "danger", section: "نقدینگی", text: "موجودی نقدی مجموعی منفی است" });
    if (receivableBase > 0) {
      alerts.push({ kind: "info", section: "طلبات", text: "طلبات باز وجود دارد — جزئیات در گزارش طلبات" });
    }
    if (payableBase > 0) {
      alerts.push({ kind: "info", section: "بدهی‌ها", text: "بدهی باز وجود دارد — جزئیات در گزارش بدهی‌ها" });
    }
    for (const a of cashAccounts) {
      if (a.balanceBase < 0) alerts.push({ kind: "danger", section: "نقدینگی", text: `حساب «${a.name}» موجودی منفی دارد` });
    }
    if (productionOn) {
      for (const c of inv.products) {
        if (c.minQty > 0 && c.qty + 1e-9 < c.minQty) {
          alerts.push({ kind: "warn", section: "گدام کالای تولید شده", title: c.name, text: "موجودی کم" });
        }
      }
    }
    for (const c of inv.raw) {
      if (c.minQty > 0 && c.qty + 1e-9 < c.minQty) {
        alerts.push({
          kind: "warn",
          section: productionOn ? "گدام مواد خام" : "گدام",
          title: c.name,
          text: "موجودی کم",
        });
      }
    }
    if (productionOn) {
      for (const c of inv.workerRaw) {
        if (c.minQty > 0 && c.qty + 1e-9 < c.minQty) {
          alerts.push({ kind: "warn", section: "گدام مواد خام", title: c.name, text: "موجودی کم" });
        }
      }
    }
    for (const d of unpaidDues) {
      if (d.workerId != null) continue;
      alerts.push({
        kind: "warn",
        section: "هزینه‌ها",
        text: `هزینه تکراری «${d.title}» برای دوره ${d.period} پرداخت نشده است`,
      });
    }
    const salaryLeft = new Map<number, number>();
    for (const p of workerPays) {
      if (text(p.employment) !== "salaried") continue;
      const id = num(p.worker_id);
      salaryLeft.set(id, (salaryLeft.get(id) ?? 0) + num(p.amount));
    }
    const salaryDues = dues
      .filter((d) => d.workerId != null)
      .slice()
      .sort((a, b) => (a.dueOn === b.dueOn ? a.period.localeCompare(b.period) : a.dueOn.localeCompare(b.dueOn)));
    for (const d of salaryDues) {
      const wid = d.workerId as number;
      const left = salaryLeft.get(wid) ?? 0;
      if (left + 1e-9 >= d.amount) {
        salaryLeft.set(wid, left - d.amount);
        continue;
      }
      alerts.push({
        kind: "warn",
        section: "کارگران",
        text: `معاش «${d.title}» برای دوره ${d.period} پرداخت نشده است`,
      });
    }

    let viewSales = salesBase;
    let viewCogs = cogsBase;
    let viewPayable = payableBase;
    let viewWage = workerWagePayableBase;
    let viewSalesLines = productSales;
    let viewWarehouses = warehouses;
    if (!productionOn) {
      viewSales = 0;
      viewCogs = 0;
      viewSalesLines = [];
      for (const r of sales) {
        const isProduct = items.some(
          (i) => i.kind === "product" && (i.id === num(r.item_id) || i.name === text(r.item_name)),
        );
        if (isProduct) continue;
        const qty = num(r.quantity);
        const amountBase = qty * num(r.unit_price) * lineRate(r);
        viewSales += amountBase;
        const rawCard = inv.raw.find((c) => c.itemId === num(r.item_id) || c.name === text(r.item_name));
        viewCogs += qty * (rawCard?.unitCost || num(r.unit_price) * lineRate(r));
        viewSalesLines.push({
          name: text(r.item_name),
          qty,
          amountBase,
          occurredOn: text(r.occurred_on),
        });
      }
      viewWage = 0;
      viewPayable = payableBase - workerWagePayableBase;
      const opening = await sql<{ kind: string; warehouse_name: string; quantity: unknown; value_base: unknown }>`
        select kind, warehouse_name, quantity, value_base from opening_stock where user_id = ${context.userId}
      `;
      const rec = new Map<string, { qty: number; value: number }>();
      for (const w of catalogs.warehouses) rec.set(w.name, { qty: 0, value: 0 });
      if (!rec.size) rec.set("گدام اصلی", { qty: 0, value: 0 });
      const addRec = (name: string, qty: number, value: number) => {
        const key = name.trim() || [...rec.keys()][0];
        const cur = rec.get(key) ?? { qty: 0, value: 0 };
        cur.qty += qty;
        cur.value += value;
        rec.set(key, cur);
      };
      for (const o of opening) {
        if (text(o.kind) !== "raw") continue;
        addRec(text(o.warehouse_name), num(o.quantity), num(o.value_base));
      }
      for (const p of purchases) {
        const qty = p.received_qty == null ? 0 : num(p.received_qty);
        if (qty <= 0) continue;
        addRec(text(p.warehouse_name), qty, qty * num(p.unit_price) * lineRate(p));
      }
      const remainQty = inv.raw.reduce((s, c) => s + c.qty, 0);
      const remainVal = inv.raw.reduce((s, c) => s + c.valueBase, 0);
      const recQty = [...rec.values()].reduce((s, r) => s + r.qty, 0);
      const recVal = [...rec.values()].reduce((s, r) => s + r.value, 0);
      const first = [...rec.keys()][0];
      viewWarehouses = [...rec.entries()].map(([name, r]) => ({
        name,
        qty: recQty > 1e-9 ? remainQty * (r.qty / recQty) : name === first ? remainQty : 0,
        valueBase: recVal > 1e-9 ? remainVal * (r.value / recVal) : name === first ? remainVal : 0,
      }));
    }

    return {
      cashBase,
      cashAccounts,
      salesBase: viewSales,
      cogsBase: viewCogs,
      expenseBase,
      profitBase: viewSales - viewCogs - expenseBase,
      receivableBase,
      customerReceivableBase,
      cashTakeBase,
      prepaymentBase,
      payableBase: viewPayable,
      vendorPayableBase,
      expenseDebtBase,
      recurringDueBase,
      salaryDueBase,
      workerWagePayableBase: viewWage,
      cashPartyReceivableBase,
      cashPartyPayableBase,
      cashParties,
      warehouses: viewWarehouses,
      productSales: viewSalesLines,
      alerts,
      noteTexts: noteRows.filter((n) => n.kind !== "image" && text(n.body).trim()).map((n) => text(n.body).trim()),
      noteImageCount: noteRows.filter((n) => n.kind === "image").length,
    };
  });
