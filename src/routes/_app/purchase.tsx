import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AddNameModal } from "@/components/add-name-modal";
import { ConfirmDelete } from "@/components/confirm-delete";
import { DataTable } from "@/components/data-table";
import { DateField, DateText } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { Guard } from "@/components/guard";
import { RowActions } from "@/components/icon-btn";
import {
  AfAmount,
  emptyLine,
  ErrorLines,
  FxBar,
  InvoiceBrand,
  InvoiceLines,
  AccountFormModal,
  SectionTabs,
  SheetActions,
  useSheetRef,
  type DraftLine,
} from "@/components/invoice-ui";
import { useAppData } from "@/components/layout/app-shell";
import { MoneyInput } from "@/components/money-input";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { saveCompany } from "@/lib/api/core";
import {
  deletePurchaseInvoice,
  listPurchaseInvoices,
  receivePurchaseInvoice,
  savePurchaseInvoice,
} from "@/lib/api/invoices";
import { saveItem, saveParty, saveUnit, saveWarehouse } from "@/lib/api/setup";
import { findAfn, formatMoney, emptyNum, nextInvoiceNo, parseAmount, todayIso, convertAmount } from "@/lib/format";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import type { PurchaseInvoice } from "@/lib/types";
import { clearUsageFocus, onUsageFocus, peekUsageFocus } from "@/lib/usage-focus";

export const Route = createFileRoute("/_app/purchase")({ component: Page });

function Page() {
  return (
    <Guard area="purchase">
      <Purchases />
    </Guard>
  );
}

async function refresh() {
  await queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
  await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
  await queryClient.invalidateQueries({ queryKey: ["warehouse-stock"] });
}

function Purchases() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "purchase");
  const list = useQuery({ queryKey: ["purchase-invoices"], queryFn: () => listPurchaseInvoices() });
  const [tab, setTab] = useState<"in_transit" | "arrived">("in_transit");
  const [edit, setEdit] = useState<PurchaseInvoice | "new" | null>(null);
  const [del, setDel] = useState<PurchaseInvoice | null>(null);
  const [printRow, setPrintRow] = useState<PurchaseInvoice | null>(null);
  const [receive, setReceive] = useState<PurchaseInvoice | null>(null);
  const rows = (list.data ?? []).filter((r) => r.receiveStatus === tab);

  useEffect(() => {
    function apply() {
      const f = peekUsageFocus();
      if (!f || f.page !== "purchase") return;
      const all = list.data ?? [];
      if (f.invoiceId != null) {
        const row = all.find((r) => r.id === f.invoiceId);
        if (!row) {
          if (!list.isFetched) return;
        } else {
          setTab(row.receiveStatus);
          setPrintRow(row);
          clearUsageFocus();
          return;
        }
      }
      if (f.tab === "arrived" || f.tab === "in_transit") setTab(f.tab);
      clearUsageFocus();
    }
    apply();
    return onUsageFocus(apply);
  }, [list.data, list.isFetched]);

  return (
    <div>
      <PageHeader title="خرید" titleClass="text-2xl font-bold" canAdd={writable} onAdd={() => setEdit("new")} />
      <SectionTabs
        fill
        contrast
        labelClass="h-12 text-base font-bold sm:text-lg"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "in_transit", label: "فاکتورهای در راه", color: "a" },
          { id: "arrived", label: "فاکتورهای رسیده", color: "b" },
        ]}
      />
      <div>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty="فاکتوری در این بخش نیست"
          tone={tab === "in_transit" ? "a" : "b"}
          excel={tab === "in_transit" ? "فاکتورهای در راه" : "فاکتورهای رسیده"}
          columns={[
            { header: "شماره", cell: (r) => <span className="tabular-nums">{r.invoiceNo}</span> },
            { header: "تاریخ", cell: (r) => <DateText iso={r.occurredOn} /> },
            { header: "فروشنده", cell: (r) => r.vendorName || "—" },
            {
              header: "جمع",
              cell: (r) => <AfAmount value={r.totalBase} />,
            },
            {
              header: "باقی",
              cell: (r) => <AfAmount value={r.remainingBase} />,
            },
            {
              header: "",
              className: "w-36",
              cell: (r) => (
                <div className="flex items-center gap-1">
                  {tab === "in_transit" && writable ? (
                    <Button className="h-9 bg-primary px-3 text-2xs text-primary-fg" onClick={() => setReceive(r)}>
                      ثبت رسید
                    </Button>
                  ) : null}
                  <RowActions
                    canWrite={writable}
                    onPrint={() => setPrintRow(r)}
                    onEdit={() => setEdit(r)}
                    onDelete={() => setDel(r)}
                  />
                </div>
              ),
            },
          ]}
        />
      </div>
      {edit ? (
        <PurchaseForm
          initial={edit === "new" ? null : edit}
          previewNo={
            edit === "new" ? nextInvoiceNo((list.data ?? []).map((x) => x.invoiceNo), "B") : edit.invoiceNo
          }
          onClose={() => setEdit(null)}
        />
      ) : null}
      {printRow ? <PurchaseForm initial={printRow} previewNo={printRow.invoiceNo} view onClose={() => setPrintRow(null)} /> : null}
      {receive ? <ReceiveModal invoice={receive} onClose={() => setReceive(null)} /> : null}
      <ConfirmDelete
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deletePurchaseInvoice({ data: { id: del.id } });
          await refresh();
        }}
      />
    </div>
  );
}

