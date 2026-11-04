import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDelete } from "@/components/confirm-delete";
import { DateText } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { FilterTable } from "@/components/filter-table";
import { IconBtn } from "@/components/icon-btn";
import { AfAmount } from "@/components/invoice-ui";
import { PaymentModal } from "@/components/payment-modal";
import { DateRangeBar, ReportSheet, SummaryStats, dateRangeError, inDateRange } from "@/components/report-tools";
import { useAppData } from "@/components/layout/app-shell";
import { deletePartyPayment, getPartyStatement } from "@/lib/api/reports";
import { deleteTransfer } from "@/lib/api/finance";
import type { ExpenseDebt } from "@/lib/api/reports";
import { formatMoney, formatMoneySymbol } from "@/lib/format";
import { formatPreferredDate } from "@/lib/jalali";
import { canWrite } from "@/lib/permissions";
import { useCalendarMode } from "@/lib/prefs";
import { queryClient } from "@/lib/query-client";
import type { PartyPayment, PartySummary, PurchaseLedgerRow, SaleLedgerRow } from "@/lib/types";

export function PartyStatement({
  kind,
  title,
  selectLabel,
  invoicedLabel,
  paidLabel,
  invoiceKindHeader,
  paymentTitle,
  paymentKind,
  addPaymentLabel,
  remainingLabel,
  summaryTitle,
  showDateFilter = false,
}: {
  kind: "customer" | "vendor";
  title: string;
  selectLabel: string;
  invoicedLabel: string;
  paidLabel: string;
  invoiceKindHeader: string;
  paymentTitle: string;
  paymentKind: "receipt" | "payment";
  addPaymentLabel: string;
  remainingLabel: string;
  summaryTitle: string;
  showDateFilter?: boolean;
}) {
  const { data } = useAppData();
  const cal = useCalendarMode();
  const writable = canWrite(data?.profile?.role, kind === "customer" ? "sales" : "purchase");
  const [partyId, setPartyId] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [del, setDel] = useState<PartyPayment | null>(null);
  const customers = (data?.catalogs.parties ?? []).filter((p) => p.kind === "customer");
  const selectedCustomer = kind === "vendor" && partyId != null && customers.some((c) => c.id === partyId);
  const st = useQuery({
    queryKey: ["party-statement", kind, selectedCustomer ? null : partyId, from, to],
    queryFn: () =>
      getPartyStatement({
        data: { kind, partyId: selectedCustomer ? null : partyId, from: from || null, to: to || null },
      }),
  });
  const customerSt = useQuery({
    queryKey: ["party-statement", "customer-credit", partyId, from, to],
    queryFn: () => getPartyStatement({ data: { kind: "customer", partyId, from: from || null, to: to || null } }),
    enabled: selectedCustomer,
  });
  const rangeErr = dateRangeError(from, to);

  const detail = selectedCustomer ? customerSt.data : st.data;
  const invoices = useMemo(() => {
    const all = (detail?.invoices ?? []) as (SaleLedgerRow | PurchaseLedgerRow)[];
    if (!showDateFilter || rangeErr) return all;
    return all.filter((r) => inDateRange(r.occurredOn, from, to));
  }, [detail?.invoices, from, to, rangeErr, showDateFilter]);

  const payments = useMemo(() => {
    const all = detail?.payments ?? [];
    if (!showDateFilter || rangeErr) return all;
    return all.filter((r) => inDateRange(r.occurredOn, from, to));
  }, [detail?.payments, from, to, rangeErr, showDateFilter]);

  const invoiced = invoices.reduce((s, r) => s + r.totalBase, 0);
  const paid = payments.reduce((s, r) => s + r.amountBase, 0);
  const rawRemaining = invoiced - paid;
  const remaining = selectedCustomer ? (rawRemaining < -1e-9 ? Math.abs(rawRemaining) : 0) : rawRemaining;
  const summaries: PartySummary[] = (st.data?.summaries ?? []).filter((s) =>
    s.prepaid ? s.remainingBase > 1e-9 : s.remainingBase > 1e-9,
  );
  const cashPartyRows: PartySummary[] = (data?.catalogs.accounts ?? [])
    .filter((a) => a.kind === "counterparty")
    .filter((a) => (kind === "customer" ? a.balance > 1e-9 : a.balance < -1e-9))
    .map((a) => {
      const rate = data?.catalogs.currencies.find((c) => c.id === a.currencyId)?.rateToBase || 1;
      const remainingBase = Math.abs(a.balance) * rate;
      const openBase = Math.abs(a.openingBalance) * rate;
      const invoicedBase = Math.max(openBase, remainingBase);
      return {
        id: -a.id,
        name: `${a.name} (نقدی)`,
        invoicedBase,
        paidBase: Math.max(0, invoicedBase - remainingBase),
        remainingBase,
      };
    });
  const summaryRows = [...summaries, ...cashPartyRows];
  const expenseDebts: ExpenseDebt[] = st.data?.expenseDebts ?? [];

  const dateFilterBar = showDateFilter ? (
    <DateRangeBar
      from={from}
      to={to}
      onFrom={setFrom}
      onTo={setTo}
      onClear={() => {
        setFrom("");
        setTo("");
      }}
      error={rangeErr}
    />
  ) : null;

  return (
    <ReportSheet
      title={title}
      lead={
        <>
          <h2 className="text-base font-semibold">{summaryTitle}</h2>
          <div className="dash-card list-card overflow-x-auto">
            <table className="w-max min-w-full border-separate border-spacing-0 text-2xs sm:text-sm">
              <thead>
                <tr>
                  <th className="border-b border-border px-2 py-2 text-center text-sm font-bold whitespace-nowrap">طرف حساب</th>
                  <th className="border-b border-border px-2 py-2 text-center text-sm font-bold whitespace-nowrap">مجموع</th>
                  <th className="border-b border-border px-2 py-2 text-center text-sm font-bold whitespace-nowrap">تسویه</th>
                  <th className="border-b border-border px-2 py-2 text-center text-sm font-bold whitespace-nowrap">{remainingLabel}</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.length ? (
                  summaryRows.map((s) => (
                    <tr key={`${s.id}-${s.name}`}>
                      <td className="border-b border-border px-2 py-2 text-center whitespace-nowrap">
                        {s.name}
                        {s.prepaid ? <span className="mr-1 text-micro text-muted">پیش‌پرداخت</span> : null}
                      </td>
                      <td className="border-b border-border px-2 py-2 text-center whitespace-nowrap">
                        <AfAmount value={s.invoicedBase} />
                      </td>
                      <td className="border-b border-border px-2 py-2 text-center whitespace-nowrap">
                        <AfAmount value={s.paidBase} />
                      </td>
                      <td className="border-b border-border px-2 py-2 text-center font-medium whitespace-nowrap">
                        <AfAmount value={s.remainingBase} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-muted">
                      موردی نیست
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {kind === "vendor" ? dateFilterBar : null}
          {kind === "vendor" && expenseDebts.length ? (
            <div className="dash-card list-card overflow-x-auto">
              <h3 className="px-3 pt-3 text-sm font-medium">بدهی‌های متفرقه</h3>
              <table className="w-max min-w-full border-separate border-spacing-0 text-2xs sm:text-sm">
                <thead>
                  <tr>
                    <th className="border-b border-border px-2 py-2 text-center text-sm font-bold whitespace-nowrap">تشریح</th>
                    <th className="border-b border-border px-2 py-2 text-center text-sm font-bold whitespace-nowrap">طرف حساب</th>
                    <th className="border-b border-border px-2 py-2 text-center text-sm font-bold whitespace-nowrap">تاریخ</th>
                    <th className="border-b border-border px-2 py-2 text-center text-sm font-bold whitespace-nowrap">مبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {expenseDebts.map((e) => (
                    <tr key={`${e.source}-${e.id}`}>
                      <td className="border-b border-border px-2 py-2 text-center whitespace-nowrap">
                        {e.title}
                        {e.source === "recurring" ? (
                          <span className="mr-1 text-micro text-muted">تکراری</span>
                        ) : e.source === "salary" ? (
                          <span className="mr-1 text-micro text-muted">معاش</span>
                        ) : null}
                      </td>
                      <td className="border-b border-border px-2 py-2 text-center whitespace-nowrap">
                        {e.partyName || "—"}
                      </td>
                      <td className="border-b border-border px-2 py-2 text-center whitespace-nowrap">
                        <DateText iso={e.occurredOn} />
                      </td>
                      <td className="border-b border-border px-2 py-2 text-center whitespace-nowrap">
                        <AfAmount value={e.amountBase} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      }
    >
      {kind === "customer" ? dateFilterBar : null}
      <section className="rounded-md border border-border bg-bg-warm/40 p-4">
        <div className="max-w-md">
          <p className="mb-1.5 text-sm font-medium">{selectLabel}</p>
          <EntitySelect
            value={partyId}
            placeholder={`${selectLabel} را انتخاب کنید`}
            options={[
              ...(st.data?.parties ?? []).map((p) => ({ id: p.id, label: p.name })),
              ...(kind === "vendor"
                ? customers
                    .filter((c) => !(st.data?.parties ?? []).some((p) => p.id === c.id))
                    .map((c) => ({ id: c.id, label: c.name }))
                : []),
            ]}
            onChange={(id) => setPartyId(id == null ? null : Number(id))}
          />
        </div>
        {!partyId ? (
          <p className="mt-4 text-sm text-muted">یک {selectLabel} را انتخاب کنید</p>
        ) : (
          <>
            <h3 className="mt-4 text-lg font-semibold">
              {selectedCustomer ? customers.find((c) => c.id === partyId)?.name : detail?.partyName}
            </h3>
            <SummaryStats
              items={[
                { label: selectedCustomer ? "مجموع فروش" : invoicedLabel, value: formatMoneySymbol(invoiced) },
                { label: selectedCustomer ? "مجموع دریافتی" : paidLabel, value: formatMoneySymbol(paid) },
                { label: selectedCustomer ? "طلب از شرکت" : remainingLabel, value: formatMoneySymbol(remaining) },
              ]}
            />
          </>
        )}
      </section>

      {partyId ? (
        <>
          <section>
            <h2 className="mb-3 text-base font-semibold">فاکتورها</h2>
            <FilterTable
              tone="c"
              rows={invoices}
              rowKey={(r) => r.id}
              empty="فاکتوری ثبت نشده است"
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
                {
                  key: "kind",
                  header: invoiceKindHeader,
                  value: (r) => r.itemName || r.itemKindLabel,
                  cell: (r) => r.itemName || r.itemKindLabel,
                },
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
                  header: "قیمت مجموع",
                  value: (r) => formatMoney(r.totalBase),
                  cell: (r) => <span className="tabular-nums font-medium">{formatMoneySymbol(r.totalBase)}</span>,
                },
              ]}
              footer={(visible) => (
                <tr className="bg-surface-2 font-medium">
                  <td className="border-t border-border px-2 py-2 text-center whitespace-nowrap" colSpan={4}>
                    مجموع ({visible.length} ردیف)
                  </td>
                  <td className="border-t border-border px-2 py-2 text-center tabular-nums whitespace-nowrap">
                    {formatMoney(visible.reduce((s, r) => s + r.quantity, 0))}
                  </td>
                  <td className="border-t border-border px-2 py-2" />
                  <td className="border-t border-border px-2 py-2 text-center tabular-nums whitespace-nowrap">
                    {formatMoneySymbol(visible.reduce((s, r) => s + r.totalBase, 0))}
                  </td>
                </tr>
              )}
            />
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">{paymentTitle}</h2>
              {writable ? (
                <button
                  type="button"
                  onClick={() => setPayOpen(true)}
                  className="add-box no-print"
                  aria-label={addPaymentLabel}
                >
                  <Plus className="size-4" />
                </button>
              ) : (
                <span className="size-8" />
              )}
            </div>
            <FilterTable
              tone="c"
              rows={payments}
              rowKey={(r) => r.id}
              empty="موردی ثبت نشده است"
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
                  key: "no",
                  header: "شماره قبض",
                  value: (r) => r.receiptNo,
                  cell: (r) => <span className="tabular-nums">{r.receiptNo}</span>,
                },
                {
                  key: "amt",
                  header: "مبلغ",
                  value: (r) => formatMoney(r.amount),
                  cell: (r) => (
                    <span className="tabular-nums whitespace-nowrap">
                      {formatMoney(r.amount)} {r.currencySymbol}
                    </span>
                  ),
                },
                {
                  key: "base",
                  header: "معادل",
                  value: (r) => formatMoney(r.amountBase),
                  cell: (r) => <AfAmount value={r.amountBase} />,
                },
                {
                  key: "act",
                  header: "",
                  filterable: false,
                  className: "no-print",
                  value: () => "",
                  cell: (r) => (
                    <IconBtn kind="delete" onClick={() => setDel(r)} disabled={!writable || r.id <= 0} />
                  ),
                },
              ]}
              footer={(visible) => (
                <tr className="bg-surface-2 font-medium">
                  <td className="border-t border-border px-2 py-2 text-center whitespace-nowrap" colSpan={3}>
                    مجموع
                  </td>
                  <td className="border-t border-border px-2 py-2" />
                  <td className="border-t border-border px-2 py-2 text-center tabular-nums whitespace-nowrap">
                    {formatMoneySymbol(visible.reduce((s, r) => s + r.amountBase, 0))}
                  </td>
                  <td className="no-print border-t border-border px-2 py-2" />
                </tr>
              )}
            />
          </section>
        </>
      ) : null}

      {payOpen && partyId ? (
        <PaymentModal
          kind={paymentKind}
          partyId={partyId}
          title={addPaymentLabel}
          onClose={() => setPayOpen(false)}
        />
      ) : null}
      <ConfirmDelete
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          if (partyId != null && partyId < 0) {
            if (del.id > 0) await deleteTransfer({ data: { id: del.id } });
          } else {
            await deletePartyPayment({ data: { id: del.id } });
          }
          await queryClient.invalidateQueries({ queryKey: ["party-statement"] });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        }}
      />
    </ReportSheet>
  );
}
