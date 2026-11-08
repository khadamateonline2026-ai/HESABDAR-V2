import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import {
  isWarehouseBackupPayload,
  parseWarehouseBackup,
  resolveWarehouseBackupSection,
} from "./warehouse-backup.ts";

const LEGACY_PRODUCT = `{
  "type": "hesabdar-warehouse",
  "warehouse": "product",
  "items": [
    {
      "name": "Y24",
      "kind": "product",
      "unit": "عدد",
      "qty": 545,
      "category": "مدل کت",
      "bom": [{ "name": "جنس اصلی", "quantity": 0.48 }]
    }
  ]
}`;

const LEGACY_RAW = `{
  "type": "hesabdar-warehouse",
  "warehouse": "raw",
  "items": [
    { "name": "آستر چینی", "kind": "raw", "unit": "متر", "qty": 5000, "category": "مال چینی", "bom": [] }
  ]
}`;

const CURRENT = `{
  "app": "hesabdar",
  "section": "product",
  "items": [
    {
      "name": "کالا",
      "category": "گروه",
      "unit": "عدد",
      "minQty": 1,
      "salePrice": 10,
      "purchasePrice": 5,
      "qty": 2,
      "notes": "",
      "bom": [{ "name": "مواد", "quantity": 1, "unit": "متر", "purchasePrice": 3 }],
      "overheads": [{ "title": "هزینه", "amount": 1 }]
    }
  ]
}`;

test("legacy product resolves and parses", () => {
  const parsed = JSON.parse(LEGACY_PRODUCT);
  assert.equal(resolveWarehouseBackupSection(parsed), "product");
  assert.equal(isWarehouseBackupPayload(parsed), true);
  const out = parseWarehouseBackup(LEGACY_PRODUCT, "product");
  assert.equal(out.format, "legacy");
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].name, "Y24");
  assert.equal(out.items[0].bom?.[0]?.name, "جنس اصلی");
  assert.equal(out.items[0].salePrice, 0);
});

test("legacy raw parses; wrong tab rejected", () => {
  assert.throws(() => parseWarehouseBackup(LEGACY_RAW, "product"), /همین گدام/);
  const out = parseWarehouseBackup(LEGACY_RAW, "raw");
  assert.equal(out.format, "legacy");
  assert.equal(out.items[0].qty, 5000);
});

test("current format still works", () => {
  const out = parseWarehouseBackup(CURRENT, "product");
  assert.equal(out.format, "current");
  assert.equal(out.items[0].salePrice, 10);
  assert.equal(out.items[0].overheads?.[0]?.title, "هزینه");
});

test("workspace dump is not a warehouse backup", () => {
  assert.equal(isWarehouseBackupPayload({ tables: { items: [] } }), false);
});

// Local-only fixtures (real user files are not committed); skipped in CI.
const REAL_FIXTURES = existsSync("/workspace/backup-import-debug/file-a.json") && existsSync("/workspace/backup-import-debug/file-b.json");
test("real user attachment files parse (legacy)", { skip: !REAL_FIXTURES }, () => {
  const a = readFileSync("/workspace/backup-import-debug/file-a.json", "utf8");
  const b = readFileSync("/workspace/backup-import-debug/file-b.json", "utf8");
  const product = parseWarehouseBackup(a, "product");
  const raw = parseWarehouseBackup(b, "raw");
  assert.equal(product.format, "legacy");
  assert.equal(raw.format, "legacy");
  assert.ok(product.items.length >= 40);
  assert.ok(raw.items.length >= 110);
  assert.throws(() => parseWarehouseBackup(a, "raw"), /همین گدام/);
  assert.throws(() => parseWarehouseBackup(b, "product"), /همین گدام/);
});

test("real-file shape (name/kind/unit/qty/category/bom only) marks prices absent", () => {
  const raw = JSON.stringify({
    type: "hesabdar-warehouse",
    warehouse: "raw",
    items: [{ name: "آستر چینی", kind: "raw", unit: "متر", qty: 5000, category: "مال چینی", bom: [] }],
  });
  const it = parseWarehouseBackup(raw, "raw").items[0]!;
  assert.equal(it.qty, 5000);
  assert.deepEqual(it.has, { minQty: false, salePrice: false, purchasePrice: false });
});

test("price/min aliases (English, Persian, nested, Persian digits) are mapped", () => {
  const raw = JSON.stringify({
    type: "hesabdar-warehouse",
    warehouse: "raw",
    items: [
      { name: "a", sellPrice: "1,200", buyPrice: 900, minStock: 5 },
      { name: "b", "قیمت فروش": "۲۵۰", "قیمت خرید": "۱۵۰", "حداقل": "۳" },
      { name: "c", prices: { sale: 1, salePrice: 70, purchasePrice: 40 }, min_qty: 2 },
      { name: "d", salePrice: 0, purchasePrice: 10, minQty: 1 },
    ],
  });
  const [a, b, c, d] = parseWarehouseBackup(raw, "raw").items;
  assert.deepEqual([a!.salePrice, a!.purchasePrice, a!.minQty], [1200, 900, 5]);
  assert.deepEqual([b!.salePrice, b!.purchasePrice, b!.minQty], [250, 150, 3]);
  assert.deepEqual([c!.salePrice, c!.purchasePrice, c!.minQty], [70, 40, 2]);
  assert.deepEqual(d!.has, { minQty: true, salePrice: true, purchasePrice: true });
});
