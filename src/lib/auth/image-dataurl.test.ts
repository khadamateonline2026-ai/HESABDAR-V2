import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeImageDataUrl } from "./image-dataurl.ts";

test("accepts small jpeg data url", () => {
  const url = "data:image/jpeg;base64,/9j/4AAQ";
  assert.equal(assertSafeImageDataUrl(url), url);
});

test("rejects non-image and oversized", () => {
  assert.equal(assertSafeImageDataUrl(null), null);
  assert.throws(() => assertSafeImageDataUrl("data:text/plain;base64,YQ=="), /مجاز/);
  const huge = "data:image/png;base64," + "A".repeat(900_000);
  assert.throws(() => assertSafeImageDataUrl(huge), /حجم/);
});
