import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AddNameModal } from "@/components/add-name-modal";
import { ConfirmDelete } from "@/components/confirm-delete";
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
import { deleteWageRate, listWageRates, saveJobType, saveWageRate } from "@/lib/api/setup";
import { emptyNum, formatMoney, parseAmount, todayIso } from "@/lib/format";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import type { WageRate } from "@/lib/types";
import { cn } from "@/lib/utils";


export function Page() {
  const { data } = useAppData();
  if (data?.settings.productionEnabled === false) {
    return <p className="text-sm text-muted">بخش تولیدی غیرفعال است.</p>;
  }
  return (
    <Guard area="wages">
      <Wages />
    </Guard>
  );
}

function Wages() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "wages");
  const list = useQuery({ queryKey: ["wages"], queryFn: () => listWageRates() });
  const [edit, setEdit] = useState<WageRate[] | "new" | null>(null);
  const [del, setDel] = useState<WageRate[] | null>(null);
  const [openModel, setOpenModel] = useState<string | null>(null);
  const rates = uniqueWageRates(list.data ?? []);
  const groups = useMemo(() => {
    const map = new Map<string, WageRate[]>();
    for (const row of rates) {
      const key = row.productModel.trim() || "—";
      const bucket = map.get(key) ?? [];
      bucket.push(row);
      map.set(key, bucket);
    }
    return [...map.entries()]
      .map(([productModel, rows]) => ({
        productModel,
        rows: rows.sort((a, b) => a.jobTypeName.localeCompare(b.jobTypeName, "fa")),
        total: rows.reduce((sum, row) => sum + row.wagePerUnit, 0),
      }))
      .sort((a, b) => a.productModel.localeCompare(b.productModel, "fa"));
  }, [rates]);

  return (
    <div>
      <PageHeader title="نرخ دستمزد" canAdd={writable} onAdd={() => setEdit("new")} />
      {groups.length ? (
        <div className="dash-card list-card overflow-hidden">
          <div className="list-head grid grid-cols-[2rem_repeat(4,minmax(0,1fr))_4.75rem] items-center gap-3 px-3 text-center text-sm font-bold">
            <span />
            <span>نوع کالا</span>
            <span>نرخ دستمزد</span>
            <span>تاریخ ثبت</span>
            <span>یادداشت</span>
            <span />
          </div>
          {groups.map((group) => {
            const latest = [...group.rows].sort(
              (a, b) => (a.registeredAt === b.registeredAt ? b.id - a.id : b.registeredAt.localeCompare(a.registeredAt)),
            )[0];
            const open = openModel === group.productModel;
            return (
              <div key={group.productModel} className="border-t border-border">
                <div
                  className="grid cursor-pointer grid-cols-[2rem_repeat(4,minmax(0,1fr))_4.75rem] items-center gap-3 px-3 py-2 text-center"
                  onClick={() => setOpenModel(open ? null : group.productModel)}
                >
                  <span className="flex justify-center">
                    <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} />
                  </span>
                  <span className="min-w-0 truncate font-medium">{group.productModel}</span>
                  <span className="tabular-nums">{formatMoney(group.total)} ؋</span>
                  <span>
                    <DateText iso={latest?.registeredAt ?? ""} />
                  </span>
                  <span className="min-w-0 truncate">{latest?.notes || "—"}</span>
                  <span className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    <RowActions canWrite={writable} onEdit={() => setEdit(group.rows)} onDelete={() => setDel(group.rows)} />
                  </span>
                </div>
                {open ? (
                  <ul className="border-t border-border bg-surface-2/40 py-1 text-sm">
                    {group.rows.map((row) => (
                      <li
                        key={row.id}
                        className="grid grid-cols-[2rem_repeat(4,minmax(0,1fr))_4.75rem] items-center gap-3 px-3 py-1.5 text-center"
                      >
                        <span />
                        <span className="min-w-0 truncate">{row.jobTypeName}</span>
                        <span className="tabular-nums">{formatMoney(row.wagePerUnit)} ؋</span>
                        <span>
                          <DateText iso={row.registeredAt} />
                        </span>
                        <span className="min-w-0 truncate">{row.notes || "—"}</span>
                        <span className="flex justify-center">
                          <RowActions canWrite={writable} onEdit={() => setEdit(group.rows)} onDelete={() => setDel([row])} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="px-3 py-10 text-center text-sm text-muted">نرخ دستمزدی ثبت نشده است</p>
      )}
      {edit ? (
        <WageModal initialRows={edit === "new" ? null : edit} rates={rates} onClose={() => setEdit(null)} />
      ) : null}
      <ConfirmDelete
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del?.length) return;
          for (const row of del) await deleteWageRate({ data: { id: row.id } });
          await queryClient.invalidateQueries({ queryKey: ["wages"] });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
    </div>
  );
}

function uniqueWageRates(rows: WageRate[]): WageRate[] {
  const map = new Map<string, WageRate>();
  for (const row of rows) {
    const key = `${row.jobTypeId}::${row.productModel.trim()}`;
    const prev = map.get(key);
    if (!prev || row.id > prev.id) map.set(key, row);
  }
  return [...map.values()];
}

export function WageModal({
  initialRows,
  rates,
  onClose,
}: {
  initialRows: WageRate[] | null;
  rates: WageRate[];
  onClose: () => void;
}) {
  const { data } = useAppData();
  const products = (data?.catalogs.items ?? []).filter((i) => i.kind === "product");
  const jobs = data?.catalogs.jobTypes ?? [];
  const seed = initialRows ?? [];
  const latest = [...seed].sort((a, b) =>
    a.registeredAt === b.registeredAt ? b.id - a.id : b.registeredAt.localeCompare(a.registeredAt),
  )[0];
  const [addJob, setAddJob] = useState<string | null>(null);
  const [productId, setProductId] = useState<number | null>(
    products.find((p) => p.name === seed[0]?.productModel)?.id ?? null,
  );
  const [lines, setLines] = useState<{ key: string; id?: number; jobTypeId: number | null; wage: string }[]>(
    seed.length
      ? seed.map((row) => ({
          key: String(row.id),
          id: row.id,
          jobTypeId: row.jobTypeId,
          wage: emptyNum(row.wagePerUnit),
        }))
      : [
          {
            key: "1",
            jobTypeId: jobs[0]?.id ?? null,
            wage: "",
          },
        ],
  );
  const [date, setDate] = useState(latest?.registeredAt || todayIso());
  const [notes, setNotes] = useState(latest?.notes ?? "");
  const [error, setError] = useState("");

  function patchLine(key: string, next: Partial<(typeof lines)[number]>) {
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...next } : r)));
  }

  return (
    <>
      <Modal open title={seed.length ? "ویرایش نرخ دستمزد" : "افزودن نرخ دستمزد"} onClose={onClose}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!productId) {
              setError("مدل کالا را انتخاب کنید");
              return;
            }
            if (!lines.length) {
              setError("حداقل یک ردیف لازم است");
              return;
            }
            const productModel = products.find((p) => p.id === productId)?.name ?? "";
            const seen = new Set<number>();
            for (const line of lines) {
              if (!line.jobTypeId) {
                setError("نوع وظیفه لازم است");
                return;
              }
              if (seen.has(line.jobTypeId)) {
                setError("این مدل کالا با این نوع وظیفه تکرار شده است");
                toast.error("این مدل کالا با این نوع وظیفه تکرار شده است");
                return;
              }
              seen.add(line.jobTypeId);
              const dup = rates.some(
                (r) =>
                  r.jobTypeId === line.jobTypeId &&
                  r.productModel.trim() === productModel.trim() &&
                  r.id !== line.id,
              );
              if (dup) {
                setError("این مدل کالا با این نوع وظیفه قبلاً ثبت شده است");
                toast.error("این مدل کالا با این نوع وظیفه قبلاً ثبت شده است");
                return;
              }
            }
            if (seed.length) {
              for (const row of seed) {
                if (!lines.some((line) => line.id === row.id)) await deleteWageRate({ data: { id: row.id } });
              }
            }
            for (const line of lines) {
              await saveWageRate({
                data: {
                  id: line.id,
                  jobTypeId: line.jobTypeId!,
                  productModel,
                  wagePerUnit: parseAmount(line.wage),
                  registeredAt: date,
                  notes,
                },
              });
            }
            await queryClient.invalidateQueries({ queryKey: ["wages"] });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            onClose();
            toast.success("ثبت شد");
          }}
        >
          <Field label="مدل کالا">
            <EntitySelect
              value={productId}
              placeholder=""
              options={products.map((p) => ({ id: p.id, label: p.name }))}
              onChange={(id) => setProductId(id == null ? null : Number(id))}
            />
          </Field>
          {lines.map((line) => (
            <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
              <Field label="نوع وظیفه">
                <EntitySelect
                  value={line.jobTypeId}
                  options={jobs.map((j) => ({ id: j.id, label: j.name }))}
                  onChange={(id) => patchLine(line.key, { jobTypeId: id == null ? null : Number(id) })}
                  onAdd={() => setAddJob(line.key)}
                />
              </Field>
              <Field label="دستمزد فی عدد">
                <MoneyInput value={line.wage} onChange={(wage) => patchLine(line.key, { wage })} />
              </Field>
              <button
                type="button"
                className="mb-0.5 grid size-10 place-items-center rounded-md border border-border text-danger"
                aria-label="حذف ردیف"
                onClick={() => setLines((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== line.key) : rows))}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <div className="flex">
            <button
              type="button"
              className="add-box ms-auto"
              aria-label="افزودن ردیف"
              onClick={() =>
                setLines((rows) => {
                  const prevId = rows[rows.length - 1]?.jobTypeId ?? null;
                  const prevIndex = jobs.findIndex((j) => j.id === prevId);
                  const next = jobs[prevIndex + 1] ?? jobs[0];
                  return [...rows, { key: String(Date.now()), jobTypeId: next?.id ?? null, wage: "" }];
                })
              }
            >
              <Plus className="size-4" />
            </button>
          </div>
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
      <AddNameModal
        open={addJob != null}
        title="افزودن نوع وظیفه"
        onClose={() => setAddJob(null)}
        onSave={async (name) => {
          const res = await saveJobType({ data: { name } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          if (addJob) patchLine(addJob, { jobTypeId: res.id });
        }}
      />
    </>
  );
}
