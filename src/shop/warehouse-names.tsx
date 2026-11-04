import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { useAppData } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { deleteWarehouse, saveWarehouse, updateWarehouse } from "@/lib/api/setup";
import { queryClient } from "@/lib/query-client";
import type { Named, StockCard } from "@/lib/types";

export function shopWarehouseCards(
  cards: StockCard[],
  shopWh: string | null,
  buckets: { warehouseName: string; items: { name: string; qty: number; valueBase: number }[] }[] | undefined,
) {
  if (!shopWh) return [];
  const bucket = (buckets ?? []).find((w) => w.warehouseName === shopWh);
  const byName = new Map((bucket?.items ?? []).map((i) => [i.name, i]));
  return cards.flatMap((card) => {
    const hit = byName.get(card.name);
    if (!hit || Math.abs(hit.qty) <= 1e-9) return [];
    const qty = hit.qty;
    const valueBase = hit.valueBase;
    return [{ ...card, qty, valueBase, unitCost: qty > 1e-9 ? valueBase / qty : card.unitCost }];
  });
}

export function WarehouseNames({
  writable,
  production,
  onSelect,
}: {
  writable: boolean;
  production: boolean;
  onSelect?: (name: string | null) => void;
}) {
  const { data } = useAppData();
  const rows = (data?.catalogs.warehouses ?? []).filter((w) => {
    if (production && w.shopOnly) return false;
    if (!production && (w.name === "گدام کالای تولید شده" || w.name === "گدام مواد خام" || w.name === "مواد نزد کارگران")) {
      return false;
    }
    return true;
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [edit, setEdit] = useState<Named | "new" | null>(null);
  const [name, setName] = useState("");
  const [del, setDel] = useState<Named | null>(null);

  useEffect(() => {
    if (!rows.length) {
      if (selected != null) setSelected(null);
      return;
    }
    if (!rows.some((r) => r.id === selected)) setSelected(rows[0].id);
  }, [rows, selected]);

  function openEdit(row: Named | "new") {
    setEdit(row);
    setName(row === "new" ? "" : row.name);
  }

  const current = rows.find((r) => r.id === selected) ?? null;

  useEffect(() => {
    onSelect?.(current?.name ?? null);
  }, [current?.name, onSelect]);

  return (
    <>
      <div className="flex w-full gap-1.5">
        {rows.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelected(c.id)}
            className={
              selected === c.id
                ? "company-chip chip-on h-12 min-w-0 flex-1 truncate rounded-md border border-white/70 px-2 text-base font-bold"
                : "company-chip h-12 min-w-0 flex-1 truncate rounded-md border border-white/25 px-2 text-base font-bold"
            }
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span />
        {writable ? (
          <div className="flex items-center gap-0.5" dir="ltr">
            <button
              type="button"
              onClick={() => openEdit("new")}
              className="grid size-8 place-items-center rounded-md border border-dashed border-border-strong text-primary hover:bg-primary-soft"
              aria-label="افزودن گدام"
            >
              <Plus className="size-3.5" />
            </button>
            {current ? (
              <button
                type="button"
                onClick={() => openEdit(current)}
                className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
                aria-label="ویرایش گدام"
              >
                <Pencil className="size-3.5" />
              </button>
            ) : null}
            {current ? (
              <button
                type="button"
                onClick={() => setDel(current)}
                className="grid size-8 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger"
                aria-label="حذف گدام"
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {edit ? (
        <Modal
          open
          title={edit === "new" ? "گدام جدید" : "ویرایش گدام"}
          onClose={() => setEdit(null)}
          footer={
            <Button
              onClick={() => {
                const next = name.trim();
                if (!next) {
                  toast.error("نام گدام لازم است");
                  return;
                }
                const run =
                  edit === "new"
                    ? saveWarehouse({ data: { name: next } })
                    : updateWarehouse({ data: { id: edit.id, name: next } });
                void run
                  .then(async () => {
                    await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
                    toast.success("ثبت شد");
                    setEdit(null);
                  })
                  .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "ثبت ناکام شد"));
              }}
            >
              ثبت
            </Button>
          }
        >
          <Field label="نام گدام">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </Modal>
      ) : null}
      <ConfirmDelete
        open={Boolean(del)}
        title="حذف گدام"
        message={del ? `گدام «${del.name}» حذف شود؟ اگر در اسناد استفاده شده باشد حذف نمی‌شود.` : ""}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deleteWarehouse({ data: { id: del.id } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          toast.success("حذف شد");
        }}
      />
    </>
  );
}
