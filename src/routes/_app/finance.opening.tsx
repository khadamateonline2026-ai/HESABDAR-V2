import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { CurrencyMatchNote } from "@/components/currency-match";
import { DataTable } from "@/components/data-table";
import { DateField, DateText } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { Guard } from "@/components/guard";
import { RowActions } from "@/components/icon-btn";
import { SectionTabs, tabPanel } from "@/components/invoice-ui";
import { useAppData } from "@/components/layout/app-shell";
import { MoneyInput } from "@/components/money-input";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  deleteOpeningCash,
  deleteOpeningStock,
  listOpeningCash,
  listOpeningStock,
  saveOpeningCash,
} from "@/lib/api/finance";
import { OpeningStockModal } from "@/components/opening-stock-modal";
import { emptyNum, formatMoney, formatMoneySymbol, parseAmount, todayIso, convertAmount } from "@/lib/format";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import type { OpeningCash, OpeningStock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { clearUsageFocus, onUsageFocus, peekUsageFocus } from "@/lib/usage-focus";

export const Route = createFileRoute("/_app/finance/opening")({ component: Page });

function Page() {
  return (
    <Guard area="opening">
      <Opening />
    </Guard>
  );
}

function Opening() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "opening");
  const [tab, setTab] = useState<"cash" | "finished" | "raw">("cash");
  const cash = useQuery({ queryKey: ["opening-cash"], queryFn: () => listOpeningCash() });
  const finished = useQuery({
    queryKey: ["opening-stock", "finished"],
    queryFn: () => listOpeningStock({ data: { kind: "finished" } }),
  });
  const raw = useQuery({
    queryKey: ["opening-stock", "raw"],
    queryFn: () => listOpeningStock({ data: { kind: "raw" } }),
  });
  const [cashEdit, setCashEdit] = useState<OpeningCash | "new" | null>(null);
  const [stockEdit, setStockEdit] = useState<{ kind: "finished" | "raw"; row: OpeningStock | null } | null>(null);
  const [delCash, setDelCash] = useState<OpeningCash | null>(null);
  const [delStock, setDelStock] = useState<OpeningStock | null>(null);
  const [qName, setQName] = useState("");
  const production = data?.settings.productionEnabled !== false;
  const shopNames = new Set(
    (data?.catalogs.warehouses ?? [])
      .filter((w) => w.shopOnly === true && w.name !== "گدام کالای تولید شده" && w.name !== "گدام مواد خام" && w.name !== "مواد نزد کارگران")
      .map((w) => w.name),
  );

  useEffect(() => {
    function apply() {
      const f = peekUsageFocus();
      if (!f || f.page !== "opening") return;
      if (f.tab === "finished" || f.tab === "raw" || f.tab === "cash") setTab(f.tab);
      if (f.query) setQName(f.query);
      const source = f.tab === "raw" ? raw : finished;
      const match = f.query
        ? (source.data ?? []).find((r) => r.itemName.toLocaleLowerCase() === f.query!.toLocaleLowerCase())
        : null;
      if (f.query && !match && !source.isFetched) return;
      if (match) setStockEdit({ kind: match.kind, row: match });
      clearUsageFocus();
    }
    apply();
    return onUsageFocus(apply);
  }, [finished.data, finished.isFetched, raw.data, raw.isFetched]);

  function filterStock(rows: OpeningStock[]) {
    const n = qName.trim().toLocaleLowerCase();
    return rows.filter((r) => {
      if (!production && !shopNames.has(r.warehouseName)) return false;
      if (!n) return true;
      return r.itemName.toLocaleLowerCase().includes(n);
    });
  }

  return (
    <div>
      <PageHeader
        title="تعدیل موجودی"
        canAdd={writable}
        onAdd={() => {
          if (tab === "cash") setCashEdit("new");
          else setStockEdit({ kind: tab, row: null });
        }}
      />
      <div className="mb-4 flex flex-nowrap items-stretch gap-1.5 overflow-x-auto">
        <SectionTabs
          className="mb-0 min-w-0 flex-1"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "cash", label: "دخل", color: "a" },
            { id: "finished", label: "کالای تولید شده", color: "b" },
            { id: "raw", label: "مواد خام", color: "c" },
          ]}
        />
        {tab !== "cash" ? (
          <label className="flex h-11 shrink-0 items-center rounded-md border-2 border-tab-d bg-surface px-3 text-2xs font-medium sm:text-sm">
            <span className="sr-only">جستجو</span>
            <input
              value={qName}
              onChange={(e) => setQName(e.target.value)}
              placeholder="جستجو"
              className="h-full w-24 bg-transparent text-center outline-none sm:w-28"
            />
          </label>
        ) : null}
      </div>

      {tab === "cash" ? (
        <div className={tabPanel("a")}>
        <DataTable
          tone="c"
          rows={cash.data ?? []}
          rowKey={(r) => r.id}
          excel="تعدیل موجودی دخل"
          columns={[
            { header: "حساب", cell: (r) => r.accountName },
            { header: "نوع", cell: (r) => (r.amount < 0 ? "کسر" : "افزوده") },
            {
              header: "مبلغ",
              cell: (r) => <span className="tabular-nums">{formatMoneySymbol(Math.abs(r.amount), r.currencySymbol)}</span>,
            },
            { header: "تاریخ", cell: (r) => <DateText iso={r.occurredOn} /> },
            { header: "یادداشت", cell: (r) => r.notes || "—" },
            {
              header: "",
              cell: (r) => (
                <RowActions canWrite={writable} onEdit={() => setCashEdit(r)} onDelete={() => setDelCash(r)} />
              ),
            },
          ]}
        />
        </div>
      ) : tab === "finished" ? (
        <div className={tabPanel("b")}>
        <DataTable
          tone="c"
          rows={filterStock(finished.data ?? [])}
          rowKey={(r) => r.id}
          excel="تعدیل کالای تولید شده"
          columns={[
            { header: "نام", cell: (r) => r.itemName },
            { header: "گدام", cell: (r) => r.warehouseName },
            { header: "نوع", cell: (r) => (r.quantity < 0 ? "کسر" : "افزوده") },
            { header: "مقدار", cell: (r) => <span className="tabular-nums">{formatMoney(Math.abs(r.quantity))}</span> },
            { header: "تاریخ", cell: (r) => <DateText iso={r.occurredOn} /> },
            { header: "یادداشت", cell: (r) => r.notes || "—" },
            {
              header: "",
              cell: (r) => (
                <RowActions
                  canWrite={writable}
                  onEdit={() => setStockEdit({ kind: "finished", row: r })}
                  onDelete={() => setDelStock(r)}
                />
              ),
            },
          ]}
        />
        </div>
      ) : (
        <div className={tabPanel("c")}>
        <DataTable
          tone="c"
          rows={filterStock(raw.data ?? [])}
          rowKey={(r) => r.id}
          excel="تعدیل مواد خام"
          columns={[
            { header: "نام", cell: (r) => r.itemName },
            { header: "گدام", cell: (r) => r.warehouseName },
            { header: "نوع", cell: (r) => (r.quantity < 0 ? "کسر" : "افزوده") },
            { header: "مقدار", cell: (r) => <span className="tabular-nums">{formatMoney(Math.abs(r.quantity))}</span> },
            { header: "تاریخ", cell: (r) => <DateText iso={r.occurredOn} /> },
            { header: "یادداشت", cell: (r) => r.notes || "—" },
            {
              header: "",
              cell: (r) => (
                <RowActions
                  canWrite={writable}
                  onEdit={() => setStockEdit({ kind: "raw", row: r })}
                  onDelete={() => setDelStock(r)}
                />
              ),
            },
          ]}
        />
        </div>
      )}

      {cashEdit ? <CashModal initial={cashEdit === "new" ? null : cashEdit} onClose={() => setCashEdit(null)} /> : null}
      {stockEdit ? (
        <OpeningStockModal kind={stockEdit.kind} initial={stockEdit.row} onClose={() => setStockEdit(null)} />
      ) : null}
      <ConfirmDelete
        open={Boolean(delCash)}
        onClose={() => setDelCash(null)}
        onConfirm={async () => {
          if (!delCash) return;
          await deleteOpeningCash({ data: { id: delCash.id } });
          await queryClient.invalidateQueries({ queryKey: ["opening-cash"] });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
      <ConfirmDelete
        open={Boolean(delStock)}
        onClose={() => setDelStock(null)}
        onConfirm={async () => {
          if (!delStock) return;
          await deleteOpeningStock({ data: { id: delStock.id } });
          await queryClient.invalidateQueries({ queryKey: ["opening-stock"] });
          await queryClient.invalidateQueries({ queryKey: ["inventory"] });
          await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        }}
      />
    </div>
  );
}

