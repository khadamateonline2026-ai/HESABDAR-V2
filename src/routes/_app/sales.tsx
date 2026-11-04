import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AddNameModal } from "@/components/add-name-modal";
import { ConfirmDelete } from "@/components/confirm-delete";
import { DataTable } from "@/components/data-table";
import { DateField, DateText } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { Guard } from "@/components/guard";
import { RowActions } from "@/components/icon-btn";
import {
  AccountFormModal,
  AfAmount,
  emptyLine,
  ErrorLines,
  FxBar,
  InvoiceBrand,
  InvoiceLines,
  SectionTabs,
  SheetActions,
  useSheetRef,
  type DraftLine,
} from "@/components/invoice-ui";
import { useAppData } from "@/components/layout/app-shell";
import { MoneyInput } from "@/components/money-input";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { saveCompany } from "@/lib/api/core";
import { deleteSaleInvoice, listCustomerCashTakes, listSaleInvoices, saveSaleInvoice } from "@/lib/api/invoices";
import { getInventory } from "@/lib/api/inventory";
import { saveItem, saveParty, saveUnit } from "@/lib/api/setup";
import { findAfn, emptyNum, formatMoney, nextInvoiceNo, parseAmount, todayIso } from "@/lib/format";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import type { Item, SaleInvoice } from "@/lib/types";
import { clearUsageFocus, onUsageFocus, peekUsageFocus } from "@/lib/usage-focus";

export const Route = createFileRoute("/_app/sales")({ component: Page });

function Page() {
  return (
    <Guard area="sales">
      <Sales />
    </Guard>
  );
}

async function refresh() {
  await queryClient.invalidateQueries({ queryKey: ["sale-invoices"] });
  await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
  await queryClient.invalidateQueries({ queryKey: ["inventory"] });
  await queryClient.invalidateQueries({ queryKey: ["sales-ledger"] });
  await queryClient.invalidateQueries({ queryKey: ["party-statement"] });
}

