/**
 * Accounting conflict policy for offline sync.
 *
 * - Posted (registered) documents are immutable.
 * - Edits create a new version or a reversing document; never overwrite posted rows.
 * - When server already has a newer version (HTTP 409 / Persian conflict text), keep server.
 * - Drafts may be superseded locally before sync (see engine supersede by entity key).
 */
export type ConflictDecision = "keep_server" | "keep_local" | "queue_reversal";

export function decideConflict(opts: {
  localPosted: boolean;
  serverPosted: boolean;
  serverNewer: boolean;
}): ConflictDecision {
  if (opts.serverPosted || opts.localPosted) return "keep_server";
  if (opts.serverNewer) return "keep_server";
  return "keep_local";
}

export const CONFLICT_USER_MESSAGE =
  "سند ثبت‌شده قابل بازنویسی نیست؛ نسخه سرور ماند. برای اصلاح، سند اصلاحی یا برگشتی ثبت کنید.";
