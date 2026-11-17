/**
 * SEC-05: offline data belongs to exactly one signed-in user.
 * Pure rules used by engine.ts (kept DOM-free so they can be unit-tested).
 */

export type OwnedRow = { id: number; owner?: string | null; superseded?: boolean };

/** Header the replay sends; the server refuses it under any other user. */
export const OFFLINE_OWNER_HEADER = "x-hesabdar-owner";

/**
 * Who owned this device's offline data before now. `stored` is the explicit
 * owner key; for data written before owners were tracked, fall back to the
 * user in the last cached session (the last person signed in here).
 */
export function previousOwner(stored: string | null, cachedSessionJson: string | null): string | null {
  if (stored) return stored;
  if (!cachedSessionJson) return null;
  try {
    const parsed = JSON.parse(cachedSessionJson) as { user?: { id?: unknown } } | null;
    const id = parsed?.user?.id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/** A different user is now signed in: everything cached/queued must go. */
export function mustWipe(previous: string | null, next: string | null): boolean {
  return Boolean(next && previous && previous !== next);
}

/** Owner of an untagged (legacy) row, if it can be attributed. */
export function rowOwner(row: OwnedRow, previous: string | null): string | null {
  return row.owner ?? previous ?? null;
}

/** Split the queue: rows replayable by `owner`, and rows that must be dropped. */
export function partitionQueue<T extends OwnedRow>(
  rows: T[],
  owner: string | null,
  previous: string | null,
): { replay: T[]; drop: T[] } {
  const replay: T[] = [];
  const drop: T[] = [];
  for (const row of rows) {
    const who = rowOwner(row, previous);
    if (owner && who === owner) replay.push(row);
    else if (owner) drop.push(row); // another user's (or unattributable) write: never replay
    // owner unknown (signed out / loading): keep, decide later
  }
  return { replay, drop };
}
