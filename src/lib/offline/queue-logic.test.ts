import assert from "node:assert/strict";
import test from "node:test";

/** Mirrors entityKey + supersede rule used by the offline outbox. */
function entityKey(url: string, body: string) {
  const id = /"id"\s*:\s*(\d+)/.exec(body)?.[1];
  const fn = url.split("/").pop() || url;
  return id ? `${fn}#id:${id}` : `${fn}#new:${Date.now()}:${Math.random()}`;
}

test("entityKey stable for same id", () => {
  const a = entityKey("/_server/saveSaleInvoice", '{"id":42,"x":1}');
  const b = entityKey("/_server/saveSaleInvoice", '{"id":42,"x":2}');
  assert.equal(a, b);
  assert.match(a, /#id:42$/);
});

test("entityKey unique for new drafts", () => {
  const a = entityKey("/_server/saveSaleInvoice", '{"x":1}');
  const b = entityKey("/_server/saveSaleInvoice", '{"x":1}');
  assert.notEqual(a, b);
});
