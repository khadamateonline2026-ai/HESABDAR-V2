import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, FileSpreadsheet, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { DateText } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { useAppData } from "@/components/layout/app-shell";
import { DateRangeBar, ReportSheet, dateRangeError } from "@/components/report-tools";
import {
  getCashbook,
  type CashAccountSummary,
  type CashMovement,
  type NonCashRow,
} from "@/lib/api/cashbook";
import { PERIOD_LABEL, PERIOD_ORDER, periodRange, type PeriodPreset } from "@/lib/cashbook-periods";
import { tablesToSheets } from "@/lib/excel";
import { formatMoney, formatMoneySymbol, todayIso } from "@/lib/format";
import { useCalendarMode } from "@/lib/prefs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/reports/daily")({ component: DailyCashbook });

const TITLE = "روزنامچه دخل";
type Direction = "all" | "in" | "out";

function money(v: number, symbol: string) {
  return Math.abs(v) <= 1e-9 ? "—" : formatMoneySymbol(v, symbol);
}

/** One card per currency: sum of the current balance of every selected account in that currency. */
type CurrencyBalance = {
  currencyId: number;
  symbol: string;
  name: string;
  total: number;
  baseNow: number;
  accounts: CashAccountSummary[];
};

function DailyCashbook() {
  const { data: app } = useAppData();
  const mode = useCalendarMode();
  const today = todayIso();
  const [preset, setPreset] = useState<PeriodPreset>("today");
  const [custom, setCustom] = useState({ from: today, to: today });
  const { from, to } = preset === "custom" ? custom : periodRange(preset, today, mode);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [currencyId, setCurrencyId] = useState<number | null>(null);
  const [dir, setDir] = useState<Direction>("all");
  const rangeErr = dateRangeError(from, to);
  const ready = Boolean(from && to && !rangeErr);
  const q = useQuery({
    queryKey: ["cashbook", from, to, accountId, currencyId],
    queryFn: () => getCashbook({ data: { from, to, accountId, currencyId } }),
    enabled: ready,
  });
  const body = useRef<HTMLDivElement>(null);
  const accounts = app?.catalogs.accounts ?? [];
  const currencies = useMemo(() => app?.catalogs.currencies ?? [], [app]);
  const d = q.data;
  const single = accountId != null && d?.accounts.length === 1 ? d.accounts[0] : null;

  const balances = useMemo<CurrencyBalance[]>(() => {
    const map = new Map<number, CurrencyBalance>();
    for (const a of d?.accounts ?? []) {
      const cur = currencies.find((c) => c.id === a.currencyId);
      const row = map.get(a.currencyId) ?? {
        currencyId: a.currencyId,
        symbol: a.currencySymbol,
        name: cur?.name ?? a.currencySymbol,
        total: 0,
        baseNow: 0,
        accounts: [],
      };
      row.total += a.currentBalance;
      row.baseNow += a.currentBaseNow;
      row.accounts.push(a);
      map.set(a.currencyId, row);
    }
    return [...map.values()];
  }, [d, currencies]);

  const counts = useMemo(() => {
    const ms = d?.movements ?? [];
    return {
      all: ms.length,
      in: ms.filter((m) => m.amountIn > 0).length,
      out: ms.filter((m) => m.amountOut > 0).length,
    };
  }, [d]);
  const rows = useMemo(
    () =>
      (d?.movements ?? []).filter((m) =>
        dir === "all" ? true : dir === "in" ? m.amountIn > 0 : m.amountOut > 0,
      ),
    [d, dir],
  );

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
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="col-span-2 min-w-0 sm:col-span-1">
          <span className="mb-1 block text-xs font-medium text-muted">بازه</span>
          <select
            className="field-input cb-period-select"
            value={preset}
            onChange={(e) => {
              const p = e.target.value as PeriodPreset;
              if (p === "custom") setCustom({ from, to });
              setPreset(p);
            }}
          >
            {PERIOD_ORDER.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <div className="min-w-0">
          <span className="mb-1 block text-xs font-medium text-muted">دخل / حساب</span>
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
          <span className="mb-1 block text-xs font-medium text-muted">ارز</span>
          <EntitySelect
            value={currencyId ?? "all"}
            options={[
              { id: "all", label: "همه ارزها" },
              ...currencies.map((c) => ({ id: c.id, label: `${c.name} (${c.symbol})` })),
            ]}
            onChange={(id) => setCurrencyId(id == null || id === "all" ? null : Number(id))}
          />
        </div>
        <button
          type="button"
          onClick={() => void saveExcel()}
          title="ذخیره اکسل"
          className="col-span-2 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-2 sm:col-span-1"
        >
          <FileSpreadsheet className="size-4" /> <span>اکسل</span>
        </button>
      </div>
      {preset === "custom" ? (
        <DateRangeBar
          from={custom.from}
          to={custom.to}
          onFrom={(v) => setCustom((c) => ({ ...c, from: v }))}
          onTo={(v) => setCustom((c) => ({ ...c, to: v }))}
          onClear={() => setPreset("today")}
          error={rangeErr}
        />
      ) : null}
      <p className="text-2xs text-muted">
        {mode === "jalali"
          ? "ماه از اول ماه شمسی، هفته از شنبه"
          : "ماه از اول ماه میلادی، هفته از دوشنبه"}
      </p>
    </div>
  );

  return (
    <ReportSheet title={TITLE} lead={lead}>
      <div ref={body} className="cb-dash space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">{TITLE}</h2>
          <span className="cb-period-pill">
            {PERIOD_LABEL[preset]} ·{" "}
            {from === to ? (
              <DateText iso={from} />
            ) : (
              <>
                <DateText iso={from} /> الی <DateText iso={to} />
              </>
            )}
          </span>
        </div>
        {!ready ? (
          <p className="text-sm text-muted">بازه تاریخ را درست انتخاب کنید</p>
        ) : q.isPending ? (
          <div className="h-40 animate-pulse rounded-md bg-border/60" />
        ) : q.isError || !d ? (
          <p className="text-sm text-danger">بارگذاری گزارش ناکام شد</p>
        ) : (
          <>
            <section>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">موجودی فعلی دخل‌ها</h3>
                <span className="text-2xs text-muted">همین حالا، بدون توجه به بازه</span>
              </div>
              {balances.length === 0 ? (
                <p className="text-sm text-muted">دخلی ثبت نشده</p>
              ) : (
                <div className="cb-balances">
                  {balances.map((b) => (
                    <div key={b.currencyId} className="cb-balance-card">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="truncate font-medium">{b.name}</span>
                        <span className="cb-cur-badge">{b.symbol}</span>
                      </div>
                      <p className={cn("cb-balance-amount", b.total < -1e-9 && "cb-out")}>
                        {formatMoneySymbol(b.total, b.symbol)}
                      </p>
                      <p className="truncate text-2xs text-muted">
                        {b.accounts.length === 1
                          ? b.accounts[0].name
                          : b.accounts
                              .map((a) => `${a.name}: ${formatMoney(a.currentBalance)}`)
                              .join(" · ")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <table className="sr-only">
                <thead>
                  <tr>
                    <th>ارز</th>
                    <th>دخل‌ها</th>
                    <th>موجودی فعلی</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.currencyId}>
                      <td>{b.name}</td>
                      <td>{b.accounts.map((a) => a.name).join("، ")}</td>
                      <td>{formatMoneySymbol(b.total, b.symbol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">خلاصه بازه</h3>
              <DataTable
                tone="a"
                excel={false}
                rows={[
                  ...d.accounts.map((a) => ({
                    key: String(a.accountId),
                    label: a.name,
                    symbol: a.currencySymbol,
                    opening: a.opening,
                    inn: a.totalIn,
                    out: a.totalOut,
                    closing: a.closing,
                  })),
                  ...(d.accounts.length > 1
                    ? [
                        {
                          key: "total",
                          label: "مجموع (؋)",
                          symbol: "؋",
                          opening: d.totals.openingBaseNow,
                          inn: d.totals.baseIn,
                          out: d.totals.baseOut,
                          closing: d.totals.closingBaseNow,
                        },
                      ]
                    : []),
                ]}
                rowKey={(r) => r.key}
                empty="دخلی نیست"
                columns={[
                  {
                    header: "دخل",
                    cell: (r) => (
                      <span className={r.key === "total" ? "font-bold" : "font-medium"}>
                        {r.label}
                      </span>
                    ),
                  },
                  {
                    header: "اول بازه",
                    cell: (r) => (
                      <span className="tabular-nums">{formatMoneySymbol(r.opening, r.symbol)}</span>
                    ),
                  },
                  {
                    header: "ورود",
                    cell: (r) => (
                      <span className="cb-in tabular-nums">{money(r.inn, r.symbol)}</span>
                    ),
                  },
                  {
                    header: "خروج",
                    cell: (r) => (
                      <span className="cb-out tabular-nums">{money(r.out, r.symbol)}</span>
                    ),
                  },
                  {
                    header: "آخر بازه",
                    cell: (r) => (
                      <span className="tabular-nums font-semibold">
                        {formatMoneySymbol(r.closing, r.symbol)}
                      </span>
                    ),
                  },
                ]}
              />
              {d.accounts.length > 1 ? (
                <p className="mt-1 text-2xs text-muted">
                  مجموع: اول و آخر بازه به نرخ امروز، ورود و خروج به نرخ روز ثبت
                </p>
              ) : null}
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">دریافتی‌ها و پرداختی‌ها</h3>
                <div className="cb-dir-tabs no-print export-exclude" role="tablist">
                  {(
                    [
                      ["all", "همه"],
                      ["in", "دریافتی‌ها"],
                      ["out", "پرداختی‌ها"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={dir === k}
                      onClick={() => setDir(k)}
                      className={cn(
                        "company-chip h-8 rounded-md border px-2.5 text-xs font-medium whitespace-nowrap",
                        dir === k ? "chip-on border-white/70" : "border-white/25",
                      )}
                    >
                      {label}{" "}
                      <span className="tabular-nums opacity-70">{formatMoney(counts[k])}</span>
                    </button>
                  ))}
                </div>
              </div>
              {d.groups.length ? (
                <div className="cb-groups mb-2">
                  {d.groups.map((g) => (
                    <span key={g.group} className="cb-group-chip">
                      <span className="font-medium">{g.label}</span>
                      {g.baseIn > 1e-9 ? (
                        <Signed className="cb-in" sign="+" value={formatMoney(g.baseIn)} />
                      ) : null}
                      {g.baseOut > 1e-9 ? (
                        <Signed className="cb-out" sign="-" value={formatMoney(g.baseOut)} />
                      ) : null}
                    </span>
                  ))}
                  <span className="text-2xs text-muted">(؋)</span>
                </div>
              ) : null}
              <table className="sr-only">
                <thead>
                  <tr>
                    <th>نوع</th>
                    <th>تعداد</th>
                    <th>ورود (؋)</th>
                    <th>خروج (؋)</th>
                  </tr>
                </thead>
                <tbody>
                  {d.groups.map((g) => (
                    <tr key={g.group}>
                      <td>{g.label}</td>
                      <td>{g.count}</td>
                      <td>{g.baseIn}</td>
                      <td>{g.baseOut}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="hidden sm:block">
                <DataTable
                  tone="c"
                  excel={false}
                  rows={rows}
                  rowKey={(m) => m.key}
                  empty="در این بازه دریافت و پرداختی نیست"
                  columns={[
                    { header: "تاریخ", cell: (m) => <DateText iso={m.date} /> },
                    { header: "نوع", cell: (m) => <TypeCell m={m} /> },
                    {
                      header: "طرف حساب / شرح",
                      className: "whitespace-normal text-start",
                      cell: (m) => describe(m),
                    },
                    {
                      header: "شماره",
                      cell: (m) => <span className="tabular-nums">{m.docNo || "—"}</span>,
                    },
                    { header: "دخل", cell: (m) => m.accountName },
                    { header: "مبلغ", cell: (m) => <SignedAmount m={m} /> },
                    ...(single
                      ? [
                          {
                            header: "مانده",
                            cell: (m: CashMovement) => (
                              <span className="tabular-nums">
                                {formatMoneySymbol(m.running ?? 0, m.currencySymbol)}
                              </span>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
              <MobileRows rows={rows} />
            </section>

            <section>
              <details className="dash-card rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-sm font-semibold">
                  <h3 className="inline">بدون نقد (فقط اطلاع)</h3>
                  <span className="ms-2 text-xs font-normal text-muted">
                    — در موجودی دخل حساب نمی‌شود · {formatMoney(d.nonCash.length)} مورد
                  </span>
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
  return m.originalAmount != null
    ? `${parts} (${formatMoney(m.originalAmount)} ${m.originalSymbol})`
    : parts;
}

function TypeCell({ m }: { m: CashMovement }) {
  const isIn = m.amountIn > 0;
  return (
    <span className="inline-flex items-center gap-1.5">
      {isIn ? (
        <ArrowDownLeft className="cb-in size-3.5 shrink-0" />
      ) : (
        <ArrowUpRight className="cb-out size-3.5 shrink-0" />
      )}
      {m.typeLabel}
    </span>
  );
}

function SignedAmount({ m }: { m: CashMovement }) {
  const isIn = m.amountIn > 0;
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 whitespace-nowrap tabular-nums font-semibold",
        isIn ? "cb-in" : "cb-out",
      )}
      dir="ltr"
    >
      <span>{m.currencySymbol}</span>
      <Signed sign={isIn ? "+" : "-"} value={formatMoney(isIn ? m.amountIn : m.amountOut)} />
    </span>
  );
}

/** Sign + number as separate boxes in LTR order, so no bidi reordering (screen, print or image) can move the sign. */
function Signed({ sign, value, className }: { sign: string; value: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline tabular-nums", className)} dir="ltr">
      {/* «+» آیکون است (اکسل svg را نمی‌خواند → عدد مثبت)؛ «-» متن واقعی → عدد منفی در اکسل */}
      {sign === "+" ? (
        <Plus className="size-[0.8em] shrink-0 self-center" strokeWidth={3} aria-label="+" />
      ) : (
        <span>-</span>
      )}
      <span>{value}</span>
    </span>
  );
}

/** Mobile: two-line rows — type + signed amount, then party/description, date and account. */
function MobileRows({ rows }: { rows: CashMovement[] }) {
  return (
    <div className="dash-card list-card overflow-hidden sm:hidden">
      {rows.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-muted">
          در این بازه دریافت و پرداختی نیست
        </p>
      ) : (
        <div className="list-rows">
          {rows.map((m) => (
            <div key={m.key} className="list-row border-b border-border px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-medium">
                  <TypeCell m={m} />
                  {m.docNo ? <span className="ms-1 text-2xs text-muted">#{m.docNo}</span> : null}
                </span>
                <span className="shrink-0">
                  <SignedAmount m={m} />
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
          ))}
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
      rows={[
        ...rows,
        ...(rows.length
          ? [
              {
                key: "total",
                date: "",
                kind: "credit_sale" as const,
                label: "مجموع",
                party: "",
                docNo: "",
                amountBase: total,
              },
            ]
          : []),
      ]}
      rowKey={(r) => r.key}
      empty="در این بازه مورد بدون نقد نیست"
      columns={[
        { header: "تاریخ", cell: (r) => (r.date ? <DateText iso={r.date} /> : "") },
        {
          header: "نوع",
          cell: (r) => (
            <span className={r.key === "total" ? "font-bold" : undefined}>{r.label}</span>
          ),
        },
        { header: "طرف حساب", cell: (r) => r.party || "—" },
        { header: "شماره / عنوان", cell: (r) => r.docNo || "—" },
        {
          header: "مبلغ (؋)",
          cell: (r) => <span className="tabular-nums">{formatMoneySymbol(r.amountBase)}</span>,
        },
      ]}
    />
  );
}
