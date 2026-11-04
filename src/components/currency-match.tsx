import { convertAmount, formatMoney, parseAmount, rateToBaseOf } from "@/lib/format";
import type { Account, Currency } from "@/lib/types";

export function CurrencyMatchNote({
  accounts,
  currencies,
  accountId,
  currencyId,
  amount,
  verb = "کسر",
  fromRate,
}: {
  accounts: Account[];
  currencies: Currency[];
  accountId: number | null;
  currencyId: number | null;
  amount: number | string;
  verb?: "کسر" | "افزودن";
  fromRate?: number;
}) {
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc || currencyId == null || acc.currencyId === currencyId) return null;
  const n = typeof amount === "string" ? parseAmount(amount) : amount;
  const srcRate = fromRate && fromRate > 1e-12 ? fromRate : rateToBaseOf(currencies, currencyId);
  const equiv = convertAmount(n, srcRate, rateToBaseOf(currencies, acc.currencyId));
  const cur = currencies.find((c) => c.id === currencyId);
  return (
    <p className="rounded-sm border border-danger/50 bg-danger-soft px-3 py-2 text-2xs leading-relaxed text-danger">
      ارز مبلغ ({cur?.symbol || "—"}) با ارز دخل «{acc.name}» ({acc.currencySymbol}) یکسان نیست.
      مبلغ با نرخ ثبت‌شده به ارز دخل تبدیل می‌شود.
      {n > 0 ? (
        <>
          {" "}
          معادل {verb} از دخل:{" "}
          <span className="tabular-nums" dir="ltr">
            {formatMoney(equiv)} {acc.currencySymbol}
          </span>
        </>
      ) : null}
    </p>
  );
}

export function syncCurrencyToAccount(
  accounts: Account[],
  accountId: number | null,
  setCurrency: (id: number | null) => void,
) {
  const a = accounts.find((x) => x.id === accountId);
  if (a) setCurrency(a.currencyId);
}
