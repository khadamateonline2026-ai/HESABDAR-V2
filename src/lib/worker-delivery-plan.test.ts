import assert from "node:assert/strict";
import test from "node:test";
import { planDeliveryQtyChange, type PlanDelivery, type PlanOrder } from "./worker-delivery-plan.ts";

function linear(): { orders: PlanOrder[]; deliveries: PlanDelivery[] } {
  return {
    orders: [
      { id: 1, quantity: 10, delivered: 10 },
      { id: 2, quantity: 10, delivered: 10 },
      { id: 3, quantity: 10, delivered: 10 },
    ],
    deliveries: [
      { id: 11, workOrderId: 1, quantity: 10, toWorkOrderId: 2, toWarehouse: false },
      { id: 12, workOrderId: 2, quantity: 10, toWorkOrderId: 3, toWarehouse: false },
      { id: 13, workOrderId: 3, quantity: 10, toWorkOrderId: null, toWarehouse: true },
    ],
  };
}

test("shrinks every stage of a single batch", () => {
  const src = linear();
  const plan = planDeliveryQtyChange(src.orders, src.deliveries, 1, 11, 8);
  for (const o of plan.orders) {
    assert.equal(o.quantity, 8);
    assert.equal(o.delivered, 8);
  }
  for (const d of plan.deliveries) assert.equal(d.quantity, 8);
});

test("keeps the other partial branch", () => {
  const orders: PlanOrder[] = [
    { id: 1, quantity: 10, delivered: 10 },
    { id: 2, quantity: 6, delivered: 6 },
    { id: 3, quantity: 4, delivered: 0 },
  ];
  const deliveries: PlanDelivery[] = [
    { id: 11, workOrderId: 1, quantity: 6, toWorkOrderId: 2, toWarehouse: false },
    { id: 12, workOrderId: 1, quantity: 4, toWorkOrderId: 3, toWarehouse: false },
    { id: 13, workOrderId: 2, quantity: 6, toWorkOrderId: null, toWarehouse: true },
  ];
  const plan = planDeliveryQtyChange(orders, deliveries, 1, 11, 5);
  const byId = new Map(plan.orders.map((o) => [o.id, o]));
  assert.equal(byId.get(1)?.quantity, 9);
  assert.equal(byId.get(1)?.delivered, 9);
  assert.equal(byId.get(2)?.quantity, 5);
  assert.equal(byId.get(2)?.delivered, 5);
  assert.equal(byId.get(3)?.quantity, 4);
  assert.equal(byId.get(3)?.delivered, 0);
  const dels = new Map(plan.deliveries.map((d) => [d.id, d.quantity]));
  assert.equal(dels.get(11), 5);
  assert.equal(dels.get(12), 4);
  assert.equal(dels.get(13), 5);
});

test("delete zeros only the linked chain", () => {
  const orders: PlanOrder[] = [
    { id: 1, quantity: 10, delivered: 10 },
    { id: 2, quantity: 6, delivered: 6 },
    { id: 3, quantity: 4, delivered: 0 },
  ];
  const deliveries: PlanDelivery[] = [
    { id: 11, workOrderId: 1, quantity: 6, toWorkOrderId: 2, toWarehouse: false },
    { id: 12, workOrderId: 1, quantity: 4, toWorkOrderId: 3, toWarehouse: false },
    { id: 13, workOrderId: 2, quantity: 6, toWorkOrderId: null, toWarehouse: true },
  ];
  const plan = planDeliveryQtyChange(orders, deliveries, 1, 11, 0);
  const byId = new Map(plan.orders.map((o) => [o.id, o]));
  assert.equal(byId.get(1)?.quantity, 4);
  assert.equal(byId.get(1)?.delivered, 4);
  assert.equal(byId.get(2)?.quantity, 0);
  assert.equal(byId.get(2)?.delivered, 0);
  assert.equal(byId.get(3)?.quantity, 4);
  const dels = new Map(plan.deliveries.map((d) => [d.id, d.quantity]));
  assert.equal(dels.get(11), 0);
  assert.equal(dels.get(13), 0);
  assert.equal(dels.get(12), 4);
});

test("refuses a split onward chain", () => {
  const orders: PlanOrder[] = [
    { id: 1, quantity: 10, delivered: 10 },
    { id: 2, quantity: 10, delivered: 10 },
  ];
  const deliveries: PlanDelivery[] = [
    { id: 11, workOrderId: 1, quantity: 10, toWorkOrderId: 2, toWarehouse: false },
    { id: 12, workOrderId: 2, quantity: 6, toWorkOrderId: null, toWarehouse: true },
    { id: 14, workOrderId: 2, quantity: 4, toWorkOrderId: null, toWarehouse: true },
  ];
  assert.throws(() => planDeliveryQtyChange(orders, deliveries, 1, 11, 8), /چند بخش/);
});
