import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DashTabs } from "@/components/dash-tabs";
import { DataTable, type Column } from "@/components/data-table";
import { DateText } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { Guard } from "@/components/guard";
import { useAppData } from "@/components/layout/app-shell";
import { DateRangeBar, ReportSheet, dateRangeError } from "@/components/report-tools";
import {
  getCashbook,
  type CashAccountSummary,
  type CashMovement,
  type NonCashRow,
} from "@/lib/api/cashbook";
import { buildLedger, type LedgerBlock } from "@/lib/cashbook-ledger";
import { PERIOD_LABEL, PERIOD_ORDER, periodRange, type PeriodPreset } from "@/lib/cashbook-periods";
import { tablesToSheets } from "@/lib/excel";
import { formatMoney, formatMoneySymbol, todayIso } from "@/lib/format";
import { useCalendarMode } from "@/lib/prefs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/cashbook")({ component: Page });

const TITLE = "روزنامچه";

function Page() {
  return (
    <Guard area="reports">
      <div className="space-y-3">
        <DashTabs />
        <DailyCashbook />
      </div>
    </Guard>
  );
}

/** One card per currency: sum of the current balance of every selected account in that currency. */
type CurrencyBalance = {
  currencyId: number;
  symbol: string;
  name: string;
  total: number;
  accounts: CashAccountSummary[];
};

/** Rows of the «جزئیات» table: currency header (only with several currencies), opening, movements, totals. */
type DetailRow =
  | { kind: "head"; key: string; block: LedgerBlock; name: string }
  | { kind: "open"; key: string; block: LedgerBlock }
  | { kind: "move"; key: string; block: LedgerBlock; m: CashMovement; running: number }
  | { kind: "foot"; key: string; block: LedgerBlock };

