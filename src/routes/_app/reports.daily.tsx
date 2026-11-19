import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { DateText } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { useAppData } from "@/components/layout/app-shell";
import { DateRangeBar, ReportSheet, SummaryStats, dateRangeError } from "@/components/report-tools";
import { getCashbook, type CashMovement, type NonCashRow } from "@/lib/api/cashbook";
import { tablesToSheets } from "@/lib/excel";
import { formatMoney, formatMoneySymbol, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/reports/daily")({ component: DailyCashbook });

const TITLE = "روزنامچه دخل";

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function money(v: number, symbol: string) {
  return Math.abs(v) <= 1e-9 ? "—" : formatMoneySymbol(v, symbol);
}

function DailyCashbook() {
  const { data: app } = useAppData();
  const today = todayIso();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [currencyId, setCurrencyId] = useState<number | null>(null);
  const rangeErr = dateRangeError(from, to);
  const ready = Boolean(from && to && !rangeErr);
  const q = useQuery({
    queryKey: ["cashbook", from, to, accountId, currencyId],
    queryFn: () => getCashbook({ data: { from, to, accountId, currencyId } }),
    enabled: ready,
  });
  const body = useRef<HTMLDivElement>(null);
  const accounts = app?.catalogs.accounts ?? [];
  const currencies = app?.catalogs.currencies ?? [];
  const d = q.data;
  const single = accountId != null && d?.accounts.length === 1 ? d.accounts[0] : null;
  const preset = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
  };

  async function saveExcel() {
    const node = body.current;
    if (!node) return;
    try {
      const { downloadExcel } = await import("@/lib/excel-write");
      await downloadExcel(`${TITLE} ${from}${from === to ? "" : ` ${to}`}`, tablesToSheets(node));
    } catch {
      toast.error("ذخیره اکسل ناکام شد");
    }
  }

  const lead = (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {[
          { label: "امروز", f: today, t: today },
          { label: "دیروز", f: shiftDay(today, -1), t: shiftDay(today, -1) },
          { label: "هفت روز اخیر", f: shiftDay(today, -6), t: today },
        ].map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => preset(p.f, p.t)}
            className={cn(
              "company-chip h-10 rounded-md border text-sm font-medium",
              from === p.f && to === p.t ? "chip-on border-white/70" : "border-white/25",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <DateRangeBar from={from} to={to} onFrom={setFrom} onTo={setTo} onClear={() => preset(today, today)} error={rangeErr} />
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <span className="mb-1.5 block truncate text-sm font-medium">دخل / حساب</span>
          <EntitySelect
            value={accountId ?? "all"}
            options={[
              { id: "all", label: "همه حساب‌ها" },
              ...accounts.map((a) => ({ id: a.id, label: `${a.name} (${a.currencySymbol})` })),
            ]}
            onChange={(id) => setAccountId(id == null || id === "all" ? null : Number(id))}
          />
        </div>
        <div className="min-w-0">
          <span className="mb-1.5 block truncate text-sm font-medium">ارز</span>
          <EntitySelect
            value={currencyId ?? "all"}
            options={[{ id: "all", label: "همه ارزها" }, ...currencies.map((c) => ({ id: c.id, label: `${c.name} (${c.symbol})` }))]}
            onChange={(id) => setCurrencyId(id == null || id === "all" ? null : Number(id))}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={() => void saveExcel()}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface text-sm hover:bg-surface-2"
      >
        <FileSpreadsheet className="size-4" /> ذخیره اکسل
      </button>
    </div>
  );

  return (
    <ReportSheet title={TITLE} lead={lead}>
      <div ref={body} className="space-y-4">
        <p className="text-sm text-muted">
          {from === to ? (
            <>
              روز <DateText iso={from} />
            </>
          ) : (
            <>
              از <DateText iso={from} /> الی <DateText iso={to} />
            </>
          )}
        </p>
        {!ready ? (
          <p className="text-sm text-muted">بازه تاریخ را درست انتخاب کنید</p>
        ) : q.isPending ? (
          <div className="h-40 animate-pulse rounded-md bg-border/60" />
        ) : q.isError || !d ? (
          <p className="text-sm text-danger">بارگذاری گزارش ناکام شد</p>
        ) : (
          <>
            <section>
              <h2 className="mb-3 text-base font-semibold">خلاصه هر دخل</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {d.accounts.map((a) => (
                  <div key={a.accountId} className="dash-card rounded-lg border border-border p-3">
                    <p className="truncate text-sm font-semibold">
                      {a.name} <span className="text-muted">({a.currencySymbol} · {a.kind})</span>
                    </p>
                    <SummaryStats
                      items={[
                        { label: "موجودی اول", value: formatMoneySymbol(a.opening, a.currencySymbol) },
                        { label: "ورود", value: formatMoneySymbol(a.totalIn, a.currencySymbol) },
                        { label: "خروج", value: formatMoneySymbol(a.totalOut, a.currencySymbol) },
                        { label: "موجودی آخر", value: formatMoneySymbol(a.closing, a.currencySymbol) },
                      ]}
                    />
                  </div>
                ))}
              </div>
              <div className="dash-card mt-3 rounded-lg border border-border p-3">
                <p className="text-sm font-semibold">مجموع به افغانی</p>
                <SummaryStats
                  items={[
                    { label: "موجودی اول (نرخ امروز)", value: formatMoneySymbol(d.totals.openingBaseNow) },
                    { label: "کل ورود (نرخ روز ثبت)", value: formatMoneySymbol(d.totals.baseIn) },
                    { label: "کل خروج (نرخ روز ثبت)", value: formatMoneySymbol(d.totals.baseOut) },
                    { label: "موجودی آخر (نرخ امروز)", value: formatMoneySymbol(d.totals.closingBaseNow) },
                  ]}
                />
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-base font-semibold">به تفکیک نوع</h2>
              <DataTable
                tone="a"
                excel={false}
                rows={[
                  ...d.groups.map((g) => ({ key: g.group, label: g.label, count: g.count, baseIn: g.baseIn, baseOut: g.baseOut })),
                  { key: "total", label: "مجموع", count: d.movements.length, baseIn: d.totals.baseIn, baseOut: d.totals.baseOut },
                ]}
                rowKey={(r) => r.key}
                empty="در این بازه ورود و خروجی نیست"
                columns={[
                  { header: "نوع", cell: (r) => <span className={r.key === "total" ? "font-bold" : undefined}>{r.label}</span> },
                  { header: "تعداد", cell: (r) => <span className="tabular-nums">{formatMoney(r.count)}</span> },
                  { header: "ورود (؋)", cell: (r) => <span className="tabular-nums">{money(r.baseIn, "؋")}</span> },
                  { header: "خروج (؋)", cell: (r) => <span className="tabular-nums">{money(r.baseOut, "؋")}</span> },
                ]}
              />
            </section>

            <section>
              <h2 className="mb-3 text-base font-semibold">ریز ورود و خروج</h2>
              <div className="hidden sm:block">
                <DataTable
                  tone="c"
                  excel={false}
                  rows={d.movements}
                  rowKey={(m) => m.key}
                  empty="در این بازه ورود و خروجی نیست"
                  columns={[
                    { header: "تاریخ", cell: (m) => <DateText iso={m.date} /> },
                    { header: "نوع", cell: (m) => m.typeLabel },
                    { header: "شرح / طرف حساب", className: "whitespace-normal text-start", cell: (m) => describe(m) },
                    { header: "شماره", cell: (m) => <span className="tabular-nums">{m.docNo || "—"}</span> },
                    { header: "دخل", cell: (m) => m.accountName },
                    { header: "ورود", cell: (m) => <span className="tabular-nums">{money(m.amountIn, m.currencySymbol)}</span> },
                    { header: "خروج", cell: (m) => <span className="tabular-nums text-danger">{money(m.amountOut, m.currencySymbol)}</span> },
                    ...(single
                      ? [{ header: "مانده", cell: (m: CashMovement) => <span className="tabular-nums">{formatMoneySymbol(m.running ?? 0, m.currencySymbol)}</span> }]
                      : []),
                  ]}
                />
              </div>
              <MobileRows rows={d.movements} />
            </section>

            <section>
              <details className="dash-card rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-sm font-semibold">
                  <h3 className="inline">بدون نقد (فقط اطلاع)</h3>
                  <span className="ms-2 text-muted">— در مجموع دخل حساب نمی‌شود</span>
                </summary>
                <div className="mt-3">
                  <NonCashTable rows={d.nonCash} />
                </div>
              </details>
            </section>
          </>
        )}
      </div>
    </ReportSheet>
  );
}

function describe(m: CashMovement) {
  const parts = [m.party, m.description].filter(Boolean).join(" — ") || "—";
  return m.originalAmount != null ? `${parts} (${formatMoney(m.originalAmount)} ${m.originalSymbol})` : parts;
}

/** Mobile: two-line rows — type + amount, then party/description, date and account. */
function MobileRows({ rows }: { rows: CashMovement[] }) {
  return (
    <div className="dash-card list-card overflow-hidden sm:hidden">
      {rows.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-muted">در این بازه ورود و خروجی نیست</p>
      ) : (
        <div className="list-rows">
          {rows.map((m) => {
            const isIn = m.amountIn > 0;
            return (
              <div key={m.key} className="list-row border-b border-border px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{m.typeLabel}</span>
                  <span className={cn("shrink-0 tabular-nums font-semibold", !isIn && "text-danger")} dir="ltr">
                    {isIn ? "+" : "−"}
                    {formatMoneySymbol(isIn ? m.amountIn : m.amountOut, m.currencySymbol)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-2xs text-muted">
                  <span className="truncate">{describe(m)}</span>
                  <span className="shrink-0">
                    <DateText iso={m.date} /> · {m.accountName}
                    {m.running != null ? ` · مانده ${formatMoney(m.running)}` : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NonCashTable({ rows }: { rows: NonCashRow[] }) {
  const total = useMemo(() => rows.reduce((s, r) => s + r.amountBase, 0), [rows]);
  return (
    <DataTable
      tone="b"
      excel={false}
      rows={[...rows, ...(rows.length ? [{ key: "total", date: "", kind: "credit_sale" as const, label: "مجموع", party: "", docNo: "", amountBase: total }] : [])]}
      rowKey={(r) => r.key}
      empty="در این بازه مورد بدون نقد نیست"
      columns={[
        { header: "تاریخ", cell: (r) => (r.date ? <DateText iso={r.date} /> : "") },
        { header: "نوع", cell: (r) => <span className={r.key === "total" ? "font-bold" : undefined}>{r.label}</span> },
        { header: "طرف حساب", cell: (r) => r.party || "—" },
        { header: "شماره / عنوان", cell: (r) => r.docNo || "—" },
        { header: "مبلغ (؋)", cell: (r) => <span className="tabular-nums">{formatMoneySymbol(r.amountBase)}</span> },
      ]}
    />
  );
}
