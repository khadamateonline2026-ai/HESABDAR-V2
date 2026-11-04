import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AddNameModal } from "@/components/add-name-modal";
import { ConfirmDelete } from "@/components/confirm-delete";
import { ConfirmAccountantReset } from "@/components/confirm-accountant";
import { DataTable } from "@/components/data-table";
import { DateField, DateText } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { FilterTable } from "@/components/filter-table";
import { Guard } from "@/components/guard";
import { RowActions } from "@/components/icon-btn";
import { SectionTabs } from "@/components/invoice-ui";
import { useAppData } from "@/components/layout/app-shell";
import { MoneyInput } from "@/components/money-input";
import { PageHeader } from "@/components/page-header";
import { PartyFormModal } from "@/components/party-form";
import { ReportSheet } from "@/components/report-tools";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { CategoryBar } from "@/components/warehouse-ui";
import {
  deleteExpense,
  deleteExpenseCategory,
  deleteRecurringExpense,
  listExpenseCategories,
  listExpenses,
  listRecurringDues,
  listRecurringExpenses,
  resetExpenseHistory,
  saveExpense,
  saveExpenseCategory,
  saveRecurringExpense,
  setRecurringPeriodStatus,
} from "@/lib/api/ops";
import { findAfn, formatMoney, formatMoneySymbol, emptyNum, parseAmount, todayIso } from "@/lib/format";
import { formatPreferredDate } from "@/lib/jalali";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import { useCalendarMode } from "@/lib/prefs";
import { CurrencyMatchNote } from "@/components/currency-match";
import {
  CADENCE_LABELS,
  CADENCE_OPTIONS,
  DUE_ANCHOR_LABELS,
  parseCadence,
  parseDueAnchor,
  type Expense,
  type ExpenseCategory,
  type RecurringCadence,
  type RecurringDue,
  type RecurringDueAnchor,
  type RecurringExpense,
} from "@/lib/types";

export const Route = createFileRoute("/_app/expenses")({ component: Page });

type Tab = "misc" | "recurring" | "history";

function Page() {
  return (
    <Guard area="expenses">
      <ExpensesPage />
    </Guard>
  );
}

async function refreshExpenses() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["expenses"] }),
    queryClient.invalidateQueries({ queryKey: ["expense-categories"] }),
    queryClient.invalidateQueries({ queryKey: ["recurring-expenses"] }),
    queryClient.invalidateQueries({ queryKey: ["recurring-dues"] }),
    queryClient.invalidateQueries({ queryKey: ["bootstrap"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["party-statement"] }),
  ]);
}