function Sales() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "sales");
  const list = useQuery({ queryKey: ["sale-invoices"], queryFn: () => listSaleInvoices() });
  const production = data?.settings.productionEnabled !== false;
  const [tab, setTab] = useState<Item["kind"]>("product");
  const [shopTab, setShopTab] = useState<"open" | "closed">("open");
  const [edit, setEdit] = useState<SaleInvoice | "new" | null>(null);
  const [del, setDel] = useState<SaleInvoice | null>(null);
  const [printRow, setPrintRow] = useState<SaleInvoice | null>(null);
  const rows = (list.data ?? []).filter((r) => {
    if (production) return r.kind === tab;
    if (r.kind !== "raw") return false;
    return shopTab === "closed" ? r.closed : !r.closed;
  });

  useEffect(() => {
    if (!production) setTab("raw");
  }, [production]);

  useEffect(() => {
    function apply() {
      const f = peekUsageFocus();
      if (!f || f.page !== "sales") return;
      const all = list.data ?? [];
      if (f.invoiceId != null) {
        const row = all.find((r) => r.id === f.invoiceId);
        if (!row) {
          if (!list.isFetched) return;
        } else {
          setTab(row.kind);
          setPrintRow(row);
          clearUsageFocus();
          return;
        }
      }
      if (f.tab === "raw" || f.tab === "product") setTab(f.tab);
      clearUsageFocus();
    }
    apply();
    return onUsageFocus(apply);
  }, [list.data, list.isFetched]);

  return (
    <div>
      <PageHeader title="فروش" titleClass="text-2xl font-bold" canAdd={writable} onAdd={() => setEdit("new")} />
      <SectionTabs
        fill
        contrast
        labelClass="h-12 text-base font-bold sm:text-lg"
        value={production ? tab : shopTab}
        onChange={(id) => {
          if (production) setTab(id as Item["kind"]);
          else setShopTab(id as "open" | "closed");
        }}
        tabs={
          production
            ? [
                { id: "product", label: "فروش کالای تولید شده", color: "a" },
                { id: "raw", label: "فروش مواد خام", color: "c" },
              ]
            : [
                { id: "open", label: "فاکتورهای باز", color: "a" },
                { id: "closed", label: "فاکتورهای بسته", color: "c" },
              ]
        }
      />
      <div>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="فاکتوری در این بخش نیست"
          tone={production && tab === "product" ? "a" : "c"}
          excel={production ? (tab === "product" ? "فروش کالای تولید شده" : "فروش مواد خام") : "فروش کالا"}
          columns={[
            { header: "شماره فاکتور", cell: (r) => <span className="tabular-nums">{r.invoiceNo}</span> },
            { header: "تاریخ", cell: (r) => <DateText iso={r.occurredOn} /> },
            { header: "مشتری", cell: (r) => r.customerName || "—" },
            { header: "جمع", cell: (r) => <AfAmount value={r.totalBase} /> },
            { header: "باقی", cell: (r) => <AfAmount value={r.remainingBase} /> },
            {
              header: "",
              className: "w-28",
              cell: (r) => (
                <RowActions
                  canWrite={writable}
                  onPrint={() => setPrintRow(r)}
                  onEdit={() => setEdit(r)}
                  onDelete={() => setDel(r)}
                />
              ),
            },
          ]}
        />
      </div>
      {edit ? (
        <SaleForm
          initial={edit === "new" ? null : edit}
          kind={edit === "new" ? (production ? tab : "raw") : edit.kind}
          previewNo={
            edit === "new" ? nextInvoiceNo((list.data ?? []).map((x) => x.invoiceNo), "S") : edit.invoiceNo
          }
          onClose={() => setEdit(null)}
          onSaved={(closed) => {
            if (!production) setShopTab(closed ? "closed" : "open");
          }}
        />
      ) : null}
      {printRow ? (
        <SaleForm initial={printRow} kind={printRow.kind} previewNo={printRow.invoiceNo} view onClose={() => setPrintRow(null)} />
      ) : null}
      <ConfirmDelete
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deleteSaleInvoice({ data: { id: del.id } });
          await refresh();
          toast.success("حذف شد");
        }}
      />
    </div>
  );
}

