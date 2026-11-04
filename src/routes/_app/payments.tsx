import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { CurrencyMatchNote } from "@/components/currency-match";
import { DataTable } from "@/components/data-table";
import { DateField, DateText } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { Guard } from "@/components/guard";
import { RowActions } from "@/components/icon-btn";
import { AfAmount, InvoiceBrand, SectionTabs, SheetActions, useSheetRef } from "@/components/invoice-ui";
import { useAppData } from "@/components/layout/app-shell";
import { MoneyInput } from "@/components/money-input";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { deletePartyPayment, getPartyBalance, listOutstandingParties, listPartyPayments, savePartyPayment } from "@/lib/api/reports";
import { findAfn, formatMoney, emptyNum, parseAmount, todayIso } from "@/lib/format";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import { type Party, type PartyPayment, PARTY_KIND_LABEL } from "@/lib/types";

export const Route = createFileRoute("/_app/payments")({ component: Page });

function Page() {
  return (
    <Guard area="payments">
      <Payments />
    </Guard>
  );
}

function Payments() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "payments");
  const [tab, setTab] = useState<PartyPayment["kind"]>("payment");
  const list = useQuery({
    queryKey: ["party-payments", tab],
    queryFn: () => listPartyPayments({ data: { kind: tab } }),
  });
  const [edit, setEdit] = useState<PartyPayment | "new" | null>(null);
  const [printRow, setPrintRow] = useState<PartyPayment | null>(null);
  const [del, setDel] = useState<PartyPayment | null>(null);

  return (
    <div>
      <PageHeader
        title="پرداخت و دریافت"
        titleClass="text-2xl font-bold"
        canAdd={writable}
        onAdd={() => setEdit("new")}
      />
      <SectionTabs
        fill
        contrast
        labelClass="h-12 text-base font-bold sm:text-lg"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "payment", label: "پرداختی‌ها", color: "c" },
          { id: "receipt", label: "دریافتی‌ها", color: "a" },
        ]}
      />
      <div>
        <DataTable
          rows={list.data ?? []}
          rowKey={(r) => r.id}
          excel={tab === "payment" ? "پرداختی‌ها" : "دریافتی‌ها"}
          tone="a"
          columns={[
            { header: "تاریخ", cell: (r) => <DateText iso={r.occurredOn} /> },
            { header: "طرف حساب", cell: (r) => r.partyName },
            { header: "دسته", cell: (r) => r.categoryName || PARTY_KIND_LABEL[r.partyKind as Party["kind"]] || "—" },
            {
              header: "مبلغ",
              cell: (r) => (
                <span className="tabular-nums text-2xs">
                  {formatMoney(r.amount)} {r.currencySymbol}
                </span>
              ),
            },
            { header: "معادل ؋", cell: (r) => <AfAmount value={r.amountBase} /> },
            { header: "حساب", cell: (r) => r.accountName || "—" },
            {
              header: "",
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
        <PayForm kind={tab} initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} />
      ) : null}
      {printRow ? <ReceiptSlip row={printRow} onClose={() => setPrintRow(null)} /> : null}
      <ConfirmDelete
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deletePartyPayment({ data: { id: del.id } });
          await queryClient.invalidateQueries({ queryKey: ["party-payments"] });
          await queryClient.invalidateQueries({ queryKey: ["customer-cash"] });
          await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
    </div>
  );
}

