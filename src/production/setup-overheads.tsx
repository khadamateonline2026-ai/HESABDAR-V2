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
import { deleteProductionOverhead, saveProductionOverhead } from "@/lib/api/setup";
import { emptyNum, formatMoney, parseAmount } from "@/lib/format";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import type { ProductionOverheadType } from "@/lib/types";


export function Page() {
  const { data } = useAppData();
  if (data?.settings.productionEnabled === false) {
    return <p className="text-sm text-muted">بخش تولیدی غیرفعال است.</p>;
  }
  return (
    <Guard area="units">
      <Overheads />
    </Guard>
  );
}

function Overheads() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "units");
  const rows = data?.catalogs.productionOverheads ?? [];
  const [edit, setEdit] = useState<ProductionOverheadType | "new" | null>(null);
  const [del, setDel] = useState<ProductionOverheadType | null>(null);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");

  return (
    <div>
      <PageHeader
        title="هزینه‌های متفرقه تولید"
        canAdd={writable}
        onAdd={() => {
          setEdit("new");
          setTitle("");
          setAmount("");
        }}
      />
      <DataTable
        tone="c"
        rows={rows}
        rowKey={(r) => r.id}
        empty="موردی ثبت نشده است"
        columns={[
          { header: "تشریح", cell: (r) => r.title },
          {
            header: "مبلغ",
            cell: (r) => <span className="tabular-nums">{formatMoney(r.amount)}</span>,
          },
          {
            header: "",
            cell: (r) => (
              <RowActions
                canWrite={writable}
                onEdit={() => {
                  setEdit(r);
                  setTitle(r.title);
                  setAmount(emptyNum(r.amount));
                }}
                onDelete={() => setDel(r)}
              />
            ),
          },
        ]}
      />
      <Modal
        open={Boolean(edit)}
        title={edit === "new" ? "افزودن هزینه تولید" : "ویرایش هزینه تولید"}
        onClose={() => setEdit(null)}
      >
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await saveProductionOverhead({
              data: {
                id: edit === "new" || !edit ? undefined : edit.id,
                title,
                amount: parseAmount(amount),
              },
            });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            setEdit(null);
            toast.success("ثبت شد");
          }}
        >
          <Field label="تشریح">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label="مبلغ">
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Button type="submit">ثبت</Button>
        </form>
      </Modal>
      <ConfirmDelete
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deleteProductionOverhead({ data: { id: del.id } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
    </div>
  );
}