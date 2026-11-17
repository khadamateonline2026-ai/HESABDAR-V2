# تعریف شاخص‌های داشبورد (ACC-12)

All amounts are in the base currency (؋).

| Figure | Basis | Definition |
|---|---|---|
| فروش (sales) | Accrual | Final sale lines on their date, at the invoice's frozen rate (`fx_enabled` + `fx_rate`); lines without an invoice rate use today's currency rate. |
| بهای تمام‌شده (COGS) | Accrual | Weighted-average cost at the time of each sale (`loadInventoryValuation().saleCosts`). |
| هزینه (expenses) | Cash | Expenses paid from an account (not `as_debt`) at the rate frozen when paid, plus salaries paid to salaried workers. Expenses booked as debt are **not** in profit until paid; they show under «بدهی هزینه». This mix (accrual sales, cash expenses) is deliberate and kept as is. |
| سود (profit) | Mixed | فروش − بهای تمام‌شده − هزینه. |
| طلب از مشتریان | Balance | Sum of customers whose balance is positive (they owe us). |
| پیش‌دریافت از مشتریان | Balance | Sum of customers whose balance is negative (paid in advance); shown as an info alert, not netted against receivables. |
| پیش‌پرداخت / بدهی به فروشنده | Balance | Vendors with a negative / positive balance. |
| معاش و پرداخت کارگر | Base currency | Dues use today's rate of the salary currency; payments use their frozen rate (ACC-06). |
| گدام‌ها | Stock cards | `loadWarehouseStock`: stock-card quantity and value, split over warehouses by opening stock and receipts (ACC-10). |

Party statements settle foreign-currency balances at the implied average rate of that party's documents (`settleRate`); this is a reporting choice, not a booked FX gain or loss.
