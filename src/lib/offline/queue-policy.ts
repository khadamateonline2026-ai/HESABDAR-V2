/**
 * STR-04: rules for the offline write queue.
 *
 * - Every queued write carries its own idempotency key (see op-key.ts); it is
 *   sent on the first attempt and on every replay, so the server applies the
 *   write at most once.
 * - Saves that send a document's full state with an `id` (edit of an existing
 *   invoice, payment, item…) may be superseded: only the newest local version
 *   is sent.
 * - Increment-type requests (receiving part of a purchase invoice) are never
 *   merged or dropped — each one is a separate stock movement.
 * - Conflicts: posted documents are never overwritten. When the server rejects
 *   a replay (HTTP 409 / newer-version text), the server copy stays and the
 *   user is told to record a correcting or reversing document instead.
 */
const INCREMENT = /receivePurchaseInvoice/;

export function isIncrementRequest(exportName: string): boolean {
  return INCREMENT.test(exportName);
}

/** Queue key used for superseding; unique (never merged) for new docs and increments. */
export function entityKey(fnKey: string, exportName: string, body: string, unique: string): string {
  const id = /"id"\s*:\s*(\d+)/.exec(body)?.[1];
  if (!id || isIncrementRequest(exportName)) return `${fnKey}#new:${unique}`;
  return `${fnKey}#id:${id}`;
}

/** Whether queuing `next` makes the older queued row `old` obsolete. */
export function supersedes(old: { key: string; superseded: boolean }, next: { key: string }): boolean {
  return !old.superseded && old.key === next.key && old.key.includes("#id:");
}

export const CONFLICT_USER_MESSAGE =
  "سند ثبت‌شده قابل بازنویسی نیست؛ نسخه سرور ماند. برای اصلاح، سند اصلاحی یا برگشتی ثبت کنید.";