function SaleForm({
  initial,
  kind,
  previewNo,
  onClose,
  onSaved,
  view,
}: {
  initial: SaleInvoice | null;
  kind: Item["kind"];
  previewNo: string;
  onClose: () => void;
  onSaved?: (closed: boolean) => void;
  view?: boolean;
}) {
  const { data } = useAppData();
  const company = data?.company;
  const writableCo = canWrite(data?.profile?.role, "company");
  const customers = (data?.catalogs.parties ?? []).filter((p) => p.kind === "customer");
  const items = (data?.catalogs.items ?? []).filter((i) => i.kind === kind);
  const units = data?.catalogs.units ?? [];
  const afn = findAfn(data?.catalogs.currencies ?? []);
  const sheet = useSheetRef();
  const [customerId, setCustomer] = useState<number | null>(initial?.customerId ?? null);
  const [date, setDate] = useState(initial?.occurredOn ?? "");
  const [fx, setFx] = useState(initial?.fxEnabled ?? false);
  const [currencyId, setCurrency] = useState<number | null>(initial?.currencyId ?? afn?.id ?? null);
  const [rate, setRate] = useState(initial?.fxEnabled ? String(initial.fxRate) : "1");
  const [received, setReceived] = useState(emptyNum(initial?.receivedAmount));
  const [accountId, setAccount] = useState<number | null>(
    initial?.accountId ??
      (data?.catalogs.accounts ?? []).find((a) => afn && a.currencyId === afn.id)?.id ??
      data?.catalogs.accounts[0]?.id ??
      null,
  );
  const accounts = data?.catalogs.accounts ?? [];
  const currencies = data?.catalogs.currencies ?? [];
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const [recvCurrencyId, setRecvCurrency] = useState<number | null>(
    initial ? (accounts.find((a) => a.id === initial.accountId)?.currencyId ?? afn?.id ?? null) : (afn?.id ?? null),
  );
  const recvCur = currencies.find((c) => c.id === recvCurrencyId) ?? null;
  const [recvRate, setRecvRate] = useState(
    initial?.receivedFxRate && initial.receivedFxRate > 0
      ? String(initial.receivedFxRate)
      : String(recvCur?.rateToBase ?? afn?.rateToBase ?? 1),
  );
  const [refund, setRefund] = useState(emptyNum(initial?.refundAmount));
  const afnAccounts = accounts.filter((a) => afn && a.currencyId === afn.id);
  const [refundAccountId, setRefundAccount] = useState<number | null>(
    initial?.refundAccountId ?? afnAccounts[0]?.id ?? null,
  );
  const [includeCash, setIncludeCash] = useState((initial?.cashIncludedBase ?? 0) > 0);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    initial?.lines.length
      ? initial.lines.map((l) => ({
          key: String(l.id),
          itemId: l.itemId,
          itemName: l.itemName,
          quantity: emptyNum(l.quantity),
          unitId: l.unitId,
          unitPrice: emptyNum(l.unitPrice),
        }))
      : [emptyLine(units[0]?.id ?? null)],
  );
  const [addAcc, setAddAcc] = useState(false);
  const [add, setAdd] = useState<"customer" | "item" | "unit" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [leave, setLeave] = useState(false);
  const production = data?.settings.productionEnabled !== false;
  const inv = useQuery({ queryKey: ["inventory"], queryFn: () => getInventory() });
  const takes = useQuery({
    queryKey: ["customer-cash", customerId, initial?.id ?? 0],
    queryFn: () => listCustomerCashTakes({ data: { customerId: customerId!, invoiceId: initial?.id ?? null } }),
    enabled: customerId != null,
  });
  const invoices = useQuery({ queryKey: ["sale-invoices"], queryFn: () => listSaleInvoices() });
  const cashRows = takes.data ?? [];
  const lastOpen = useMemo(() => {
    if (customerId == null) return false;
    const open = (invoices.data ?? []).filter((r) => r.customerId === customerId && !r.closed);
    open.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id - a.id);
    return initial != null && !initial.closed && open[0]?.id === initial.id;
  }, [invoices.data, customerId, initial]);
  const [pickedCash, setPickedCash] = useState<number[]>([]);
  useEffect(() => {
    if (!takes.data) return;
    setPickedCash(takes.data.filter((r) => r.applied).map((r) => r.id));
    if (takes.data.some((r) => r.applied)) setIncludeCash(true);
  }, [takes.data]);

  const total = useMemo(
    () => lines.reduce((s, l) => s + parseAmount(l.quantity) * parseAmount(l.unitPrice), 0),
    [lines],
  );
  const fxRate = fx ? parseAmount(rate) || 1 : 1;
  const recvRateN = parseAmount(recvRate) || recvCur?.rateToBase || 1;
  const cashSum = includeCash
    ? cashRows.filter((r) => pickedCash.includes(r.id)).reduce((s, r) => s + r.amountBase, 0)
    : 0;
  const totalBase = total * fxRate + cashSum;
  const recN = parseAmount(received);
  const receivedBase = recN * recvRateN;
  const over = receivedBase - totalBase;
  const refundN = parseAmount(refund);
  const customerCredit = over > 1e-9 ? Math.max(0, over - (refundN > 0 ? refundN : 0)) : 0;
  const remainingBase = totalBase - receivedBase + (over > 1e-9 ? Math.min(refundN, over) : 0);
  const phones = [company?.phone1, company?.phone2, company?.phone3].filter(Boolean);
  const pool = kind === "raw" ? (inv.data?.raw ?? []) : (inv.data?.products ?? []);
  const giveBack = useMemo(() => {
    const m = new Map<number, number>();
    if (!initial) return m;
    for (const l of initial.lines) {
      if (l.itemId == null) continue;
      m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.quantity);
    }
    return m;
  }, [initial]);
  const shortages = useMemo(() => {
    const needBy = new Map<number, { name: string; qty: number }>();
    for (const l of lines) {
      if (l.itemId == null || !l.itemName.trim()) continue;
      const qty = parseAmount(l.quantity);
      if (qty <= 0) continue;
      const cur = needBy.get(l.itemId) ?? { name: l.itemName, qty: 0 };
      cur.qty += qty;
      needBy.set(l.itemId, cur);
    }
    const msgs: string[] = [];
    for (const [itemId, n] of needBy) {
      const have = (pool.find((c) => c.itemId === itemId)?.qty ?? 0) + (giveBack.get(itemId) ?? 0);
      if (have + 1e-9 < n.qty) {
        msgs.push(`${n.name}: موجودی کافی نیست (موجود ${formatMoney(have)}، لازم ${formatMoney(n.qty)})`);
      }
    }
    return msgs;
  }, [lines, pool, giveBack]);

  async function persist(closed: boolean) {
    if (view) return;
    if (!currencyId) return;
    if (!accountId) {
      setError("حساب انتخاب نشده است");
      return;
    }
    if (!accounts.length) {
      setError("حساب انتخاب نشده است");
      return;
    }
    if (!recvCurrencyId || !account || account.currencyId !== recvCurrencyId) {
      setError("ارز مبلغ دریافتی با ارز دخل انتخاب‌شده یکسان نیست");
      return;
    }
    if (over > 1e-9 && refundN - over > 1e-9) {
      setError("پرداخت باقی‌مانده از مابه‌التفاوت بیشتر است");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveSaleInvoice({
        data: {
          id: initial?.id,
          customerId,
          occurredOn: date || todayIso(),
          currencyId: fx ? currencyId : afn?.id ?? currencyId,
          fxEnabled: fx,
          fxRate,
          receivedAmount: recN,
          receivedFxRate: recvRateN,
          receivedCurrencyId: recvCurrencyId,
          accountId,
          notes,
          kind,
          closed,
          refundAmount: over > 1e-9 ? refundN : 0,
          refundAccountId: over > 1e-9 ? refundAccountId : null,
          cashPaymentIds: includeCash ? pickedCash : [],
          lines: lines.map((l) => ({
            itemId: l.itemId,
            itemName: l.itemName,
            quantity: parseAmount(l.quantity),
            unitId: l.unitId,
            unitPrice: parseAmount(l.unitPrice),
          })),
        },
      });
      await refresh();
      toast.success(closed ? "فاکتور بسته شد" : "ثبت شد");
      onSaved?.(closed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا");
    } finally {
      setBusy(false);
    }
  }

  function requestClose() {
    if (!view && dirty) {
      setLeave(true);
      return;
    }
    onClose();
  }

  return (
    <>
      <Modal
        open
        title={view ? `فاکتور ${previewNo}` : initial ? "ویرایش فاکتور فروش" : "فاکتور فروش جدید"}
        onClose={requestClose}
        paper
      >
        <form
          className="invoice-form"
          onChangeCapture={() => setDirty(true)}
          onSubmit={(e) => {
            e.preventDefault();
            void persist(false);
          }}
        >
          <div ref={sheet} className="print-sheet overflow-visible">
            <section className="border-b-2 border-border-strong p-3">
              <InvoiceBrand
                logo={company?.logo}
                name={company?.name || "دفتر حساب"}
                phones={phones as string[]}
                invoiceNo={previewNo}
                invoiceCaption="شماره فاکتور :"
                editable={Boolean(writableCo && company)}
                onLogo={(logo) => {
                  if (!company) return;
                  void saveCompany({
                    data: {
                      name: company.name,
                      logo,
                      licenseNo: company.licenseNo,
                      tin: company.tin,
                      address: company.address,
                      phone1: company.phone1,
                      phone2: company.phone2,
                      phone3: company.phone3,
                      email: company.email,
                    },
                  }).then(() => queryClient.invalidateQueries({ queryKey: ["bootstrap"] }));
                }}
              />
              <div className="mt-3 flex flex-nowrap items-end gap-2 overflow-x-auto">
                <div className="min-w-28 flex-1">
                  <Field label="مشتری">
                    {view ? (
                      <p className="flex h-11 items-center text-sm whitespace-nowrap">{initial?.customerName || ""}</p>
                    ) : (
                      <EntitySelect
                        value={customerId}
                        placeholder=""
                        options={customers.map((v) => ({ id: v.id, label: v.name }))}
                        onChange={(id) => {
                          setDirty(true);
                          setCustomer(id == null ? null : Number(id));
                        }}
                        onAdd={() => setAdd("customer")}
                      />
                    )}
                  </Field>
                </div>
                <div className="min-w-28 flex-1">
                  <Field label="تاریخ">
                    {view ? (
                      <p className="flex h-11 items-center text-sm whitespace-nowrap">{date ? <DateText iso={date} /> : null}</p>
                    ) : (
                      <DateField value={date} onChange={(v) => { setDirty(true); setDate(v); }} />
                    )}
                  </Field>
                </div>
              </div>
              <div className="no-print export-exclude mt-2">
                <FxBar
                  enabled={fx}
                  onEnabled={(v) => {
                    setDirty(true);
                    setFx(v);
                    if (!v && afn) {
                      setCurrency(afn.id);
                      setRate("1");
                    }
                  }}
                  currencies={currencies}
                  currencyId={currencyId}
                  onCurrency={(id, r) => {
                    setDirty(true);
                    setCurrency(id);
                    setRate(String(r));
                  }}
                  rate={rate}
                  onRate={setRate}
                  disabled={view}
                />
              </div>
            </section>
            <section className="min-h-52 border-b-2 border-border-strong p-3">
              <InvoiceLines
                lines={lines}
                onChange={(ls) => {
                  setDirty(true);
                  setLines(ls);
                }}
                items={items}
                units={units}
                itemLabel={kind === "raw" ? "نوع جنس" : "نوع کالا"}
                onAddItem={() => setAdd("item")}
                onAddUnit={() => setAdd("unit")}
                disabled={view}
              />
              {lastOpen && cashRows.length ? (
                <label className="mt-3 flex items-center justify-start gap-2 text-sm text-danger">
                  <span>بردگی نقدی</span>
                  <input
                    type="checkbox"
                    checked={includeCash}
                    disabled={view}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setIncludeCash(on);
                      if (on) setPickedCash(cashRows.map((r) => r.id));
                    }}
                  />
                </label>
              ) : null}
              {lastOpen && includeCash && cashRows.length ? (
                <ul className="mt-2 space-y-1">
                  {cashRows.map((r) => (
                    <li
                      key={r.id}
                      className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-danger/40 px-3 py-2 text-sm"
                    >
                      <DateText iso={r.occurredOn} />
                      <span className="truncate">{r.notes || "بردگی نقدی"}</span>
                      <span className="tabular-nums whitespace-nowrap">
                        {formatMoney(r.amount)} {r.currencySymbol}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
            <section className="space-y-2 p-3">
              <div className="space-y-3">
                <div className="grid grid-cols-2 items-center gap-2 rounded-md border border-border-strong bg-surface-2 p-2">
                  <span className="text-base font-bold">جمع کل</span>
                  <div className="flex h-11 items-center justify-center rounded-md border border-border-strong bg-surface px-2">
                    <AfAmount value={totalBase} size="sm" className="justify-center text-base font-bold" />
                  </div>
                </div>
                <div className="space-y-2 rounded-md border border-border-strong bg-surface p-2">
                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    <span>مبلغ دریافتی</span>
                    <span>ارز</span>
                    <span>نرخ تبدیل</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {view ? (
                      <div className="flex h-11 items-center justify-center rounded-md border border-border-strong bg-surface-2 px-2 tabular-nums">
                        {formatMoney(recN)}
                      </div>
                    ) : (
                      <MoneyInput value={received} onChange={setReceived} className="h-11 w-full text-center" />
                    )}
                    {view ? (
                      <div className="flex h-11 items-center justify-center rounded-md border border-border-strong bg-surface-2 px-2 text-center text-sm">
                        {recvCur ? `${recvCur.name} (${recvCur.symbol})` : "—"}
                      </div>
                    ) : (
                      <EntitySelect
                        className="h-11 w-full justify-center text-center"
                        value={recvCurrencyId}
                        options={currencies.map((c) => ({ id: c.id, label: `${c.name} (${c.symbol})` }))}
                        onChange={(id) => {
                          setDirty(true);
                          const cid = id == null ? null : Number(id);
                          setRecvCurrency(cid);
                          const next = currencies.find((c) => c.id === cid);
                          if (next) setRecvRate(String(next.rateToBase || 1));
                        }}
                      />
                    )}
                    {view ? (
                      <div className="flex h-11 items-center justify-center rounded-md border border-border-strong bg-surface-2 px-2 tabular-nums">
                        {formatMoney(recvRateN)}
                      </div>
                    ) : (
                      <Input className="h-11 w-full text-center" value={recvRate} onChange={(e) => setRecvRate(e.target.value)} />
                    )}
                  </div>
                  <div className="export-exclude no-print grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                    <span className="text-sm">به حساب</span>
                    {view ? (
                      <div className="flex h-11 items-center justify-center rounded-md border border-border-strong bg-surface-2 px-2 text-center text-sm">
                        {account?.name || initial?.accountName || "—"}
                      </div>
                    ) : (
                      <EntitySelect
                        className="h-11 w-full justify-center text-center"
                        value={accountId}
                        options={accounts.map((a) => ({ id: a.id, label: `${a.name} (${a.currencySymbol})` }))}
                        onChange={(id) => {
                          setDirty(true);
                          const nextId = id == null ? null : Number(id);
                          setAccount(nextId);
                        }}
                        onAdd={() => setAddAcc(true)}
                      />
                    )}
                  </div>
                </div>
                {account && recvCurrencyId != null && account.currencyId !== recvCurrencyId ? (
                  <p className="export-exclude no-print rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-center text-sm text-danger">
                    ارز مبلغ دریافتی با ارز دخل انتخاب‌شده یکسان نیست
                  </p>
                ) : null}
                <div className="grid grid-cols-2 items-center gap-2 rounded-md border border-border-strong bg-surface-2 p-2">
                  <span className="text-base font-bold">باقی مانده</span>
                  <div className="flex h-11 items-center justify-center rounded-md border border-border-strong bg-surface px-2">
                    <AfAmount value={Math.abs(remainingBase) < 1e-9 ? 0 : remainingBase} size="sm" className="justify-center text-base font-bold" />
                  </div>
                </div>
              </div>
              {over > 1e-9 ? (
                <div className="mt-3 space-y-2 rounded-md border border-border p-3">
                  <div className="text-center text-sm font-bold">پرداخت باقی مانده پول مشتری</div>
                  <div className="grid grid-cols-2 gap-2 text-center text-sm">
                    <span>مبلغ پرداختی</span>
                    <span>باقی طلب مشتری</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {view ? (
                      <div className="flex h-11 items-center justify-center rounded-md border border-border-strong bg-surface-2 px-2 tabular-nums">
                        {formatMoney(refundN)}
                      </div>
                    ) : (
                      <Input className="h-11 text-center" value={refund} onChange={(e) => setRefund(e.target.value)} />
                    )}
                    <div className="flex h-11 items-center justify-center rounded-md border border-border-strong bg-surface-2 px-2">
                      <AfAmount value={customerCredit} size="sm" />
                    </div>
                  </div>
                  <div className="export-exclude no-print space-y-2">
                    <div className="text-center text-sm">دخل (افغانی)</div>
                    {view ? (
                      <div className="flex h-11 items-center justify-center rounded-md border border-border-strong bg-surface-2 px-2 text-center text-sm">
                        {afnAccounts.find((a) => a.id === refundAccountId)?.name || "—"}
                      </div>
                    ) : (
                      <EntitySelect
                        className="h-11 w-full justify-center text-center"
                        value={refundAccountId}
                        options={afnAccounts.map((a) => ({ id: a.id, label: a.name }))}
                        onChange={(id) => {
                          setDirty(true);
                          setRefundAccount(id == null ? null : Number(id));
                        }}
                      />
                    )}
                  </div>
                </div>
              ) : null}
              <div className="mt-3">
                <Field label="یادداشت">
                  {view ? (
                    <p className="min-h-16 text-sm whitespace-pre-wrap">{notes}</p>
                  ) : (
                    <Textarea className="min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  )}
                </Field>
              </div>
            </section>
          </div>
          <SheetActions targetRef={sheet} filename={`فروش-${previewNo}`} image />
          {shortages.length ? (
            <ul className="mt-3 space-y-1 rounded-sm border border-danger/35 bg-danger-soft px-3 py-2">
              {shortages.map((line) => (
                <li key={line} className="text-sm leading-6 text-danger">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
          {error ? <ErrorLines message={error} /> : null}
          {!view ? (
            production ? (
              <div className="no-print mt-4">
                <Button type="submit" disabled={busy}>
                  ثبت فاکتور
                </Button>
              </div>
            ) : (
            <div className="no-print mt-4 grid grid-cols-3 items-center">
              <Button type="submit" disabled={busy} className="h-10 w-24 justify-self-start px-2 text-sm">
                ثبت موقت
              </Button>
              <Button type="button" disabled={busy} className="h-10 w-48 justify-self-center px-3 text-sm" onClick={() => void persist(true)}>
                ثبت نهایی
              </Button>
              <span />
            </div>
            )
          ) : null}
        </form>
      </Modal>
      {leave ? (
        <Modal open title="تغییرات ذخیره نشده است" onClose={() => setLeave(false)}>
          <p className="text-sm">تغییرات این فاکتور ذخیره نشده است.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setLeave(false);
                void persist(false);
              }}
            >
              ذخیره
            </Button>
            <Button
              type="button"
              onClick={() => {
                setLeave(false);
                onClose();
              }}
            >
              لغو ذخیره
            </Button>
          </div>
        </Modal>
      ) : null}
      {addAcc ? (
        <AccountFormModal
          onClose={() => setAddAcc(false)}
          onSaved={(id) => {
            setAccount(id);
            setAddAcc(false);
          }}
        />
      ) : null}
      <AddNameModal
        open={add === "customer"}
        title="افزودن مشتری"
        onClose={() => setAdd(null)}
        onSave={async (name) => {
          const res = await saveParty({
            data: {
              name,
              kind: "customer",
              phone: "",
              categoryId: null,
              notes: "",
              jobTypeId: null,
              startDate: todayIso(),
              address: "",
              currencyId: null,
            },
          });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          setCustomer(res.id);
        }}
      />
      <AddNameModal
        open={add === "item"}
        title={kind === "raw" ? "افزودن جنس" : "افزودن کالا"}
        onClose={() => setAdd(null)}
        onSave={async (name) => {
          const res = await saveItem({
            data: { name, kind, typeId: null, categoryId: null, unitId: units[0]?.id ?? null },
          });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          setLines((ls) => {
            const blank = ls.findIndex((l) => !l.itemName);
            if (blank < 0) return ls;
            return ls.map((l, i) => (i === blank ? { ...l, itemId: res.id, itemName: name } : l));
          });
        }}
      />
      <AddNameModal
        open={add === "unit"}
        title="افزودن واحد"
        onClose={() => setAdd(null)}
        onSave={async (name) => {
          await saveUnit({ data: { name } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
    </>
  );
}
