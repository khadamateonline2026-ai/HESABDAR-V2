import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
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
import { deleteTransfer, listTransfers, saveTransfer } from "@/lib/api/finance";
import { convertAmount, emptyNum, formatMoney, parseAmount, rateToBaseOf, todayIso } from "@/lib/format";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import type { Transfer } from "@/lib/types";

export const Route = createFileRoute("/_app/finance/transfers")({ component: Page });

function Page() {
  return (
    <Guard area="transfers">
      <Transfers />
    </Guard>
  );
}

function Transfers() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "transfers");
  const list = useQuery({ queryKey: ["transfers"], queryFn: () => listTransfers() });
  const [edit, setEdit] = useState<Transfer | "new" | null>(null);
  const [del, setDel] = useState<Transfer | null>(null);

  return (
    <div>
      <PageHeader title="انتقالات" canAdd={writable} onAdd={() => setEdit("new")} />
      <DataTable
        tone="c"
        rows={list.data ?? []}
        rowKey={(r) => r.id}
        excel="انتقالات"
        columns={[
          { header: "از حساب", cell: (r) => r.fromAccountName },
          { header: "به حساب", cell: (r) => r.toAccountName },
          { header: "مبلغ", cell: (r) => <span className="tabular-nums">{formatMoney(r.amount)}</span> },
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
      {edit ? <TransferModal initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} /> : null}
      <ConfirmDelete
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deleteTransfer({ data: { id: del.id } });
          await queryClient.invalidateQueries({ queryKey: ["transfers"] });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
    </div>
  );
}

function TransferModal({ initial, onClose }: { initial: Transfer | null; onClose: () => void }) {
  const { data } = useAppData();
  const acc = data?.catalogs.accounts ?? [];
  const [fromAccountId, setFrom] = useState<number | null>(initial?.fromAccountId ?? acc[0]?.id ?? null);
  const [toAccountId, setTo] = useState<number | null>(initial?.toAccountId ?? acc[1]?.id ?? acc[0]?.id ?? null);
  const [amount, setAmount] = useState(emptyNum(initial?.amount));
  const [date, setDate] = useState(initial?.occurredOn || todayIso());
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState("");
  const currencies = data?.catalogs.currencies ?? [];
  const from = acc.find((a) => a.id === fromAccountId);
  const to = acc.find((a) => a.id === toAccountId);
  const mismatch = Boolean(from && to && from.currencyId !== to.currencyId);
  const n = parseAmount(amount);
  const equiv =
    mismatch && from && to
      ? convertAmount(n, rateToBaseOf(currencies, from.currencyId), rateToBaseOf(currencies, to.currencyId))
      : 0;

  return (
    <Modal open title={initial ? "ویرایش انتقال" : "انتقال"} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!fromAccountId || !toAccountId) {
            setError("حساب‌ها را انتخاب کنید");
            return;
          }
          try {
            await saveTransfer({
              data: {
                id: initial?.id,
                fromAccountId,
                toAccountId,
                amount: parseAmount(amount),
                occurredOn: date,
                notes,
              },
            });
            await queryClient.invalidateQueries({ queryKey: ["transfers"] });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            onClose();
            toast.success("ثبت شد");
          } catch (err) {
            setError(err instanceof Error ? err.message : "خطا");
          }
        }}
      >
        <Field label="از حساب">
          <EntitySelect
            value={fromAccountId}
            options={acc.map((a) => ({ id: a.id, label: `${a.name} (${a.currencySymbol})` }))}
            onChange={(id) => setFrom(id == null ? null : Number(id))}
          />
          {from ? (
            <p className="mt-0.5 text-left text-micro leading-tight text-muted">
              موجودی{" "}
              <span className="tabular-nums" dir="ltr">
                {formatMoney(from.balance)} {from.currencySymbol}
              </span>
            </p>
          ) : null}
        </Field>
        <Field label="به حساب">
          <EntitySelect
            value={toAccountId}
            options={acc.map((a) => ({ id: a.id, label: `${a.name} (${a.currencySymbol})` }))}
            onChange={(id) => setTo(id == null ? null : Number(id))}
          />
          {to ? (
            <p className="mt-0.5 text-left text-micro leading-tight text-muted">
              موجودی{" "}
              <span className="tabular-nums" dir="ltr">
                {formatMoney(to.balance)} {to.currencySymbol}
              </span>
            </p>
          ) : null}
        </Field>
        <Field label="مبلغ">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        {mismatch && from && to ? (
          <p className="rounded-sm border border-danger/50 bg-danger-soft px-3 py-2 text-2xs leading-relaxed text-danger">
            ارز دخل مبدأ ({from.currencySymbol}) با مقصد ({to.currencySymbol}) یکسان نیست. صفحه باز می‌ماند تا اصلاح شود.
            {n > 0 ? (
              <>
                {" "}
                معادل افزودن به مقصد:{" "}
                <span className="tabular-nums" dir="ltr">
                  {formatMoney(equiv)} {to.currencySymbol}
                </span>
              </>
            ) : null}
          </p>
        ) : null}
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
