import assert from "node:assert/strict";
import test from "node:test";
import { canManageRoleCodes, canView, canViewRoleCodes, canWrite } from "./permissions.ts";

const AREAS = [
  "company",
  "parties",
  "workers",
  "wages",
  "jobs",
  "currencies",
  "units",
  "accounts",
  "transfers",
  "capital",
  "opening",
  "purchase",
  "sales",
  "expenses",
  "payments",
  "warehouses",
  "reports",
  "notes",
  "settings",
  "dashboard",
] as const;

test("supervisor read-only view-all", () => {
  for (const area of AREAS) assert.equal(canView("supervisor", area), true);
  assert.equal(canWrite("supervisor", "sales"), false);
  assert.equal(canWrite("supervisor", "settings"), false);
  assert.equal(canViewRoleCodes("supervisor"), true);
  assert.equal(canManageRoleCodes("supervisor"), false);
});

test("accountant full write", () => {
  assert.equal(canWrite("accountant", "settings"), true);
  assert.equal(canView("accountant", "company"), true);
  assert.equal(canViewRoleCodes("accountant"), true);
  assert.equal(canManageRoleCodes("accountant"), true);
});

test("seller views all areas but not role-code settings; limited write", () => {
  for (const area of AREAS) assert.equal(canView("seller", area), true);
  assert.equal(canWrite("seller", "sales"), true);
  assert.equal(canWrite("seller", "workers"), true);
  assert.equal(canWrite("seller", "settings"), false);
  assert.equal(canWrite("seller", "company"), false);
  assert.equal(canWrite("seller", "accounts"), false);
  assert.equal(canViewRoleCodes("seller"), false);
  assert.equal(canManageRoleCodes("seller"), false);
});