function PayForm({
  kind,
  initial,
  onClose,
}: {
  kind: PartyPayment["kind"];
  initial: PartyPayment | null;
  onClose: () => void;
}) {
  const { data } = useAppData();
  const afn = findAfn(data?.catalogs.currencies ?? []);
  const tills = (data?.catalogs.accounts ?? []).filter((a) => a.kind !== "counterparty");
  const [partyId, setPartyId] = useState<number | null>(initial?.partyId ?? null);
  const [amount, setAmount] = useState(emptyNum(initial?.amount));
  const [currencyId, setCurrency] = useState<number | null>(initial?.currencyId ?? afn?.id ?? null);
  const startRate =
    initial?.fxRate && initial.fxRate > 1e-12
      ? initial.fxRate
      : (data?.catalogs.currencies ?? []).find((c) => c.id === (initial?.currencyId ?? afn?.id))?.rateToBase || 1;
  const [fxRate, setFxRate] = useState(emptyNum(startRate));
  const afnTill = tills.find((a) => afn && a.currencyId === afn.id);
  const [accountId, setAccount] = useState<number | null>(initial?.accountId ?? afnTill?.id ?? tills[0]?.id ?? null);
  const [date, setDate] = useState(initial?.occurredOn || todayIso());
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [slip, setSlip] = useState(false);
  const outstanding = useQuery({
    queryKey: ["outstanding", kind],
    queryFn: () => listOutstandingParties({ data: { side: kind === "payment" ? "creditor" : "debtor" } }),
  });
  const partyOptions = useMemo(() => {
    const parties = data?.catalogs.parties ?? [];
    const byId = new Map<
      number,
      { id: number; name: string; remainingBase: number; invoicedBase: number; paidBase: number }
    >();
    const put = (
      id: number,
      name: string,
      extra?: { remainingBase: number; invoicedBase: number; paidBase: number },
    ) => {
      const prev = byId.get(id);
      if (prev) {
        if (extra) Object.assign(prev, extra);
        return;
      }
      byId.set(id, {
        id,
        name,
        remainingBase: extra?.remainingBase ?? 0,
        invoicedBase: extra?.invoicedBase ?? 0,
        paidBase: extra?.paidBase ?? 0,
      });
    };
    if (kind === "payment") {
      for (const p of parties) {
        if (p.kind === "vendor" || p.kind === "worker" || p.kind === "customer") put(p.id, p.name);
      }
    } else {
      for (const p of parties) {
        if (p.kind === "customer") put(p.id, p.name);
      }
    }
    for (const p of outstanding.data ?? []) {
      put(p.id, p.name, { remainingBase: p.remainingBase, invoicedBase: p.invoicedBase, paidBase: p.paidBase });
    }
    for (const a of data?.catalogs.accounts ?? []) {
      if (a.kind !== "counterparty") continue;
      const rate = (data?.catalogs.currencies ?? []).find((c) => c.id === a.currencyId)?.rateToBase || 1;
      put(-a.id, `${a.name} (نقدی)`, {
        remainingBase: Math.abs(a.balance) * rate,
        invoicedBase: Math.abs(a.openingBalance) * rate,
        paidBase: 0,
      });
    }
    if (initial?.partyId) put(initial.partyId, initial.partyName);
    return [...byId.values()];
  }, [data?.catalogs.parties, data?.catalogs.accounts, data?.catalogs.currencies, outstanding.data, initial, kind]);
  const cashAccountId = partyId != null && partyId < 0 ? -partyId : null;
  const accountOptions = (cashAccountId != null ? tills : (data?.catalogs.accounts ?? []))
    .filter((a) => a.id !== cashAccountId)
    .map((a) => ({ id: a.id, label: `${a.name} (${a.currencySymbol})` }));
  const balance = useQuery({
    queryKey: ["party-balance", partyId],
    queryFn: () => getPartyBalance({ data: { partyId: partyId! } }),
    enabled: partyId != null,
  });
  const cur = (data?.catalogs.currencies ?? []).find((c) => c.id === currencyId);
  const amountN = parseAmount(amount);
  const liveRate = parseAmount(fxRate) || cur?.rateToBase || 1;
  const amountBase = amountN * liveRate;
  const selected = partyOptions.find((p) => p.id === partyId);

  return (
    <Modal open title={initial ? "ویرایش" : kind === "payment" ? "پرداخت جدید" : "دریافت جدید"} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!partyId || !currencyId) {
            setError("طرف حساب و ارز لازم است");
            return;
          }
          setBusy(true);
          setError("");
          try {
            await savePartyPayment({
              data: {
                id: initial?.id,
                partyId,
                kind,
                amount: amountN,
                currencyId,
                fxRate: liveRate,
                accountId,
                occurredOn: date,
                notes,
              },
            });
            await queryClient.invalidateQueries({ queryKey: ["party-payments"] });
            await queryClient.invalidateQueries({ queryKey: ["customer-cash"] });
            await queryClient.invalidateQueries({ queryKey: ["outstanding"] });
            await queryClient.invalidateQueries({ queryKey: ["party-statement"] });
            await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            toast.success("ثبت شد");
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "خطا");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="نام طرف حساب">
          <EntitySelect
            value={partyId}
            options={partyOptions.map((p) => ({ id: p.id, label: p.name }))}
            onChange={(id) => {
              const n = id == null ? null : Number(id);
              setPartyId(n);
              if (n != null && n < 0) {
                const till = tills.find((a) => a.id !== -n) ?? tills[0];
                if (till && (accountId == null || accountId === -n)) setAccount(till.id);
              }
            }}
          />
        </Field>
        {partyId && (balance.data || selected) ? (
          <BalanceBox
            name={balance.data?.partyName || selected?.name || ""}
            remainingBase={Math.abs(balance.data?.remainingBase ?? selected?.remainingBase ?? 0)}
            byCurrency={balance.data?.byCurrency ?? []}
            label={kind === "payment" ? "طلب" : "بدهی"}
          />
        ) : null}
        <Field label="تاریخ">
          <DateField value={date} onChange={setDate} />
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-end gap-2">
          <Field label="ارز">
            <EntitySelect
              value={currencyId}
              options={(data?.catalogs.currencies ?? []).map((c) => ({ id: c.id, label: `${c.name} (${c.symbol})` }))}
              onChange={(id) => {
                const n = id == null ? null : Number(id);
                setCurrency(n);
                const next = (data?.catalogs.currencies ?? []).find((c) => c.id === n);
                setFxRate(emptyNum(next?.rateToBase || 1));
              }}
            />
          </Field>
          <Field label="نرخ">
            <MoneyInput value={fxRate} onChange={setFxRate} />
          </Field>
        </div>
        <Field label="مبلغ">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        {cur && !cur.symbol.includes("؋") && amountN > 0 ? (
          <div className="flex items-center justify-between rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm">
            <span className="text-muted">معادل افغانی</span>
            <AfAmount value={amountBase} size="sm" />
          </div>
        ) : null}
        <Field label={kind === "payment" ? "از حساب" : "به حساب"}>
          <EntitySelect
            value={accountId}
            options={accountOptions}
            onChange={(id) => {
              const n = id == null ? null : Number(id);
              setAccount(n);
            }}
          />
        </Field>
        <CurrencyMatchNote
          accounts={data?.catalogs.accounts ?? []}
          currencies={data?.catalogs.currencies ?? []}
          accountId={accountId}
          currencyId={currencyId}
          amount={amount}
          fromRate={liveRate}
          verb={kind === "payment" ? "کسر" : "افزودن"}
        />
        <Field label="یادداشت">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            ثبت
          </Button>
          <Button type="button" variant="secondary" onClick={() => setSlip(true)}>
            چاپ رسید
          </Button>
        </div>
      </form>
      {slip ? (
        <ReceiptSlip
          row={{
            id: initial?.id ?? 0,
            partyId: partyId ?? 0,
            partyName: partyOptions.find((p) => p.id === partyId)?.name || initial?.partyName || "",
            partyKind: initial?.partyKind ?? "",
            categoryName: initial?.categoryName ?? "",
            kind,
            amount: amountN,
            amountBase,
            currencyId: currencyId ?? 0,
            currencySymbol: cur?.symbol || "؋",
            fxRate: liveRate,
            accountId,
            accountName: (data?.catalogs.accounts ?? []).find((a) => a.id === accountId)?.name || "",
            receiptNo: initial?.receiptNo || "",
            occurredOn: date,
            notes,
          }}
          onClose={() => setSlip(false)}
        />
      ) : null}
    </Modal>
  );
}

