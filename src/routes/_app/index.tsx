import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Info } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useAppData } from "@/components/layout/app-shell";
import { AfAmount } from "@/components/invoice-ui";
import { getDashboard } from "@/lib/api/dashboard";
import { formatMoneyInt, todayIso } from "@/lib/format";
import { shiftJalaliMonths } from "@/lib/jalali";
import { setUsageFocus, type UsageFocus } from "@/lib/usage-focus";
import type { DashboardAlert } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/")({ component: Dashboard });

type SalesPeriod = "1m" | "6m" | "1y";
type Dest =
  | "/finance/accounts"
  | "/sales"
  | "/purchase"
  | "/warehouses"
  | "/expenses"
  | "/payments"
  | "/workers"
  | "/notes"
  | "/setup/parties"
  | "/reports"
  | "/reports/receivables"
  | "/reports/payables";

function DashLink({
  to,
  focus,
  className,
  children,
}: {
  to: Dest;
  focus?: UsageFocus;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      onClick={() => {
        if (focus) setUsageFocus(focus);
      }}
      className={cn("cursor-pointer rounded-md hover:bg-white/10", className)}
    >
      {children}
    </Link>
  );
}

function Dashboard() {
  const { data } = useAppData();
  const dash = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboard(),
    enabled: Boolean(data?.profile),
  });
  const d = dash.data;
  const company = data?.company;
  const production = data?.settings.productionEnabled !== false;
  const salesTab = production ? "product" : "raw";
  const salesFocus: UsageFocus = { page: "sales", path: "/sales", tab: salesTab };
  const [period, setPeriod] = useState<SalesPeriod>("1m");
  const [salesOpen, setSalesOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);

  const productRows = useMemo(() => {
    const months = period === "1m" ? -1 : period === "6m" ? -6 : -12;
    const from = shiftJalaliMonths(todayIso(), months);
    const map = new Map<string, { name: string; qty: number; amountBase: number }>();
    for (const s of d?.productSales ?? []) {
      if (s.occurredOn < from) continue;
      const cur = map.get(s.name) ?? { name: s.name, qty: 0, amountBase: 0 };
      cur.qty += s.qty;
      cur.amountBase += s.amountBase;
      map.set(s.name, cur);
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty || b.amountBase - a.amountBase);
  }, [d?.productSales, period]);

  const visibleSales = salesOpen ? productRows : productRows.slice(0, 5);
  const alerts = d?.alerts ?? [];
  const visibleAlerts = alertsOpen ? alerts : alerts.slice(0, 5);
  const alertGroups: { section: string; items: typeof visibleAlerts }[] = [];
  for (const a of visibleAlerts) {
    const hit = alertGroups.find((g) => g.section === a.section);
    if (hit) hit.items.push(a);
    else alertGroups.push({ section: a.section, items: [a] });
  }

  return (
    <div className="dash-board-ink space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{company?.name || "دفتر حساب"}</h1>
      </div>

      {dash.isPending ? (
        <div className="h-40 animate-pulse rounded-md bg-border/60" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card title="نقدینگی" border="border-tab-a" tint="a" titleClass="text-xs">
            <ul className="divide-y divide-border">
              <li>
              <DashLink to="/finance/accounts" className="flex items-center justify-between py-2">
                <span className="text-sm font-bold">مجموع نقدینگی</span>
                <AfAmount
                  whole
                  value={d?.cashBase ?? 0}
                  size="md"
                  className={cn("font-bold", (d?.cashBase ?? 0) < 0 ? "text-danger" : "text-fg")}
                />
              </DashLink>
              </li>
              {(d?.cashAccounts ?? []).map((a) => (
                <li key={a.name}>
                  <DashLink to="/finance/accounts" className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate text-2xs text-muted">{a.name}</span>
                    <span className="shrink-0 text-2xs tabular-nums">
                      {formatMoneyInt(a.balance)} {a.currencySymbol}
                    </span>
                  </DashLink>
                </li>
              ))}
              {!d?.cashAccounts.length ? <p className="text-2xs text-muted">حسابی نیست</p> : null}
            </ul>
          </Card>

          <Card
            title="سود و زیان"
            border="border-tab-b"
            tint="b"
            aside={
              <AfAmount
                whole
                value={d?.profitBase ?? 0}
                size="sm"
                className={(d?.profitBase ?? 0) < 0 ? "text-danger" : "text-fg"}
              />
            }
          >
            <dl className="space-y-1.5">
              <Row label="فروشات" value={d?.salesBase ?? 0} to="/sales" focus={salesFocus} />
              <Row
                label="بهای تمام‌شده"
                value={d?.cogsBase ?? 0}
                to="/warehouses"
                focus={{ page: "warehouses", path: "/warehouses", tab: salesTab }}
              />
              <Row label="هزینه‌ها" value={d?.expenseBase ?? 0} to="/expenses" />
            </dl>
          </Card>

          <Card title="طلب‌ها و بدهی‌ها" border="border-tab-c" tint="c">
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-bold">طلبات</div>
                  <AfAmount whole value={d?.receivableBase ?? 0} size="sm" className="font-semibold" />
                </div>
                <dl className="mt-2 space-y-1">
                  <Row label="مشتریان" value={Math.max(0, (d?.customerReceivableBase ?? 0) - (d?.cashTakeBase ?? 0))} to="/reports/receivables" />
                  <Row label="بردگی نقدی" value={d?.cashTakeBase ?? 0} to="/payments" />
                  <Row label="پیش پرداخت‌ها" value={d?.prepaymentBase ?? 0} to="/reports/payables" />
                  {(d?.cashPartyReceivableBase ?? 0) > 1e-9 ? (
                    <Row label="طرف حساب نقدی" value={d?.cashPartyReceivableBase ?? 0} to="/setup/parties" />
                  ) : null}
                </dl>
              </div>
              <div className="border-t border-border pt-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-bold">بدهی‌ها</div>
                  <AfAmount whole value={d?.payableBase ?? 0} size="sm" className="font-semibold" />
                </div>
                <dl className="mt-2 space-y-1">
                  <Row label="فروشندگان" value={d?.vendorPayableBase ?? 0} to="/reports/payables" />
                  <Row label="هزینه متفرقه" value={d?.expenseDebtBase ?? 0} to="/expenses" />
                  <Row label="هزینه تکراری" value={d?.recurringDueBase ?? 0} to="/expenses" />
                  <Row label="معاش کارگران" value={d?.salaryDueBase ?? 0} to="/workers" />
                  {production ? (
                    <Row label="دستمزد کانتراتی" value={d?.workerWagePayableBase ?? 0} to="/workers" />
                  ) : null}
                  {(d?.cashPartyPayableBase ?? 0) > 1e-9 ? (
                    <Row label="طرف حساب نقدی" value={d?.cashPartyPayableBase ?? 0} to="/setup/parties" />
                  ) : null}
                </dl>
              </div>
            </div>
          </Card>

          <Card title="طرف حساب‌های نقدی" border="border-tab-c" tint="c">
            {d?.cashParties?.length ? (
              <CashPartyBoard rows={d.cashParties} />
            ) : (
              <DashLink to="/setup/parties" className="block">
                <p className="text-2xs text-muted">طرف حساب نقدی ثبت نشده</p>
              </DashLink>
            )}
          </Card>

          <Card title="وضعیت گدام‌ها" border="border-tab-d" tint="d">
            <ul className="divide-y divide-border">
              <li>
              <DashLink
                to="/warehouses"
                focus={{ page: "warehouses", path: "/warehouses", tab: salesTab }}
                className="flex items-center justify-between py-2"
              >
                <span className="text-sm font-bold">مجموع ارزش</span>
                <AfAmount
                  whole
                  value={(d?.warehouses ?? []).reduce((s, w) => s + w.valueBase, 0)}
                  size="md"
                  className="font-bold"
                />
              </DashLink>
              </li>
              {(d?.warehouses ?? []).map((w) => (
                <li key={w.name}>
                  <DashLink
                    to="/warehouses"
                    focus={warehouseFocus(w.name)}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="text-2xs">
                      {w.name}
                      <span className="mr-1 text-muted">({formatMoneyInt(w.qty)})</span>
                    </span>
                    <AfAmount whole value={w.valueBase} />
                  </DashLink>
                </li>
              ))}
              {!d?.warehouses.length ? <p className="text-2xs text-muted">موجودی ثبت نشده</p> : null}
            </ul>
          </Card>

          <Card title="هشدارها" border="border-danger" tint="danger">
            {alerts.length ? (
              <>
                <ul className="space-y-3">
                  {alertGroups.map((g) => (
                    <li key={g.section}>
                      {g.section ? (
                        <div className="mb-1 text-2xs font-semibold">{g.section}</div>
                      ) : null}
                      <ul className="space-y-1.5">
                        {g.items.map((a, i) => (
                          <li key={i}>
                            <DashLink
                              to={alertDest(a).to}
                              focus={alertDest(a).focus}
                              className="flex items-start gap-2 py-0.5 text-2xs leading-5"
                            >
                            {a.kind === "danger" ? (
                              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                            ) : a.kind === "warn" ? (
                              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
                            ) : (
                              <Info className="mt-0.5 size-3.5 shrink-0 text-muted" />
                            )}
                            {a.title ? (
                              <span>
                                <span className="font-semibold">«{a.title}»</span> {a.text}
                              </span>
                            ) : (
                              <span>{a.text}</span>
                            )}
                            </DashLink>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
                {alerts.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setAlertsOpen((v) => !v)}
                    className="mx-auto mt-2 grid size-9 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg"
                    aria-label={alertsOpen ? "بستن هشدارها" : "نمایش تمام هشدارها"}
                    aria-expanded={alertsOpen}
                  >
                    <ChevronDown className={cn("size-5 transition-transform", alertsOpen && "rotate-180")} />
                  </button>
                ) : null}
              </>
            ) : (
              <p className="text-2xs text-muted">هشداری نیست</p>
            )}
          </Card>
        </div>
      )}

      {!dash.isPending ? (
        <DashLink to="/notes" className="block">
        <Card title="یادداشت‌های مهم" border="border-tab-e" tint="e">
          {(d?.noteTexts?.length || d?.noteImageCount) ? (
            <div className="space-y-2">
              {(d?.noteTexts ?? []).map((t, i) => (
                <p key={i} className="text-2xs leading-5 whitespace-pre-wrap">
                  {t}
                </p>
              ))}
              {(d?.noteImageCount ?? 0) > 0 ? (
                <p className="text-2xs">
                  {d?.noteTexts?.length
                    ? `${faNoteCount(d.noteImageCount)} یادداشت مهم دیگر وجود دارد`
                    : `${faNoteCount(d.noteImageCount)} یادداشت مهم وجود دارد`}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-2xs text-muted">یادداشت مهمی نیست</p>
          )}
        </Card>
        </DashLink>
      ) : null}

      {!dash.isPending ? (
        <section className="dash-card dash-tint-a rounded-lg border-2 border-tab-a p-4">
          <div className="mb-3 flex flex-nowrap items-center gap-1 overflow-x-auto">
            <h2 className="shrink-0 text-micro font-semibold whitespace-nowrap sm:text-sm">فروش کالای تولید شده</h2>
            <div className="mr-auto flex shrink-0 gap-1">
              {(
                [
                  ["1m", "ماه گذشته"],
                  ["6m", "۶ ماه گذشته"],
                  ["1y", "یک سال گذشته"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setPeriod(id);
                    setSalesOpen(false);
                  }}
                  className={cn(
                    "h-7 rounded-md px-1.5 text-micro whitespace-nowrap sm:h-8 sm:px-2 sm:text-2xs",
                    period === id ? "bg-primary text-primary-fg" : "bg-surface-2 text-muted hover:text-fg",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {visibleSales.length ? (
            <div className="space-y-0">
              <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-center gap-2 py-1 text-2xs text-muted">
                <span className="text-right font-medium">کالا</span>
                <span className="text-center font-medium">تعداد</span>
                <span className="text-left font-medium">مبلغ</span>
              </div>
              {visibleSales.map((p) => (
                <DashLink
                  key={p.name}
                  to="/sales"
                  focus={salesFocus}
                  className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-center gap-2 border-t border-border py-1.5 text-2xs"
                >
                  <span className="min-w-0 truncate text-right">{p.name}</span>
                  <span className="text-center tabular-nums">{formatMoneyInt(p.qty)}</span>
                  <span className="text-left">
                    <AfAmount whole value={p.amountBase} />
                  </span>
                </DashLink>
              ))}
            </div>
          ) : (
            <p className="text-2xs text-muted">فروشی در این بازه نیست</p>
          )}
          {productRows.length > 5 ? (
            <button
              type="button"
              onClick={() => setSalesOpen((v) => !v)}
              className="mx-auto mt-2 grid size-9 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg"
              aria-label={salesOpen ? "بستن جدول" : "نمایش تمام محصولات"}
              aria-expanded={salesOpen}
            >
              <ChevronDown className={cn("size-5 transition-transform", salesOpen && "rotate-180")} />
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function faNoteCount(n: number): string {
  const words = ["صفر", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه", "ده"];
  if (n >= 0 && n <= 10) return words[n];
  return formatMoneyInt(n);
}

function CashPartyBoard({
  rows,
}: {
  rows: { name: string; balance: number; currencySymbol: string }[];
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 items-center gap-2 text-2xs font-bold">
        <span>بدهی شرکت</span>
        <span className="text-center">نام طرف حساب</span>
        <span className="text-center">طلب شرکت</span>
      </div>
      {rows.map((r) => (
        <DashLink key={r.name} to="/setup/parties" className="grid grid-cols-3 items-center gap-2">
          <span className="text-2xs tabular-nums">
            {r.balance < -1e-9 ? `${formatMoneyInt(Math.abs(r.balance))} ${r.currencySymbol}` : "—"}
          </span>
          <span className="truncate text-center text-2xs font-medium">{r.name}</span>
          <span className="text-center text-2xs tabular-nums">
            {r.balance > 1e-9 ? `${formatMoneyInt(r.balance)} ${r.currencySymbol}` : "—"}
          </span>
        </DashLink>
      ))}
    </div>
  );
}

function Card({
  title,
  border,
  tint,
  titleClass,
  aside,
  children,
}: {
  title: string;
  border: string;
  tint?: "a" | "b" | "c" | "d" | "e" | "danger";
  titleClass?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={cn("dash-card rounded-lg border-2 p-4", border, tint && `dash-tint-${tint}`)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className={cn("font-semibold whitespace-nowrap", titleClass ?? "text-sm")}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  to,
  focus,
}: {
  label: string;
  value: number;
  to?: Dest;
  focus?: UsageFocus;
}) {
  const body = (
    <>
      <dt className="text-2xs text-muted">{label}</dt>
      <dd>
        <AfAmount whole value={value} />
      </dd>
    </>
  );
  if (!to) {
    return <div className="flex items-center justify-between">{body}</div>;
  }
  return (
    <DashLink to={to} focus={focus} className="flex items-center justify-between">
      {body}
    </DashLink>
  );
}

function warehouseFocus(name: string): UsageFocus {
  const tab = name === "گدام کالای تولید شده" ? "product" : name === "مواد نزد کارگران" ? "worker" : "raw";
  return { page: "warehouses", path: "/warehouses", tab };
}

function alertDest(a: DashboardAlert): { to: Dest; focus?: UsageFocus } {
  if (a.section === "خرید") return { to: "/purchase", focus: { page: "purchase", path: "/purchase", tab: "in_transit" } };
  if (a.section === "نقدینگی") return { to: "/finance/accounts" };
  if (a.section === "طلبات") return { to: "/reports/receivables" };
  if (a.section === "بدهی‌ها") return { to: "/reports/payables" };
  if (a.section === "گدام کالای تولید شده") {
    return { to: "/warehouses", focus: { page: "warehouses", path: "/warehouses", tab: "product", query: a.title } };
  }
  if (a.section === "گدام مواد خام" || a.section === "گدام") {
    return { to: "/warehouses", focus: { page: "warehouses", path: "/warehouses", tab: "raw", query: a.title } };
  }
  if (a.section === "هزینه‌ها") return { to: "/expenses" };
  if (a.section === "کارگران") return { to: "/workers" };
  return { to: "/reports" };
}