function ExpensesPage() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "expenses");
  const [tab, setTab] = useState<Tab>("misc");
  const cats = useQuery({ queryKey: ["expense-categories"], queryFn: () => listExpenseCategories() });
  const list = useQuery({ queryKey: ["expenses"], queryFn: () => listExpenses() });
  const recs = useQuery({ queryKey: ["recurring-expenses"], queryFn: () => listRecurringExpenses() });
  const dues = useQuery({ queryKey: ["recurring-dues"], queryFn: () => listRecurringDues() });
  const [filter, setFilter] = useState<{ misc: number | "all"; recurring: number | "all" }>({
    misc: "all",
    recurring: "all",
  });
  const [addCat, setAddCat] = useState(false);
  const [editCat, setEditCat] = useState<{ id: number; name: string } | null>(null);
  const [delCat, setDelCat] = useState<{ id: number; name: string } | null>(null);
  const [miscEdit, setMiscEdit] = useState<Expense | "new" | null>(null);
  const [miscDel, setMiscDel] = useState<Expense | null>(null);
  const [recEdit, setRecEdit] = useState<RecurringExpense | "new" | null>(null);
  const [recDel, setRecDel] = useState<RecurringExpense | null>(null);
  const [resetHistory, setResetHistory] = useState(false);

  const kind: ExpenseCategory["kind"] = tab === "recurring" ? "recurring" : "misc";
  const kindCats = (cats.data ?? []).filter((c) => c.kind === kind);
  const catFilter = tab === "history" ? "all" : filter[tab];
  const miscRows = (list.data ?? []).filter((e) => {
    if (e.notes.startsWith("دوره ")) return false;
    if (catFilter === "all") return true;
    return e.categoryId === catFilter;
  });
  const recRows = (recs.data ?? []).filter((e) => (catFilter === "all" ? true : e.categoryId === catFilter));
  const unpaid = (dues.data ?? []).filter((d) => d.status === "unpaid" && d.workerId == null);

  return (
    <div>
      <PageHeader
        title="هزینه‌ها"
        titleClass="text-2xl font-bold"
        canAdd={writable && tab !== "history"}
        onAdd={() => (tab === "misc" ? setMiscEdit("new") : tab === "recurring" ? setRecEdit("new") : undefined)}
      />
      <SectionTabs
        fill
        contrast
        labelClass="h-12 text-base font-bold sm:text-lg"
        value={tab}
        onChange={(id) => {
          setTab(id);
          setAddCat(false);
          setEditCat(null);
          setDelCat(null);
        }}
        tabs={[
          { id: "misc", label: "هزینه‌های متفرقه", color: "a" },
          { id: "recurring", label: "هزینه‌های تکراری", color: "b" },
          { id: "history", label: "تاریخچه هزینه‌ها", color: "c" },
        ]}
      />

      {tab === "misc" ? (
        <div>
          <DataTable
            rows={miscRows}
            rowKey={(r) => r.id}
            excel="هزینه‌های متفرقه"
            tone="a"
            toolbar={
              <CategoryBar
                className="mb-2"
                categories={kindCats}
                value={filter.misc}
                onChange={(id) => setFilter((f) => ({ ...f, misc: id }))}
                writable={writable}
                canEdit
                onAdd={() => setAddCat(true)}
                onEdit={setEditCat}
                onDelete={setDelCat}
              />
            }
            columns={[
              { header: "تشریح", cell: (r) => r.title },
              {
                header: "مبلغ",
                cell: (r) => <span className="tabular-nums">{formatMoneySymbol(r.amount, r.currencySymbol)}</span>,
              },
              { header: "از حساب", cell: (r) => (r.asDebt ? "بدهی متفرقه" : r.accountName || "—") },
              { header: "طرف حساب", cell: (r) => r.partyName || "—" },
              { header: "دسته‌بندی", cell: (r) => r.categoryName || "—" },
              {
                header: "تاریخ",
                cell: (r) => <DateText iso={r.occurredOn} />,
              },
              { header: "یادداشت", cell: (r) => r.notes || "—" },
              {
                header: "",
              cell: (r) => (
                  <RowActions canWrite={writable} onEdit={() => setMiscEdit(r)} onDelete={() => setMiscDel(r)} />
                ),
              },
            ]}
          />
        </div>
      ) : tab === "recurring" ? (
        <div>
          {unpaid.length ? (
            <div className="mb-3 space-y-1.5 rounded-md border-2 border-tab-c p-2">
              <h2 className="text-2xs font-semibold whitespace-nowrap">هشدار موعد پرداخت</h2>
              {unpaid.map((d) => (
                <DueRow key={`${d.recurringId}-${d.period}`} due={d} writable={writable} />
              ))}
            </div>
          ) : null}
          <DataTable
            rows={recRows}
            rowKey={(r) => r.id}
            excel="هزینه‌های تکراری"
            tone="b"
            toolbar={
              <CategoryBar
                className="mb-2"
                categories={kindCats}
                value={filter.recurring}
                onChange={(id) => setFilter((f) => ({ ...f, recurring: id }))}
                writable={writable}
                canEdit
                onAdd={() => setAddCat(true)}
                onEdit={setEditCat}
                onDelete={setDelCat}
              />
            }
            columns={[
              { header: "تشریح", cell: (r) => r.title },
              {
                header: "مبلغ",
                cell: (r) => <span className="tabular-nums">{formatMoneySymbol(r.amount, r.currencySymbol)}</span>,
              },
              { header: "از حساب", cell: (r) => r.accountName || "—" },
              { header: "طرف حساب", cell: (r) => r.partyName || "—" },
              { header: "دسته‌بندی", cell: (r) => r.categoryName || "—" },
              {
                header: "دوره تکرار",
                cell: (r) => CADENCE_LABELS[r.cadence],
              },
              {
                header: "تاریخ شروع",
                cell: (r) => <DateText iso={r.startOn} />,
              },
              { header: "یادداشت", cell: (r) => r.notes || "—" },
              {
                header: "",
              cell: (r) => (
                  <RowActions canWrite={writable} onEdit={() => setRecEdit(r)} onDelete={() => setRecDel(r)} />
                ),
              },
            ]}
          />
        </div>
      ) : (
        <div>
          {writable ? (
            <div className="mb-3 flex justify-end">
              <Button variant="danger" onClick={() => setResetHistory(true)}>
                ریست تاریخچه
              </Button>
            </div>
          ) : null}
          <ReportSheet title="تاریخچه هزینه‌ها">
          <HistoryTable rows={[...(list.data ?? [])].sort((a, b) =>
            a.occurredOn === b.occurredOn ? b.id - a.id : a.occurredOn < b.occurredOn ? 1 : -1,
          )} />
          </ReportSheet>
        </div>
      )}

      <AddNameModal
        open={addCat}
        title="افزودن دسته‌بندی"
        onClose={() => setAddCat(false)}
        onSave={async (name) => {
          await saveExpenseCategory({ data: { name, kind } });
          await refreshExpenses();
        }}
      />
      <AddNameModal
        open={Boolean(editCat)}
        title="ویرایش دسته‌بندی"
        initial={editCat?.name ?? ""}
        onClose={() => setEditCat(null)}
        onSave={async (name) => {
          if (!editCat) return;
          await saveExpenseCategory({ data: { id: editCat.id, name, kind } });
          await refreshExpenses();
        }}
      />
      <ConfirmDelete
        open={Boolean(delCat)}
        title="حذف دسته‌بندی"
        onClose={() => setDelCat(null)}
        onConfirm={async () => {
          if (!delCat) return;
          await deleteExpenseCategory({ data: { id: delCat.id } });
          await refreshExpenses();
          toast.success("حذف شد");
        }}
      />
      {miscEdit ? (
        <MiscModal
          initial={miscEdit === "new" ? null : miscEdit}
          defaultCategoryId={typeof filter.misc === "number" ? filter.misc : null}
          onClose={() => setMiscEdit(null)}
        />
      ) : null}
      <ConfirmDelete
        open={Boolean(miscDel)}
        onClose={() => setMiscDel(null)}
        onConfirm={async () => {
          if (!miscDel) return;
          await deleteExpense({ data: { id: miscDel.id } });
          await refreshExpenses();
        }}
      />
      {recEdit ? (
        <RecurringModal
          initial={recEdit === "new" ? null : recEdit}
          defaultCategoryId={typeof filter.recurring === "number" ? filter.recurring : null}
          onClose={() => setRecEdit(null)}
        />
      ) : null}
      <ConfirmDelete
        open={Boolean(recDel)}
        onClose={() => setRecDel(null)}
        onConfirm={async () => {
          if (!recDel) return;
          await deleteRecurringExpense({ data: { id: recDel.id } });
          await refreshExpenses();
        }}
      />
      <ConfirmAccountantReset
        open={resetHistory}
        title="ریست تاریخچه هزینه‌ها"
        message="تمام ردیف‌های تاریخچه هزینه‌ها پاک می‌شود. برای تأیید، کد نقش حسابدار را وارد کنید."
        confirmLabel="پاک کردن تاریخچه"
        onClose={() => setResetHistory(false)}
        onConfirm={async (code) => {
          await resetExpenseHistory({ data: { code } });
          await refreshExpenses();
          toast.success("تاریخچه هزینه‌ها پاک شد");
        }}
      />
    </div>
  );
}

