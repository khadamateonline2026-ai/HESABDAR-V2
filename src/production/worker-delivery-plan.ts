/** Pure quantity plan for one contract-worker delivery edit or delete. */

export type PlanOrder = { id: number; quantity: number; delivered: number };

export type PlanDelivery = {
  id: number;
  workOrderId: number;
  quantity: number;
  toWorkOrderId: number | null;
  toWarehouse: boolean;
};

const EPS = 1e-6;

export function planDeliveryQtyChange(
  orders: PlanOrder[],
  deliveries: PlanDelivery[],
  rootId: number,
  deliveryId: number,
  nextQty: number,
): { orders: PlanOrder[]; deliveries: PlanDelivery[] } {
  const ord = new Map(orders.map((o) => [o.id, { ...o }]));
  const byId = new Map(deliveries.map((d) => [d.id, { ...d }]));
  const edited = byId.get(deliveryId);
  if (!edited) throw new Error("ردیف تحویل یافت نشد");
  if (!ord.has(rootId)) throw new Error("ریشه سفارش یافت نشد");
  if (nextQty < -EPS) throw new Error("تعداد تحویل نمی‌تواند منفی شود");
  const delta = nextQty - edited.quantity;
  if (Math.abs(delta) <= EPS) {
    return { orders: [...ord.values()], deliveries: [...byId.values()] };
  }

  const originalDelivered = new Map(orders.map((o) => [o.id, o.delivered]));
  const originalDelQty = new Map(deliveries.map((d) => [d.id, d.quantity]));
  const touchedDel = new Set<number>();
  const qtyTouch = new Set<number>([rootId]);
  const delTouch = new Set<number>();
  const originalQty = edited.quantity;

  const queue = [edited.id];
  while (queue.length) {
    const id = queue.shift();
    if (id == null || touchedDel.has(id)) continue;
    const row = byId.get(id);
    if (!row) continue;
    touchedDel.add(id);
    delTouch.add(row.workOrderId);
    if (!ord.has(row.workOrderId)) throw new Error("سفارش مرحله یافت نشد");
    if (row.toWorkOrderId != null) {
      if (!ord.has(row.toWorkOrderId)) throw new Error("سفارش مرحله بعد یافت نشد");
      qtyTouch.add(row.toWorkOrderId);
      const outs = [...byId.values()].filter((x) => x.workOrderId === row.toWorkOrderId && !touchedDel.has(x.id));
      if (outs.length === 1) queue.push(outs[0].id);
      else if (outs.length > 1) {
        const same = outs.filter((x) => Math.abs(x.quantity - originalQty) <= EPS);
        if (same.length === 1) queue.push(same[0].id);
        else throw new Error("این تحویل در مرحله بعد چند بخش شده است. اول ردیف‌های بعدی را جداگانه اصلاح کنید");
      }
    }
  }

  let cursor = edited.workOrderId;
  const seen = new Set<number>();
  while (!seen.has(cursor)) {
    seen.add(cursor);
    const incoming = [...byId.values()].filter((x) => x.toWorkOrderId === cursor && !touchedDel.has(x.id));
    if (incoming.length !== 1) break;
    const inc = incoming[0];
    touchedDel.add(inc.id);
    delTouch.add(inc.workOrderId);
    if (!ord.has(inc.workOrderId)) throw new Error("سفارش مرحله یافت نشد");
    qtyTouch.add(inc.workOrderId);
    qtyTouch.add(cursor);
    cursor = inc.workOrderId;
  }

  for (const id of touchedDel) {
    const row = byId.get(id);
    if (row) row.quantity += delta;
  }
  for (const id of qtyTouch) {
    const row = ord.get(id);
    if (!row) throw new Error("سفارش مرحله یافت نشد");
    row.quantity += delta;
  }
  for (const id of delTouch) {
    const row = ord.get(id);
    if (!row) throw new Error("سفارش مرحله یافت نشد");
    row.delivered += delta;
  }

  for (const row of ord.values()) {
    if (row.quantity < -EPS || row.delivered < -EPS) throw new Error("تعداد نمی‌تواند منفی شود");
    if (row.delivered - row.quantity > EPS) {
      throw new Error("تحویل‌شده از تعداد سفارش در مراحل تولید بیشتر می‌شود");
    }
    if (row.quantity <= EPS && row.delivered > EPS) {
      throw new Error("باقی‌مانده مرحله با تعداد جدید جور درنمی‌آید");
    }
  }
  for (const row of byId.values()) {
    if (row.quantity < -EPS) throw new Error("تعداد تحویل نمی‌تواند منفی شود");
  }

  for (const id of delTouch) {
    const row = ord.get(id);
    if (!row) continue;
    const oldSum = [...originalDelQty.entries()]
      .filter(([delId]) => byId.get(delId)?.workOrderId === id)
      .reduce((s, [, q]) => s + q, 0);
    const newSum = [...byId.values()].filter((d) => d.workOrderId === id && d.quantity > EPS).reduce((s, d) => s + d.quantity, 0);
    const oldMismatch = oldSum - (originalDelivered.get(id) ?? 0);
    const newMismatch = newSum - row.delivered;
    if (Math.abs(newMismatch - oldMismatch) > 1e-3) {
      throw new Error("تعداد تحویل با مراحل همین سفارش جور درنمی‌آید");
    }
  }

  return { orders: [...ord.values()], deliveries: [...byId.values()] };
}
