import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { DataTable } from "@/components/data-table";
import { Guard } from "@/components/guard";
import { RowActions } from "@/components/icon-btn";
import { useAppData } from "@/components/layout/app-shell";
import { MoneyInput } from "@/components/money-input";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { deleteCurrency, saveCurrency } from "@/lib/api/setup";
import { formatDecimal, parseAmount } from "@/lib/format";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import type { Currency } from "@/lib/types";

export const Route = createFileRoute("/_app/setup/currencies")({ component: Page });

function Page() {
  return (
    <Guard area="currencies">
      <Currencies />
    </Guard>
  );
}

function Currencies() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "currencies");
  const rows = data?.catalogs.currencies ?? [];
  const [edit, setEdit] = useState<Partial<Currency> | "new" | null>(null);
  const [del, setDel] = useState<Currency | null>(null);
  const [form, setForm] = useState({ name: "", symbol: "", rate: "1" });

  function open(row: Currency | "new") {
    setEdit(row);
    if (row === "new") setForm({ name: "", symbol: "", rate: "" });
    else setForm({ name: row.name, symbol: row.symbol, rate: String(row.rateToBase) });
  }

  return (
    <div>
      <PageHeader title="ارزها" canAdd={writable} onAdd={() => open("new")} />
      <p className="mb-3 text-sm text-muted">نرخ به ارز پایه (افغانی) — بدون محدودیت اعشار</p>
      <DataTable
        tone="c"
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { header: "نام", cell: (r) => r.name },
          { header: "نماد", cell: (r) => r.symbol },
          { header: "نرخ به افغانی", cell: (r) => <span className="tabular-nums">{formatDecimal(r.rateToBase)}</span> },
          {
            header: "",
              cell: (r) => (
              <RowActions canWrite={writable} onEdit={() => open(r)} onDelete={() => setDel(r)} />
            ),
          },
        ]}
      />
      <Modal open={Boolean(edit)} title={edit === "new" ? "افزودن ارز" : "ویرایش ارز"} onClose={() => setEdit(null)}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await saveCurrency({
              data: {
                id: edit === "new" || !edit || !("id" in edit) ? undefined : edit.id,
                name: form.name,
                symbol: form.symbol,
                rateToBase: parseAmount(form.rate),
              },
            });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            setEdit(null);
            toast.success("ثبت شد");
          }}
        >
          <Field label="نام">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="نماد">
            <Input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} required />
          </Field>
          <Field label="نرخ به ارز پایه">
            <MoneyInput unlimitedDecimals value={form.rate} onChange={(rate) => setForm({ ...form, rate })} />
          </Field>
          <Button type="submit">ثبت</Button>
        </form>
      </Modal>
      <ConfirmDelete
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deleteCurrency({ data: { id: del.id } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
    </div>
  );
}
