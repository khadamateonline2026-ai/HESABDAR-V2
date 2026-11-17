/**
 * ACC-12: KPI definitions shared by the dashboard (see docs/KPI.md).
 * A party balance > 0 is money they owe us (receivable); < 0 is money we hold
 * for them (a customer advance / vendor prepayment). Both sides are reported
 * instead of dropping the negative side.
 */
export function splitPartyBalances(summaries: { remainingBase: number }[]): { owedToUs: number; heldForThem: number } {
  let owedToUs = 0;
  let heldForThem = 0;
  for (const s of summaries) {
    if (s.remainingBase > 1e-9) owedToUs += s.remainingBase;
    else if (s.remainingBase < -1e-9) heldForThem += -s.remainingBase;
  }
  return { owedToUs, heldForThem };
}
