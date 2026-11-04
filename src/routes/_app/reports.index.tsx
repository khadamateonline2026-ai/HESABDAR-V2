import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DateText } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { FilterTable } from "@/components/filter-table";
import { DateRangeBar, ReportSheet, SummaryStats, dateRangeError, inDateRange } from "@/components/report-tools";
import { getInventory } from "@/lib/api/inventory";
import { getSalesLedger } from "@/lib/api/reports";
import { formatMoney, formatMoneySymbol } from "@/lib/format";
import { formatPreferredDate } from "@/lib/jalali";
import { useCalendarMode } from "@/lib/prefs";
import type { SaleLedgerRow } from "@/lib/types";

export const Route = createFileRoute("/_app/reports/")({ component: SalesReport });

function SalesReport() {
  const [itemId, setItemId] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const ledger = useQuery({
    queryKey: ["sales-ledger", itemId],
    queryFn: () => getSalesLedger({ data: { itemId } }),
  });
  const inv = useQuery({ queryKey: ["inventory"], queryFn: () => getInventory() });
  const rangeErr = dateRangeError(from, to);
  const rows = useMemo(() => {
    const all = ledger.data?.rows ?? [];
    if (rangeErr) return all;
    return all.filter((r) => inDateRange(r.occurredOn, from, to));
  }, [ledger.data?.rows, from, to, rangeErr]);
  const summary = ledger.data?.summary ?? null;
  const stockCard =
    itemId == null
      ? null
      : (inv.data?.products.find((p) => p.itemId === itemId) ??
        inv.data?.raw.find((p) => p.itemId === itemId) ??
        null);
  const liveStock = stockCard?.qty ?? 0;

  return (
    <ReportSheet title="گزارش فروشات">
      <section className="rounded-md border border-border bg-bg-warm/40 p-4">
        <h2 className="mb-3 text-base font-semibold">خلاصه فروش مدل</h2>
        <div className="max-w-md">
          <p className="mb-1.5 text-sm font-medium">نوع مدل</p>
          <EntitySelect
            value={itemId}
            placeholder="یک مدل را انتخاب کنید"
            options={(ledger.data?.models ?? []).map((m) => ({ id: m.id, label: m.name }))}
            onChange={(id) => setItemId(id == null ? null : Number(id))}
          />
        </div>
        {!itemId ? (
          <p className="mt-4 text-sm text-muted">یک مدل را انتخاب کنید</p>
        ) : (
          <SummaryStats
            items={[
              { label: "تعداد فروخته‌شده", value: formatMoney(summary?.qtySold ?? 0) },
              { label: "مبلغ فروش", value: formatMoneySymbol(summary?.amountSold ?? 0) },
              {
                label: "موجودی گدام",
                value: inv.isPending ? "…" : formatMoney(liveStock),
              },
              { label: "قیمت تمام‌شده", value: formatMoneySymbol(stockCard?.unitCost ?? summary?.unitCost ?? 0) },
            ]}
          />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">گزارش تمام فروشات</h2>
        <DateRangeBar from={from} to={to} onFrom={setFrom} onTo={setTo} onClear={() => { setFrom(""); setTo(""); }} error={rangeErr} />
        <LedgerTable rows={rows} />
      </section>
    </ReportSheet>
  );
}

function LedgerTable({ rows }: { rows: SaleLedgerRow[] }) {
  const cal = useCalendarMode();
  return (
    <FilterTable
      tone="c"
      rows={rows}
      rowKey={(r) => r.id}
      empty="فروشی ثبت نشده است"
      columns={[
        {
          key: "n",
          header: "شماره",
          filterable: false,
          value: () => "",
          cell: (_r, i) => <span className="tabular-nums">{i + 1}</span>,
        },
        {
          key: "date",
          header: "تاریخ",
          value: (r) => formatPreferredDate(r.occurredOn, cal),
          cell: (r) => <DateText iso={r.occurredOn} />,
        },
        {
          key: "inv",
          header: "شماره فاکتور",
          value: (r) => r.invoiceNo,
          cell: (r) => <span className="tabular-nums">{r.invoiceNo}</span>,
        },
        { key: "kind", header: "نوعیت جنس", value: (r) => r.itemKindLabel, cell: (r) => r.itemKindLabel },
        { key: "name", header: "نام محصول", value: (r) => r.itemName, cell: (r) => r.itemName },
        {
          key: "qty",
          header: "تعداد",
          value: (r) => formatMoney(r.quantity),
          cell: (r) => <span className="tabular-nums">{formatMoney(r.quantity)}</span>,
        },
        {
          key: "price",
          header: "قیمت فی",
          value: (r) => formatMoney(r.unitPriceBase),
          cell: (r) => <span className="tabular-nums">{formatMoneySymbol(r.unitPriceBase)}</span>,
        },
        {
          key: "total",
          header: "قیمت کل",
          value: (r) => formatMoney(r.totalBase),
          cell: (r) => <span className="tabular-nums font-medium">{formatMoneySymbol(r.totalBase)}</span>,
        },
      ]}
      footer={(visible) => {
        const cell =
          "border-t border-border px-2 py-2 text-center align-middle leading-none whitespace-nowrap tabular-nums sm:px-2.5";
        return (
          <tr className="bg-surface-2 font-bold">
            <td className="border-t border-border px-2 py-2 text-start align-middle leading-none whitespace-nowrap sm:px-2.5">
              مجموع
            </td>
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell} />
            <td className={cell}>{formatMoney(visible.reduce((s, r) => s + r.quantity, 0))}</td>
            <td className={cell} />
            <td className={cell}>{formatMoneySymbol(visible.reduce((s, r) => s + r.totalBase, 0))}</td>
          </tr>
        );
      }}
    />
  );
}