function PurchaseForm({
  initial,
  previewNo,
  onClose,
  view,
}: {
  initial: PurchaseInvoice | null;
  previewNo: string;
  onClose: () => void;
  view?: boolean;
}) {
  const { data } = useAppData();
  const company = data?.company;
  const writableCo = canWrite(data?.profile?.role, "company");
  const vendors = (data?.catalogs.parties ?? []).filter((p) => p.kind === "vendor");
  const items = (data?.catalogs.items ?? []).filter((i) => i.kind === "raw");
  const units = data?.catalogs.units ?? [];
  const afn = findAfn(data?.catalogs.currencies ?? []);
  const sheet = useSheetRef();
  const [vendorId, setVendor] = useState<number | null>(initial?.vendorId ?? null);
  const [date, setDate] = useState(initial?.occurredOn ?? "");
  const [expected, setExpected] = useState(initial?.expectedOn ?? "");
  const [fx, setFx] = useState(initial?.fxEnabled ?? false);
  const [currencyId, setCurrency] = useState<number | null>(initial?.currencyId ?? afn?.id ?? null);
  const [rate, setRate] = useState(initial?.fxEnabled ? String(initial.fxRate) : "1");
  const [paid, setPaid] = useState(emptyNum(initial?.paidAmount));
  const [accountId, setAccount] = useState<number | null>(
    initial?.accountId ??
      (data?.catalogs.accounts ?? []).find((a) => afn && a.currencyId === afn.id)?.id ??
      data?.catalogs.accounts[0]?.id ??
      null,
  );
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
  const [add, setAdd] = useState<"vendor" | "item" | "unit" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [leave, setLeave] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const total = useMemo(
    () => lines.reduce((s, l) => s + parseAmount(l.quantity) * parseAmount(l.unitPrice), 0),
    [lines],
  );
  const fxRate = fx ? parseAmount(rate) || 1 : 1;
  const totalBase = total * fxRate;
  const paidN = parseAmount(paid);
  const remaining = total - paidN;
  const remainingBase = remaining * fxRate;

  function requestClose() {
    if (!view && dirty) {
      setLeave(true);
      return;
    }
    onClose();
  }

  return (
    <>
      <Modal open title={view ? `فاکتور ${previewNo}` : initial ? "ویرایش فاکتور خرید" : "فاکتور خرید جدید"} onClose={requestClose} paper>
        <form
          ref={formRef}
          className="invoice-form"
          onChangeCapture={() => setDirty(true)}
          onSubmit={async (e) => {
            e.preventDefault();
            if (view) return;
            if (!currencyId) return;
            if (!accountId || !(data?.catalogs.accounts ?? []).length) {
              setError("حساب انتخاب نشده است");
              return;
            }
            const acc = data?.catalogs.accounts.find((a) => a.id === accountId);
            if (!acc) {
              setError("حساب انتخاب نشده است");
              return;
            }
            if (paidN > 0) {
              const invoiceRate = fx ? fxRate : (data?.catalogs.currencies.find((c) => c.id === currencyId)?.rateToBase || 1);
              const accRate = data?.catalogs.currencies.find((c) => c.id === acc.currencyId)?.rateToBase || 1;
              const need = convertAmount(paidN, invoiceRate, accRate);
              if (need > acc.balance + 1e-9) {
                setError("موجودی ناکافی هست");
                return;
              }
            }
            setBusy(true);
            setError("");
            try {
              await savePurchaseInvoice({
                data: {
                  id: initial?.id,
                  vendorId,
                  occurredOn: date || todayIso(),
                  expectedOn: expected,
                  currencyId: fx ? currencyId : afn?.id ?? currencyId,
                  fxEnabled: fx,
                  fxRate: fxRate,
                  paidAmount: paidN,
                  accountId,
                  notes,
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
              toast.success("ثبت شد");
              onClose();
            } catch (err) {
              setError(err instanceof Error ? err.message : "خطا");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div ref={sheet} className="print-sheet overflow-visible">
            <section className="border-b-2 border-border-strong p-3">
              <InvoiceBrand
                logo={company?.logo}
                name={company?.name || "دفتر حساب"}
                phones={[company?.phone1, company?.phone2, company?.phone3].filter(Boolean) as string[]}
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
                <Field label="فروشنده">
                  {view ? (
                    <p className="flex h-11 items-center text-sm whitespace-nowrap">{initial?.vendorName || ""}</p>
                  ) : (
                    <EntitySelect
                      value={vendorId}
                      placeholder=""
                      options={vendors.map((v) => ({ id: v.id, label: v.name }))}
                      onChange={(id) => {
                        setDirty(true);
                        setVendor(id == null ? null : Number(id));
                      }}
                      onAdd={() => setAdd("vendor")}
                    />
                  )}
                </Field>
                </div>
                <div className="min-w-28 flex-1">
                <Field label="تاریخ ثبت">
                  {view ? (
                    <p className="flex h-11 items-center text-sm whitespace-nowrap">
                      {date ? <DateText iso={date} /> : null}
                    </p>
                  ) : (
                    <DateField value={date} onChange={(v) => { setDirty(true); setDate(v); }} />
                  )}
                </Field>
                </div>
                <div className="min-w-28 flex-1">
                <Field label="تاریخ تقریبی رسید">
                  {view ? (
                    <p className="flex h-11 items-center text-sm whitespace-nowrap">
                      {expected ? <DateText iso={expected} /> : null}
                    </p>
                  ) : (
                    <DateField value={expected} onChange={(v) => { setDirty(true); setExpected(v); }} />
                  )}
                </Field>
                </div>
              </div>
              <div className="mt-2">
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
                  currencies={data?.catalogs.currencies ?? []}
                  currencyId={currencyId}
                  onCurrency={(id, r) => {
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
                itemLabel="نوع جنس"
                onAddItem={() => setAdd("item")}
                onAddUnit={() => setAdd("unit")}
                disabled={view}
              />
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
                  <div className="grid grid-cols-2 items-center gap-2">
                    <span className="text-center text-sm">مبلغ پرداختی</span>
                    {view ? (
                      <div className="flex h-11 items-center justify-center rounded-md border border-border-strong bg-surface-2 px-2 tabular-nums">
                        {formatMoney(paidN)}
                      </div>
                    ) : (
                      <MoneyInput value={paid} onChange={setPaid} className="h-11 w-full text-center" />
                    )}
                  </div>
                  <div className="export-exclude no-print grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                    <span className="text-sm">از حساب</span>
                    {view ? (
                      <div className="flex h-11 items-center justify-center rounded-md border border-border-strong bg-surface-2 px-2 text-center text-sm">
                        {initial?.accountName || data?.catalogs.accounts.find((a) => a.id === accountId)?.name || "—"}
                      </div>
                    ) : (
                      <EntitySelect
                        className="h-11 w-full justify-center text-center"
                        value={accountId}
                        options={(data?.catalogs.accounts ?? []).map((a) => ({ id: a.id, label: `${a.name} (${a.currencySymbol})` }))}
                        onChange={(id) => {
                          setDirty(true);
                          setAccount(id == null ? null : Number(id));
                        }}
                        onAdd={() => setAddAcc(true)}
                      />
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 items-center gap-2 rounded-md border border-border-strong bg-surface-2 p-2">
                  <span className="text-base font-bold">باقی مانده</span>
                  <div className="flex h-11 items-center justify-center rounded-md border border-border-strong bg-surface px-2">
                    <AfAmount value={remainingBase} size="sm" className="justify-center text-base font-bold" />
                  </div>
                </div>
              </div>
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
          <SheetActions targetRef={sheet} filename={`خرید-${previewNo}`} image />
          {error ? <ErrorLines message={error} /> : null}
          {!view ? (
            <div className="no-print mt-4">
              <Button type="submit" disabled={busy}>
                ثبت فاکتور
              </Button>
            </div>
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
                formRef.current?.requestSubmit();
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
              لغو (خروج)
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
        open={add === "vendor"}
        title="افزودن فروشنده"
        onClose={() => setAdd(null)}
        onSave={async (name) => {
          const res = await saveParty({
            data: {
              name,
              kind: "vendor",
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
          setVendor(res.id);
        }}
      />
      <AddNameModal
        open={add === "item"}
        title="افزودن جنس"
        onClose={() => setAdd(null)}
        onSave={async (name) => {
          const res = await saveItem({
            data: { name, kind: "raw", typeId: null, categoryId: null, unitId: units[0]?.id ?? null },
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

function ReceiveModal({ invoice, onClose }: { invoice: PurchaseInvoice; onClose: () => void }) {
  const { data } = useAppData();
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [wh, setWh] = useState(data?.catalogs.warehouses[0]?.name ?? "");
  const [cat, setCat] = useState<number | null>(null);
  const [addWh, setAddWh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState(
    invoice.lines.map((l) => ({
      id: l.id,
      name: l.itemName,
      ordered: l.quantity,
      already: l.receivedQty,
      received: String(Math.max(0, l.quantity - l.receivedQty)),
      notes: l.notes,
    })),
  );

  return (
    <>
      <Modal open title={`ثبت رسید ${invoice.invoiceNo}`} onClose={onClose} wide>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await receivePurchaseInvoice({
                data: {
                  id: invoice.id,
                  warehouseName: wh,
                  categoryId: cat,
                  mode,
                  lines: rows.map((r) => ({
                    id: r.id,
                    receivedQty: parseAmount(r.received),
                    notes: r.notes,
                  })),
                },
              });
              await refresh();
              toast.success("رسید ثبت شد");
              onClose();
            } catch (err) {
              setError(err instanceof Error ? err.message : "خطا");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode("full")}
              className={`rounded-md border-2 px-4 py-2 text-sm ${mode === "full" ? "border-tab-a bg-surface-2" : "border-tab-a bg-surface opacity-75"}`}
            >
              رسید کامل
            </button>
            <button
              type="button"
              onClick={() => setMode("partial")}
              className={`rounded-md border-2 px-4 py-2 text-sm ${mode === "partial" ? "border-tab-c bg-surface-2" : "border-tab-c bg-surface opacity-75"}`}
            >
              رسید ناقص
            </button>
          </div>
          <Field label="گدام">
            <EntitySelect
              value={data?.catalogs.warehouses.find((w) => w.name === wh)?.id ?? null}
              options={(data?.catalogs.warehouses ?? []).map((w) => ({ id: w.id, label: w.name }))}
              onChange={(id) => {
                const w = data?.catalogs.warehouses.find((x) => x.id === Number(id));
                setWh(w?.name ?? "");
              }}
              onAdd={() => setAddWh(true)}
            />
          </Field>
          <Field label="دسته‌بندی">
            <EntitySelect
              value={cat}
              options={(data?.catalogs.itemCategories ?? [])
                .filter((c) => c.kind === "raw")
                .map((c) => ({ id: c.id, label: c.name }))}
              onChange={(id) => setCat(id == null ? null : Number(id))}
            />
          </Field>
          {mode === "partial" ? (
            <div className="overflow-hidden">
              <table className="w-full table-fixed border-collapse text-2xs sm:text-sm">
                <thead>
                  <tr className="bg-surface-2">
                    <th className="border border-border px-2 py-2 text-right">شماره</th>
                    <th className="border border-border px-2 py-2 text-right">نوع جنس</th>
                    <th className="border border-border px-2 py-2 text-right">تعداد سفارش</th>
                    <th className="border border-border px-2 py-2 text-right">تعداد دریافتی</th>
                    <th className="border border-border px-2 py-2 text-right">باقی‌مانده</th>
                    <th className="border border-border px-2 py-2 text-right">یادداشت</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const left = Math.max(0, r.ordered - r.already - parseAmount(r.received));
                    return (
                      <tr key={r.id}>
                        <td className="border border-border px-2 py-1 tabular-nums">{i + 1}</td>
                        <td className="border border-border px-2 py-1">{r.name}</td>
                        <td className="border border-border px-2 py-1 tabular-nums">{formatMoney(r.ordered)}</td>
                        <td className="border border-border px-1 py-1">
                          <MoneyInput
                            value={r.received}
                            onChange={(v) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, received: v } : x)))}
                          />
                        </td>
                        <td className="border border-border px-2 py-1 tabular-nums">{formatMoney(left)}</td>
                        <td className="border border-border px-1 py-1">
                          <input
                            className="field-input h-10"
                            value={r.notes}
                            onChange={(e) =>
                              setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, notes: e.target.value } : x)))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            ثبت رسید
          </Button>
        </form>
      </Modal>
      <AddNameModal
        open={addWh}
        title="افزودن گدام"
        onClose={() => setAddWh(false)}
        onSave={async (name) => {
          await saveWarehouse({ data: { name } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          setWh(name);
        }}
      />
    </>
  );
}