function ReceiptSlip({ row, onClose }: { row: PartyPayment; onClose: () => void }) {
  const { data } = useAppData();
  const sheet = useSheetRef();
  const company = data?.company;
  const phones = [company?.phone1, company?.phone2, company?.phone3].filter(Boolean) as string[];
  const title = row.kind === "payment" ? "پرداخت" : "دریافت";
  return (
    <Modal open title={`رسید ${title}`} onClose={onClose} paper>
      <div ref={sheet} className="print-sheet space-y-3 p-4">
        <InvoiceBrand
          logo={company?.logo}
          name={company?.name || "دفتر حساب"}
          phones={phones}
          invoiceNo={row.receiptNo || "—"}
          invoiceCaption="شماره رسید :"
        />
        <section className="grid grid-cols-2 gap-3 rounded-md border border-border-strong bg-surface-2 p-3 text-sm">
          <div>
            <div className="text-2xs text-muted">نوع</div>
            <div className="font-bold">{title}</div>
          </div>
          <div>
            <div className="text-2xs text-muted">تاریخ</div>
            <div className="font-semibold"><DateText iso={row.occurredOn} /></div>
          </div>
        </section>
        <section className="rounded-md border border-border-strong p-3 text-sm">
          <div className="text-2xs text-muted">طرف حساب</div>
          <div className="font-bold">{row.partyName || "—"}</div>
          {row.categoryName ? <div className="mt-1 text-2xs text-muted">{row.categoryName}</div> : null}
        </section>
        <section className="grid grid-cols-2 gap-3 rounded-md border border-border-strong bg-surface-2 p-3 text-sm">
          <div>
            <div className="text-2xs text-muted">مبلغ</div>
            <div className="font-bold tabular-nums">
              {formatMoney(row.amount)} {row.currencySymbol}
            </div>
          </div>
          <div>
            <div className="text-2xs text-muted">معادل افغانی</div>
            <AfAmount value={row.amountBase} size="sm" />
          </div>
        </section>
        {row.notes ? (
          <section className="rounded-md border border-border p-3 text-sm">
            <div className="text-2xs text-muted">یادداشت</div>
            <div>{row.notes}</div>
          </section>
        ) : null}
      </div>
      <SheetActions targetRef={sheet} filename={row.receiptNo || title} image pdf />
    </Modal>
  );
}

function BalanceBox({
  name,
  remainingBase,
  byCurrency,
  label,
}: {
  name: string;
  remainingBase: number;
  byCurrency: { symbol: string; remaining: number }[];
  label: string;
}) {
  return (
    <div className="rounded-sm border-2 border-tab-b bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          {label} ({name})
        </span>
        <AfAmount value={remainingBase} size="sm" />
      </div>
      {byCurrency.length > 1 ? (
        <ul className="mt-2 space-y-1">
          {byCurrency.map((c) => (
            <li key={c.symbol} className="flex justify-between text-2xs tabular-nums">
              <span>{c.symbol}</span>
              <span>{formatMoney(c.remaining)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
