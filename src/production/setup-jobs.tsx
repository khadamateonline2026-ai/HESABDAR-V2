import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Guard } from "@/components/guard";
import { RowActions } from "@/components/icon-btn";
import { useAppData } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { deleteJobType, saveJobType } from "@/lib/api/setup";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import type { Named } from "@/lib/types";


export function Page() {
  const { data } = useAppData();
  if (data?.settings.productionEnabled === false) {
    return <p className="text-sm text-muted">بخش تولیدی غیرفعال است.</p>;
  }
  return (
    <Guard area="jobs">
      <Jobs />
    </Guard>
  );
}

function Jobs() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "jobs");
  const rows = data?.catalogs.jobTypes ?? [];
  const [edit, setEdit] = useState<Named | "new" | null>(null);
  const [del, setDel] = useState<Named | null>(null);
  const [name, setName] = useState("");

  function open(row: Named | "new") {
    setEdit(row);
    setName(row === "new" ? "" : row.name);
  }

  return (
    <div>
      <PageHeader title="وظایف" canAdd={writable} onAdd={() => open("new")} />
      <div className="dash-card list-card overflow-hidden">
        <div className="list-head flex items-center gap-2 border-b border-border px-3">
          <span className="min-w-0 flex-1 text-right text-sm font-bold">نوع وظیفه</span>
          <span className="w-[4.5rem] shrink-0" />
        </div>
        {rows.length ? (
          <ul className="list-rows">
            {rows.map((r) => (
              <li key={r.id} className="list-row flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
                <span className="min-w-0 flex-1 text-right text-sm font-medium">{r.name}</span>
                <RowActions canWrite={writable} onEdit={() => open(r)} onDelete={() => setDel(r)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-10 text-center text-sm text-muted">موردی ثبت نشده است</p>
        )}
      </div>
      <Modal open={Boolean(edit)} title={edit === "new" ? "افزودن وظیفه" : "ویرایش وظیفه"} onClose={() => setEdit(null)}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await saveJobType({ data: { id: edit === "new" || !edit ? undefined : edit.id, name } });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            setEdit(null);
            toast.success("ثبت شد");
          }}
        >
          <Field label="نوع وظیفه">
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
          await deleteJobType({ data: { id: del.id } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
    </div>
  );
}