function CashModal({ initial, onClose }: { initial: OpeningCash | null; onClose: () => void }) {
  const { data } = useAppData();
  const acc = data?.catalogs.accounts ?? [];
  const currencies = data?.catalogs.currencies ?? [];
  const [accountId, setAccount] = useState<number | null>(initial?.accountId ?? acc[0]?.id ?? null);
  const selected = acc.find((a) => a.id === accountId);
  const [currencyId, setCurrency] = useState<number | null>(initial?.currencyId ?? selected?.currencyId ?? null);
  const [amount, setAmount] = useState(emptyNum(initial ? Math.abs(initial.amount) : undefined));
  const [dir, setDir] = useState<"add" | "sub">(initial && initial.amount < 0 ? "sub" : "add");
  const [date, setDate] = useState(initial?.occurredOn || todayIso());
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState("");
  const mag = parseAmount(amount);
  const signed = dir === "sub" ? -mag : mag;
  const rateOf = (id: number | null | undefined) => currencies.find((c) => c.id === id)?.rateToBase || 1;
  const converted = convertAmount(signed, rateOf(currencyId), rateOf(selected?.currencyId));
  let current = selected?.balance ?? 0;
  if (initial && selected && initial.accountId === selected.id) {
    current -= convertAmount(initial.amount, rateOf(initial.currencyId), rateOf(selected.currencyId));
  }
  const nextBal = current + converted;

  return (
    <Modal open title="تعدیل موجودی دخل" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (!accountId || !currencyId) return;
          if (mag <= 0) {
            setError("مبلغ باید بزرگ‌تر از صفر باشد");
            return;
          }
          try {
            await saveOpeningCash({
              data: {
                id: initial?.id,
                accountId,
                currencyId,
                amount: signed,
                occurredOn: date,
                notes,
              },
            });
            await queryClient.invalidateQueries({ queryKey: ["opening-cash"] });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
            onClose();
            toast.success("ثبت شد");
          } catch (err) {
            setError(err instanceof Error ? err.message : "ثبت ناکام شد");
          }
        }}
      >
        <Field label="حساب">
          <EntitySelect
            value={accountId}
            options={acc.map((a) => ({
              id: a.id,
              label: `${a.name} (${a.currencySymbol})${a.kind === "counterparty" ? " — نقدی" : ""}`,
            }))}
            onChange={(id) => {
              const n = id == null ? null : Number(id);
              setAccount(n);
              const a = acc.find((x) => x.id === n);
              if (a) setCurrency(a.currencyId);
            }}
          />
        </Field>
        {selected ? (
          <div className="rounded-sm border border-border bg-surface-2 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-micro text-muted">
              <span>موجودی فعلی</span>
              <span className="tabular-nums">{formatMoneySymbol(selected.balance, selected.currencySymbol)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-micro text-muted">
              <span>موجودی پس از تعدیل</span>
              <span className="tabular-nums">{formatMoneySymbol(nextBal, selected.currencySymbol)}</span>
            </div>
          </div>
        ) : null}
        <Field label="ارز">
          <EntitySelect
            value={currencyId}
            options={currencies.map((c) => ({ id: c.id, label: `${c.name} (${c.symbol})` }))}
            onChange={(id) => setCurrency(id == null ? null : Number(id))}
          />
        </Field>
        <CurrencyMatchNote
          accounts={acc}
          currencies={data?.catalogs.currencies ?? []}
          accountId={accountId}
          currencyId={currencyId}
          amount={amount}
          verb={dir === "add" ? "افزودن" : "کسر"}
        />
        <Field label="مبلغ">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="نوع تعدیل">
          <div className="grid grid-cols-2 rounded-md border border-border bg-surface-2 p-1">
            <button
              type="button"
              onClick={() => setDir("add")}
              className={cn(
                "rounded-sm px-3 py-2 text-sm font-medium",
                dir === "add" ? "bg-surface text-fg shadow-sm" : "text-muted",
              )}
            >
              افزوده شود
            </button>
            <button
              type="button"
              onClick={() => setDir("sub")}
              className={cn(
                "rounded-sm px-3 py-2 text-sm font-medium",
                dir === "sub" ? "bg-surface text-fg shadow-sm" : "text-muted",
              )}
            >
              کسر شود
            </button>
          </div>
        </Field>
        <Field label="تاریخ">
          <DateField value={date} onChange={setDate} />
        </Field>
        <Field label="یادداشت">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit">ثبت</Button>
      </form>
    </Modal>
  );
}
