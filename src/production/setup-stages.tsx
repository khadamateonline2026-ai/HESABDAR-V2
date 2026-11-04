import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { DataTable } from "@/components/data-table";
import { Guard } from "@/components/guard";
import { RowActions } from "@/components/icon-btn";
import { useAppData } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { deleteProductionStage, saveProductionStage } from "@/lib/api/setup";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import { stageRoleLabel, type ProductionStage } from "@/lib/types";


export function Page() {
  const { data } = useAppData();
  if (data?.settings.productionEnabled === false) {
    return <p className="text-sm text-muted">بخش تولیدی غیرفعال است.</p>;
  }
  return (
    <Guard area="jobs">
      <StagesPage />
    </Guard>
  );
}

function StagesPage() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "jobs");
  const stages = data?.catalogs.productionStages ?? [];
  const [edit, setEdit] = useState<ProductionStage | "new" | null>(null);
  const [del, setDel] = useState<ProductionStage | null>(null);
  const [name, setName] = useState("");

  function open(row: ProductionStage | "new") {
    setEdit(row);
    setName(row === "new" ? "" : row.name);
  }

  return (
    <div>
      <PageHeader title="مرحله تولید" canAdd={writable} onAdd={() => open("new")} />
      <DataTable
        tone="c"
        rows={stages}
        rowKey={(r) => r.id}
        empty="مرحله تولیدی ثبت نشده است"
        columns={[
          { header: "مرحله تولید", cell: (r) => r.name },
          { header: "نقش مرحله", cell: (r) => stageRoleLabel(stages, r) },
          {
            header: "",
            cell: (r) => (
              <RowActions canWrite={writable} onEdit={() => open(r)} onDelete={() => setDel(r)} />
            ),
          },
        ]}
      />
      <Modal
        open={Boolean(edit)}
        title={edit === "new" ? "افزودن مرحله تولید" : "ویرایش مرحله تولید"}
        onClose={() => setEdit(null)}
      >
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await saveProductionStage({
              data: { id: edit === "new" || !edit ? undefined : edit.id, name },
            });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            setEdit(null);
            toast.success("ثبت شد");
          }}
        >
          <Field label="مرحله تولید">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Button type="submit">ثبت</Button>
        </form>
      </Modal>
      <ConfirmDelete
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deleteProductionStage({ data: { id: del.id } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
    </div>
  );
}
