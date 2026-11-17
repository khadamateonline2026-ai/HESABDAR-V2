import assert from "node:assert/strict";
import test from "node:test";
import { entityKey, isIncrementRequest, supersedes } from "./queue-policy.ts";
import { isOpKey, newOpKey } from "./op-key.ts";

test("full-state edits of the same document supersede each other", () => {
  const a = entityKey("fnA", "saveSaleInvoice", '{"id":42,"x":1}', "k1");
  const b = entityKey("fnA", "saveSaleInvoice", '{"id":42,"x":2}', "k2");
  assert.equal(a, b);
  assert.ok(supersedes({ key: a, superseded: false }, { key: b }));
});

test("new documents are never merged", () => {
  const a = entityKey("fnA", "saveSaleInvoice", '{"x":1}', "k1");
  const b = entityKey("fnA", "saveSaleInvoice", '{"x":1}', "k2");
  assert.notEqual(a, b);
  assert.ok(!supersedes({ key: a, superseded: false }, { key: b }));
});

test("STR-04 bug: two offline partial receives of one invoice must both be kept", () => {
  // Before: entityKey keyed by `#id:` and the second receive dropped the first.
  assert.ok(isIncrementRequest("receivePurchaseInvoice"));
  const a = entityKey("fnR", "receivePurchaseInvoice", '{"id":7,"lines":[{"qty":2}]}', "k1");
  const b = entityKey("fnR", "receivePurchaseInvoice", '{"id":7,"lines":[{"qty":3}]}', "k2");
  assert.notEqual(a, b);
  assert.ok(!supersedes({ key: a, superseded: false }, { key: b }));
});

test("op keys are random and accepted by the server check", () => {
  const a = newOpKey();
  const b = newOpKey();
  assert.notEqual(a, b);
  assert.ok(isOpKey(a) && isOpKey(b));
  assert.ok(!isOpKey("x") && !isOpKey("a'; drop table x;--aaaaaaaaaaaa") && !isOpKey(null));
});