function DailyCashbook() {
  const { data: app } = useAppData();
  const mode = useCalendarMode();
  const today = todayIso();
  const [preset, setPreset] = useState<PeriodPreset>("today");
  const [custom, setCustom] = useState({ from: today, to: today });
  const { from, to } = preset === "custom" ? custom : periodRange(preset, today, mode);
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
  const currencies = useMemo(() => app?.catalogs.currencies ?? [], [app]);
  const d = q.data;
  const curName = (id: number, symbol: string) =>
    currencies.find((c) => c.id === id)?.name ?? symbol;

  const balances = useMemo<CurrencyBalance[]>(() => {
    const map = new Map<number, CurrencyBalance>();
    for (const a of d?.accounts ?? []) {
      const row = map.get(a.currencyId) ?? {
        currencyId: a.currencyId,
        symbol: a.currencySymbol,
        name: currencies.find((c) => c.id === a.currencyId)?.name ?? a.currencySymbol,
        total: 0,
        accounts: [],
      };
      row.total += a.currentBalance;
      row.accounts.push(a);
      map.set(a.currencyId, row);
    }
    return [...map.values()];
  }, [d, currencies]);

  const blocks = useMemo(() => (d ? buildLedger(d) : []), [d]);
  const multi = blocks.length > 1;
  const manyAccounts = (d?.accounts.length ?? 0) > 1;
  const rows = useMemo<DetailRow[]>(() => {
    const out: DetailRow[] = [];
    for (const b of blocks) {
      const k = String(b.currencyId);
      if (multi)
        out.push({ kind: "head", key: `h${k}`, block: b, name: curName(b.currencyId, b.symbol) });
      out.push({ kind: "open", key: `o${k}`, block: b });
      for (const r of b.rows)
        out.push({ kind: "move", key: `${k}-${r.m.key}`, block: b, m: r.m, running: r.running });
      out.push({ kind: "foot", key: `f${k}`, block: b });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, multi, currencies]);
  const sym = !multi && blocks[0] ? ` (${blocks[0].symbol})` : "";

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

  const columns: Column<DetailRow>[] = [
    {
      header: "تاریخ",
      cell: (r) =>
        r.kind === "move" ? (
          <DateText iso={r.m.date} />
        ) : r.kind === "head" ? (
          <span className="font-bold">
            {r.name} ({r.block.symbol})
          </span>
        ) : r.kind === "open" ? (
          <span className="font-semibold">موجودی اول بازه</span>
        ) : (
          <span className="font-bold">مجموع</span>
        ),
    },
    { header: "طرف حساب", cell: (r) => (r.kind === "move" ? r.m.party || "—" : "") },
    {
      header: "شرح / نوع",
      className: "whitespace-normal text-start",
      cell: (r) => (r.kind === "move" ? describe(r.m, manyAccounts) : ""),
    },
    {
      header: "شماره",
      cell: (r) =>
        r.kind === "move" ? <span className="tabular-nums">{r.m.docNo || "—"}</span> : "",
    },
    {
      header: `ورود${sym}`,
      cell: (r) =>
        r.kind === "move" && r.m.amountIn > 0 ? (
          <Signed className="cb-in font-semibold" sign="+" value={formatMoney(r.m.amountIn)} />
        ) : r.kind === "foot" && r.block.totalIn > 1e-9 ? (
          <Signed className="cb-in font-bold" sign="+" value={formatMoney(r.block.totalIn)} />
        ) : (
          ""
        ),
    },
    {
      header: `خروج${sym}`,
      cell: (r) =>
        r.kind === "move" && r.m.amountOut > 0 ? (
          <Signed className="cb-out font-semibold" sign="-" value={formatMoney(r.m.amountOut)} />
        ) : r.kind === "foot" && r.block.totalOut > 1e-9 ? (
          <Signed className="cb-out font-bold" sign="-" value={formatMoney(r.block.totalOut)} />
        ) : (
          ""
        ),
    },
    {
      header: `مانده دخل${sym}`,
      cell: (r) =>
        r.kind === "head" ? (
          ""
        ) : (
          <Balance
            value={
              r.kind === "move" ? r.running : r.kind === "open" ? r.block.opening : r.block.closing
            }
            strong={r.kind !== "move"}
          />
        ),
    },
  ];

  return (
    <ReportSheet title={TITLE}>
      <div ref={body} className="cb-dash space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-tight">{TITLE}</h1>
            <p className="mt-0.5 text-xs text-muted tabular-nums">
              {from === to ? (
                <DateText iso={from} />
              ) : (
                <>
                  <DateText iso={from} /> — <DateText iso={to} />
                </>
              )}
            </p>
          </div>
          <div className="export-exclude no-print grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
            <select
              aria-label="بازه"
              className="field-input cb-period-select col-span-2 sm:w-32"
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
            <div className="min-w-0 sm:w-44">
              <EntitySelect
                value={accountId ?? "all"}
                options={[
                  { id: "all", label: "همه حساب‌ها" },
                  ...accounts.map((a) => ({ id: a.id, label: `${a.name} (${a.currencySymbol})` })),
                ]}
                onChange={(id) => setAccountId(id == null || id === "all" ? null : Number(id))}
              />
            </div>
            <div className="min-w-0 sm:w-36">
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
              aria-label="ذخیره اکسل"
              className="col-span-2 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-2"
            >
              <FileSpreadsheet className="size-4" />
              <span className="sm:hidden">اکسل</span>
            </button>
          </div>
        </div>
        {preset === "custom" ? (
          <div className="export-exclude no-print">
            <DateRangeBar
              from={custom.from}
              to={custom.to}
              onFrom={(v) => setCustom((c) => ({ ...c, from: v }))}
              onTo={(v) => setCustom((c) => ({ ...c, to: v }))}
              onClear={() => setPreset("today")}
              error={rangeErr}
            />
          </div>
        ) : null}

        {!ready ? (
          <p className="text-sm text-muted">بازه تاریخ را درست انتخاب کنید</p>
        ) : q.isPending ? (
          <div className="h-40 animate-pulse rounded-md bg-border/60" />
        ) : q.isError || !d ? (
          <p className="text-sm text-danger">بارگذاری گزارش ناکام شد</p>
        ) : (
          <>
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

            <section>
              <h2 className="mb-2 text-sm font-semibold">جزئیات</h2>
              <div className="hidden sm:block">
                <DataTable
                  tone="c"
                  excel={false}
                  rows={rows}
                  rowKey={(r) => r.key}
                  empty="دخلی نیست"
                  columns={columns}
                />
              </div>
              <MobileRows rows={rows} manyAccounts={manyAccounts} />
            </section>

            <section>
              <details className="dash-card rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-sm font-semibold">
                  <h3 className="inline">معاملات نسیه</h3>
                  <span className="ms-2 text-xs font-normal text-muted tabular-nums">
                    ({formatMoney(d.nonCash.length)})
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

function describe(m: CashMovement, withAccount: boolean) {
  const parts = [m.typeLabel, m.description].filter(Boolean).join(" — ");
  const orig =
    m.originalAmount != null ? ` (${formatMoney(m.originalAmount)} ${m.originalSymbol})` : "";
  return `${parts}${orig}${withAccount ? ` · ${m.accountName}` : ""}`;
}

function Balance({ value, strong }: { value: number; strong?: boolean }) {
  return (
    <span
      className={cn(
        "tabular-nums",
        strong ? "font-bold" : "font-medium",
        value < -1e-9 && "cb-out",
      )}
      dir="ltr"
    >
      {value < -1e-9 ? "-" : ""}
      {formatMoney(Math.abs(value))}
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

/** Mobile: two-line rows — type/party + signed amount, then date, doc no. and the running balance. */
function MobileRows({ rows, manyAccounts }: { rows: DetailRow[]; manyAccounts: boolean }) {
  return (
    <div className="dash-card list-card overflow-hidden sm:hidden">
      {rows.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-muted">دخلی نیست</p>
      ) : (
        <div className="list-rows">
          {rows.map((r) => {
            if (r.kind === "head")
              return (
                <div
                  key={r.key}
                  className="list-row border-b border-border px-3 py-1.5 text-sm font-bold"
                >
                  {r.name} ({r.block.symbol})
                </div>
              );
            if (r.kind === "open" || r.kind === "foot")
              return (
                <div
                  key={r.key}
                  className="list-row flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm"
                >
                  <span className="font-semibold">
                    {r.kind === "open" ? "موجودی اول بازه" : "مجموع"}
                  </span>
                  <span className="flex items-center gap-2">
                    {r.kind === "foot" ? (
                      <>
                        <Signed
                          className="cb-in text-xs"
                          sign="+"
                          value={formatMoney(r.block.totalIn)}
                        />
                        <Signed
                          className="cb-out text-xs"
                          sign="-"
                          value={formatMoney(r.block.totalOut)}
                        />
                      </>
                    ) : null}
                    <Balance value={r.kind === "open" ? r.block.opening : r.block.closing} strong />
                    <span className="text-2xs text-muted">{r.block.symbol}</span>
                  </span>
                </div>
              );
            const isIn = r.m.amountIn > 0;
            return (
              <div key={r.key} className="list-row border-b border-border px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium">
                    {[r.m.party, r.m.typeLabel].filter(Boolean).join(" · ")}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-1">
                    <Signed
                      className={cn("font-semibold", isIn ? "cb-in" : "cb-out")}
                      sign={isIn ? "+" : "-"}
                      value={formatMoney(isIn ? r.m.amountIn : r.m.amountOut)}
                    />
                    <span className="text-2xs text-muted">{r.block.symbol}</span>
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-2xs text-muted">
                  <span className="min-w-0 truncate">
                    <DateText iso={r.m.date} />
                    {r.m.docNo ? ` · ${r.m.docNo}` : ""}
                    {r.m.description ? ` · ${r.m.description}` : ""}
                    {manyAccounts ? ` · ${r.m.accountName}` : ""}
                  </span>
                  <span className="shrink-0">
                    مانده <Balance value={r.running} />
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
      empty="در این بازه معامله نسیه نیست"
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