function HistoryTable({ rows }: { rows: Expense[] }) {
  const cal = useCalendarMode();
  return (
    <FilterTable
      rows={rows}
      rowKey={(r) => r.id}
      empty="هزینه‌ای ثبت نشده است"
      tone="c"
      columns={[
        {
          key: "title",
          header: "تشریح",
          value: (r) => r.title || "—",
          cell: (r) => r.title,
        },
        {
          key: "date",
          header: "تاریخ",
          value: (r) => formatPreferredDate(r.occurredOn, cal),
          cell: (r) => <DateText iso={r.occurredOn} />,
        },
        {
          key: "amount",
          header: "مبلغ",
          value: (r) => formatMoneySymbol(r.amount, r.currencySymbol),
          cell: (r) => <span className="tabular-nums">{formatMoneySymbol(r.amount, r.currencySymbol)}</span>,
        },
        {
          key: "account",
          header: "از حساب",
          value: (r) => (r.asDebt ? "بدهی متفرقه" : r.accountName || "—"),
          cell: (r) => (r.asDebt ? "بدهی متفرقه" : r.accountName || "—"),
        },
        {
          key: "party",
          header: "طرف حساب",
          value: (r) => r.partyName || "—",
          cell: (r) => r.partyName || "—",
        },
        {
          key: "cat",
          header: "دسته‌بندی",
          value: (r) => r.categoryName || "—",
          cell: (r) => r.categoryName || "—",
        },
        {
          key: "notes",
          header: "یادداشت",
          value: (r) => r.notes || "—",
          cell: (r) => r.notes || "—",
        },
      ]}
    />
  );
}

