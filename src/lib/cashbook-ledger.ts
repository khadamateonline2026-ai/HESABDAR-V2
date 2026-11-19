/**
 * «روزنامچه دخل» → جدول «جزئیات»: one block per currency (one block per account when a
 * single account is selected — it has one currency): opening of the period, every
 * movement in date order with the running balance after it, and the totals.
 * Amounts are in each account's own currency, so blocks never mix currencies.
 */
import type { CashbookData, CashMovement } from "@/lib/api/cashbook";

export type LedgerRow = { m: CashMovement; running: number };
export type LedgerBlock = {
  currencyId: number;
  symbol: string;
  opening: number;
  rows: LedgerRow[];
  totalIn: number;
  totalOut: number;
  closing: number;
};

export function buildLedger(d: Pick<CashbookData, "accounts" | "movements">): LedgerBlock[] {
  const curOf = new Map(d.accounts.map((a) => [a.accountId, a.currencyId]));
  const blocks = new Map<number, LedgerBlock>();
  for (const a of d.accounts) {
    const b = blocks.get(a.currencyId) ?? {
      currencyId: a.currencyId,
      symbol: a.currencySymbol,
      opening: 0,
      rows: [],
      totalIn: 0,
      totalOut: 0,
      closing: 0,
    };
    b.opening += a.opening;
    blocks.set(a.currencyId, b);
  }
  for (const b of blocks.values()) b.closing = b.opening;
  for (const m of d.movements) {
    const b = blocks.get(curOf.get(m.accountId) ?? -1);
    if (!b) continue;
    b.totalIn += m.amountIn;
    b.totalOut += m.amountOut;
    b.closing += m.amountIn - m.amountOut;
    b.rows.push({ m, running: b.closing });
  }
  return [...blocks.values()];
}
