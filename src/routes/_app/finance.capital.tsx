import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { CurrencyMatchNote } from "@/components/currency-match";
import { DataTable } from "@/components/data-table";
import { DateField, DateText } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { Guard } from "@/components/guard";
import { RowActions } from "@/components/icon-btn";
import { useAppData } from "@/components/layout/app-shell";
import { MoneyInput } from "@/components/money-input";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { deleteCapital, listCapital, saveCapital } from "@/lib/api/finance";
import { emptyNum, formatMoneySymbol, parseAmount, todayIso } from "@/lib/format";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import type { CapitalMove } from "@/lib/types";

export const Route = createFileRoute("/_app/finance/capital")({ component: Page });

function Page() {
  return (
    <Guard area="capital">
      <Capital />
    </Guard>
  );
}

function Capital() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "capital");
  const list = useQuery({ queryKey: ["capital"], queryFn: () => listCapital() });
  const [edit, setEdit] = useState<CapitalMove | "new" | null>(null);
  const [del, setDel] = useState<CapitalMove | null>(null);

  return (
    <div>
      <PageHeader title="سرمایه و برداشت" canAdd={writable} onAdd={() => setEdit("new")} />
      <DataTable
        tone="c"
        rows={list.data ?? []}
        rowKey={(r) => r.id}
        excel="سرمایه و برداشت"
        columns={[
          { header: "نوع", cell: (r) => (r.kind === "add" ? "افزودن سرمایه" : "برداشت سرمایه") },
          { header: "حساب", cell: (r) => r.accountName },
          {
            header: "مبلغ",
            cell: (r) => <span className="tabular-nums">{formatMoneySymbol(r.amount, r.currencySymbol)}</span>,
          },
          {
            header: "تاریخ",
            cell: (r) => <DateText iso={r.occurredOn} />,
          },
          { header: "یادداشت", cell: (r) => r.notes || "—" },
          {
            header: "",
              cell: (r) => (
              <RowActions canWrite={writable} onEdit={() => setEdit(r)} onDelete={() => setDel(r)} />
            ),
          },
        ]}
      />
      {edit ? <CapModal initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} /> : null}
      <ConfirmDelete
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deleteCapital({ data: { id: del.id } });
          await queryClient.invalidateQueries({ queryKey: ["capital"] });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
    </div>
  );
}

function CapModal({ initial, onClose }: { initial: CapitalMove | null; onClose: () => void }) {
  const { data } = useAppData();
  const acc = data?.catalogs.accounts ?? [];
  const [kind, setKind] = useState<"add" | "withdraw">(initial?.kind ?? "add");
  const [accountId, setAccount] = useState<number | null>(initial?.accountId ?? acc[0]?.id ?? null);
  const selected = acc.find((a) => a.id === accountId);
  const [currencyId, setCurrency] = useState<number | null>(initial?.currencyId ?? selected?.currencyId ?? data?.catalogs.currencies[0]?.id ?? null);
  const [amount, setAmount] = useState(emptyNum(initial?.amount));
  const [date, setDate] = useState(initial?.occurredOn || todayIso());
  const [notes, setNotes] = useState(initial?.notes ?? "");

  return (
    <Modal open title={initial ? "ویرایش" : "سرمایه و برداشت"} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!accountId || !currencyId) return;
          await saveCapital({
            data: {
              id: initial?.id,
              kind,
              accountId,
              currencyId,
              amount: parseAmount(amount),
              occurredOn: date,
              notes,
            },
          });
          await queryClient.invalidateQueries({ queryKey: ["capital"] });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          onClose();
          toast.success("ثبت شد");
        }}
      >
        <Field label="نوع">
          <EntitySelect
            value={kind}
            options={[
              { id: "add", label: "افزودن سرمایه" },
              { id: "withdraw", label: "برداشت سرمایه" },
            ]}
            onChange={(id) => setKind((id as "add" | "withdraw") || "add")}
          />
        </Field>
        <Field label="حساب">
          <EntitySelect
            value={accountId}
            options={acc.map((a) => ({ id: a.id, label: `${a.name} (${a.currencySymbol})` }))}
            onChange={(id) => {
              const n = id == null ? null : Number(id);
              setAccount(n);
            }}
          />
        </Field>
        <Field label="ارز">
          <EntitySelect
            value={currencyId}
            options={(data?.catalogs.currencies ?? []).map((c) => ({ id: c.id, label: `${c.name} (${c.symbol})` }))}
            onChange={(id) => setCurrency(id == null ? null : Number(id))}
          />
        </Field>
        <CurrencyMatchNote
          accounts={acc}
          currencies={data?.catalogs.currencies ?? []}
          accountId={accountId}
          currencyId={currencyId}
          amount={amount}
          verb={kind === "add" ? "افزودن" : "کسر"}
        />
        <Field label="مبلغ">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="تاریخ">
          <DateField value={date} onChange={setDate} />
        </Field>
        <Field label="یادداشت">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Button type="submit">ثبت</Button>
      </form>
    </Modal>
  );
}