function DueRow({ due, writable }: { due: RecurringDue; writable: boolean }) {
  const [busy, setBusy] = useState(false);

  async function setStatus(status: "paid" | "unpaid") {
    if (!writable || busy) return;
    if (due.status === status) return;
    setBusy(true);
    try {
      await setRecurringPeriodStatus({ data: { recurringId: due.recurringId, period: due.period, status } });
      await refreshExpenses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-sm border border-border bg-surface-2 px-2 py-1.5">
      <div className="text-sm font-medium leading-tight">{due.title}</div>
      <div className="mt-1 flex flex-nowrap items-center gap-3 overflow-x-auto">
        <span className="shrink-0 text-2xs text-muted whitespace-nowrap">
          <DateText iso={due.dueOn} />
        </span>
        <span className="shrink-0 text-2xs tabular-nums whitespace-nowrap">
          {formatMoney(due.amount)} {due.currencySymbol}
        </span>
        {writable ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void setStatus("paid")}
            className="ms-auto h-8 shrink-0 rounded-sm border border-tab-a bg-primary-soft px-2 text-2xs whitespace-nowrap"
          >
            پرداخت شد
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MiscModal({
  initial,
  defaultCategoryId,
  onClose,
}: {
  initial: Expense | null;
  defaultCategoryId: number | null;
  onClose: () => void;
}) {
  const { data } = useAppData();
  const cats = useQuery({ queryKey: ["expense-categories"], queryFn: () => listExpenseCategories() });
  const afn = findAfn(data?.catalogs.currencies ?? []);
  const miscCats = (cats.data ?? []).filter((c) => c.kind === "misc");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [amount, setAmount] = useState(emptyNum(initial?.amount));
  const [currencyId, setCurrency] = useState<number | null>(initial?.currencyId ?? afn?.id ?? null);
  const [accountId, setAccount] = useState<number | null>(initial?.accountId ?? data?.catalogs.accounts[0]?.id ?? null);
  const [partyId, setParty] = useState<number | null>(initial?.partyId ?? null);
  const [categoryId, setCategory] = useState<number | null>(initial?.categoryId ?? defaultCategoryId ?? miscCats[0]?.id ?? null);
  const [date, setDate] = useState(initial?.occurredOn || todayIso());
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [addCat, setAddCat] = useState(false);
  const [addParty, setAddParty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accounts = data?.catalogs.accounts ?? [];
  const currencies = data?.catalogs.currencies ?? [];

  return (
    <>
    <Modal open title={initial ? "ویرایش هزینه" : "هزینه متفرقه"} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!currencyId) {
            setError("ارز را انتخاب کنید");
            return;
          }
          setBusy(true);
          setError("");
          try {
            const res = await saveExpense({
              data: {
                id: initial?.id,
                title,
                amount: parseAmount(amount),
                currencyId,
                accountId,
                occurredOn: date,
                notes,
                categoryId,
                partyId,
              },
            });
            await refreshExpenses();
            onClose();
            toast.success(res.asDebt ? "موجودی دخل کافی نبود؛ به‌عنوان بدهی متفرقه ثبت شد" : "ثبت شد");
          } catch (err) {
            setError(err instanceof Error ? err.message : "ثبت ناکام شد");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="تشریح">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field label="مبلغ">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="ارز">
          <EntitySelect
            value={currencyId}
            options={(data?.catalogs.currencies ?? []).map((c) => ({ id: c.id, label: `${c.name} (${c.symbol})` }))}
            onChange={(id) => setCurrency(id == null ? null : Number(id))}
          />
        </Field>
        <Field label="از حساب">
          <EntitySelect
            value={accountId}
            options={accounts.map((a) => ({ id: a.id, label: `${a.name} (${a.currencySymbol})` }))}
            onChange={(id) => {
              const n = id == null ? null : Number(id);
              setAccount(n);
            }}
          />
        </Field>
        <CurrencyMatchNote
          accounts={accounts}
          currencies={currencies}
          accountId={accountId}
          currencyId={currencyId}
          amount={amount}
          verb="کسر"
        />
        <Field label="طرف حساب">
          <EntitySelect
            value={partyId}
            options={(data?.catalogs.parties ?? []).map((p) => ({ id: p.id, label: p.name }))}
            onChange={(id) => setParty(id == null ? null : Number(id))}
            onAdd={() => setAddParty(true)}
          />
        </Field>
        <Field label="دسته‌بندی">
          <EntitySelect
            value={categoryId}
            options={miscCats.map((c) => ({ id: c.id, label: c.name }))}
            onChange={(id) => setCategory(id == null ? null : Number(id))}
            onAdd={() => setAddCat(true)}
          />
        </Field>
        <Field label="تاریخ">
          <DateField value={date} onChange={setDate} />
        </Field>
        <Field label="یادداشت">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy}>
          ثبت
        </Button>
      </form>
    </Modal>
    <AddNameModal
      open={addCat}
      title="افزودن دسته‌بندی"
      onClose={() => setAddCat(false)}
      onSave={async (name) => {
        const res = await saveExpenseCategory({ data: { name, kind: "misc" } });
        await refreshExpenses();
        setCategory(res.id);
      }}
    />
    {addParty ? (
      <PartyFormModal
        kind="other"
        initial={null}
        onClose={() => setAddParty(false)}
        onSaved={(id) => {
          setParty(id);
          setAddParty(false);
        }}
      />
    ) : null}
    </>
  );
}

function RecurringModal({
  initial,
  defaultCategoryId,
  onClose,
}: {
  initial: RecurringExpense | null;
  defaultCategoryId: number | null;
  onClose: () => void;
}) {
  const { data } = useAppData();
  const cats = useQuery({ queryKey: ["expense-categories"], queryFn: () => listExpenseCategories() });
  const afn = findAfn(data?.catalogs.currencies ?? []);
  const recCats = (cats.data ?? []).filter((c) => c.kind === "recurring");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [amount, setAmount] = useState(emptyNum(initial?.amount));
  const [currencyId, setCurrency] = useState<number | null>(initial?.currencyId ?? afn?.id ?? null);
  const [categoryId, setCategory] = useState<number | null>(
    initial?.categoryId ?? defaultCategoryId ?? recCats[0]?.id ?? null,
  );
  const [startOn, setStartOn] = useState(initial?.startOn || "");
  const [cadence, setCadence] = useState<RecurringCadence>(parseCadence(initial?.cadence));
  const [dueAnchor, setDueAnchor] = useState<RecurringDueAnchor>(parseDueAnchor(initial?.dueAnchor));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [accountId, setAccount] = useState<number | null>(initial?.accountId ?? data?.catalogs.accounts[0]?.id ?? null);
  const [partyId, setParty] = useState<number | null>(initial?.partyId ?? null);
  const [addCat, setAddCat] = useState(false);
  const [addParty, setAddParty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <>
    <Modal open title={initial ? "ویرایش هزینه تکراری" : "هزینه تکراری"} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!currencyId) {
            setError("ارز را انتخاب کنید");
            return;
          }
          setBusy(true);
          setError("");
          try {
            await saveRecurringExpense({
              data: {
                id: initial?.id,
                title,
                amount: parseAmount(amount),
                currencyId,
                categoryId,
                startOn: startOn || todayIso(),
                cadence,
                dueAnchor,
                notes,
                accountId,
                partyId,
              },
            });
            await refreshExpenses();
            onClose();
            toast.success("ثبت شد");
          } catch (err) {
            setError(err instanceof Error ? err.message : "ثبت ناکام شد");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="تشریح">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field label="مبلغ">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="ارز">
          <EntitySelect
            value={currencyId}
            options={(data?.catalogs.currencies ?? []).map((c) => ({ id: c.id, label: `${c.name} (${c.symbol})` }))}
            onChange={(id) => setCurrency(id == null ? null : Number(id))}
          />
        </Field>
        <Field label="از حساب">
          <EntitySelect
            value={accountId}
            options={(data?.catalogs.accounts ?? []).map((a) => ({ id: a.id, label: `${a.name} (${a.currencySymbol})` }))}
            onChange={(id) => setAccount(id == null ? null : Number(id))}
          />
        </Field>
        <Field label="طرف حساب">
          <EntitySelect
            value={partyId}
            options={(data?.catalogs.parties ?? []).map((p) => ({ id: p.id, label: p.name }))}
            onChange={(id) => setParty(id == null ? null : Number(id))}
            onAdd={() => setAddParty(true)}
          />
        </Field>
        <Field label="دسته‌بندی">
          <EntitySelect
            value={categoryId}
            options={recCats.map((c) => ({ id: c.id, label: c.name }))}
            onChange={(id) => setCategory(id == null ? null : Number(id))}
            onAdd={() => setAddCat(true)}
          />
        </Field>
        <Field label="تاریخ شروع">
          <DateField value={startOn} onChange={setStartOn} />
        </Field>
        <Field label="دوره تکرار">
          <EntitySelect
            value={cadence}
            options={CADENCE_OPTIONS.map((id) => ({ id, label: CADENCE_LABELS[id] }))}
            onChange={(id) => setCadence(parseCadence(String(id ?? "monthly")))}
          />
        </Field>
        <Field label="زمان هشدار موعد">
          <EntitySelect
            value={dueAnchor}
            options={(Object.keys(DUE_ANCHOR_LABELS) as RecurringDueAnchor[]).map((id) => ({
              id,
              label: DUE_ANCHOR_LABELS[id],
            }))}
            onChange={(id) => setDueAnchor(parseDueAnchor(String(id ?? "start")))}
          />
        </Field>
        <Field label="یادداشت">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy}>
          ثبت
        </Button>
      </form>
    </Modal>
    <AddNameModal
      open={addCat}
      title="افزودن دسته‌بندی"
      onClose={() => setAddCat(false)}
      onSave={async (name) => {
        const res = await saveExpenseCategory({ data: { name, kind: "recurring" } });
        await refreshExpenses();
        setCategory(res.id);
      }}
    />
    {addParty ? (
      <PartyFormModal
        kind="other"
        initial={null}
        onClose={() => setAddParty(false)}
        onSaved={(id) => {
          setParty(id);
          setAddParty(false);
        }}
      />
    ) : null}
    </>
  );
}
