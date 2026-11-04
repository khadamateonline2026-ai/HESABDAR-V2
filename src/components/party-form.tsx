import { useState } from "react";
import { toast } from "sonner";
import { AddNameModal } from "@/components/add-name-modal";
import { DateField } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { useAppData } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/money-input";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { saveJobType, saveParty, savePartyCategory } from "@/lib/api/setup";
import { parseAmount, todayIso, emptyNum } from "@/lib/format";
import { queryClient } from "@/lib/query-client";
import type { Party, WorkerEmployment } from "@/lib/types";
import { EMPLOYMENT_LABELS } from "@/lib/types";

export function PartyFormModal({
  kind,
  initial,
  onClose,
  onSaved,
  defaultEmployment,
  salariedOnly,
}: {
  kind: Party["kind"];
  initial: Party | null;
  onClose: () => void;
  onSaved?: (id: number) => void;
  defaultEmployment?: WorkerEmployment;
  salariedOnly?: boolean;
}) {
  const { data } = useAppData();
  const cats = (data?.catalogs.partyCategories ?? []).filter((c) => c.kind === kind);
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    phone: initial?.phone ?? "",
    categoryId: initial?.categoryId ?? null,
    notes: initial?.notes ?? "",
    jobTypeId: initial?.jobTypeId ?? null,
    startDate: initial?.startDate || todayIso(),
    address: initial?.address ?? "",
    currencyId: initial?.currencyId ?? null,
    stageId: initial?.stageId ?? null,
    employment: (salariedOnly ? "salaried" : (initial?.employment ?? defaultEmployment ?? "contract")) as WorkerEmployment,
    salary: emptyNum(initial?.salary),
  });
  const [addCat, setAddCat] = useState(false);
  const [addJob, setAddJob] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await saveParty({
        data: {
          id: initial?.id,
          kind,
          ...form,
          salary: parseAmount(form.salary),
          employment: salariedOnly ? "salaried" : form.employment,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      await queryClient.invalidateQueries({ queryKey: ["worker-ledger"] });
      onSaved?.(res.id);
      onClose();
      toast.success("ثبت شد");
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا");
    } finally {
      setBusy(false);
    }
  }

  const title =
    kind === "customer" ? "مشتری" : kind === "vendor" ? "فروشنده" : kind === "worker" ? "کارگر" : "طرف حساب";

  return (
    <>
      <Modal open title={initial ? `ویرایش ${title}` : `افزودن ${title}`} onClose={onClose}>
        <form onSubmit={submit} className="space-y-3">
          <Field label="نام">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="شماره تماس">
            <Input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          {kind === "worker" ? (
            <>
              {salariedOnly ? null : (
              <Field label="نوع همکاری">
                <EntitySelect
                  value={form.employment}
                  options={(Object.keys(EMPLOYMENT_LABELS) as WorkerEmployment[]).map((id) => ({
                    id,
                    label: EMPLOYMENT_LABELS[id],
                  }))}
                  onChange={(id) =>
                    setForm({ ...form, employment: id === "salaried" ? "salaried" : "contract" })
                  }
                />
              </Field>
              )}
              {form.employment === "salaried" ? (
                <Field label="معاش ماهوار">
                  <MoneyInput value={form.salary} onChange={(salary) => setForm({ ...form, salary })} />
                </Field>
              ) : (
                <>
              <Field label="نوع وظیفه">
                <EntitySelect
                  value={form.jobTypeId}
                  options={(data?.catalogs.jobTypes ?? []).map((j) => ({ id: j.id, label: j.name }))}
                  onChange={(id) => setForm({ ...form, jobTypeId: id == null ? null : Number(id) })}
                  onAdd={() => setAddJob(true)}
                />
              </Field>
                </>
              )}
              {salariedOnly ? (
                <Field label="دسته‌بندی">
                  <EntitySelect
                    value={form.categoryId}
                    options={cats.map((c) => ({ id: c.id, label: c.name }))}
                    onChange={(id) => setForm({ ...form, categoryId: id == null ? null : Number(id) })}
                  />
                </Field>
              ) : null}
              <Field label="تاریخ شروع کار">
                <DateField value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} />
              </Field>
            </>
          ) : (
            <Field label="دسته‌بندی">
              <EntitySelect
                value={form.categoryId}
                options={cats.map((c) => ({ id: c.id, label: c.name }))}
                onChange={(id) => setForm({ ...form, categoryId: id == null ? null : Number(id) })}
                onAdd={() => setAddCat(true)}
              />
            </Field>
          )}
          {kind === "other" ? (
            <>
              <Field label="آدرس">
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </Field>
              <Field label="ارز">
                <EntitySelect
                  value={form.currencyId}
                  options={(data?.catalogs.currencies ?? []).map((c) => ({
                    id: c.id,
                    label: `${c.name} (${c.symbol})`,
                  }))}
                  onChange={(id) => setForm({ ...form, currencyId: id == null ? null : Number(id) })}
                />
              </Field>
            </>
          ) : null}
          <Field label="یادداشت">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
          const res = await savePartyCategory({ data: { kind: kind === "worker" ? "worker" : kind, name } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          setForm((f) => ({ ...f, categoryId: res.id }));
        }}
      />
      {addJob ? (
        <AddNameModal
          open
          title="افزودن نوع وظیفه"
          onClose={() => setAddJob(false)}
          onSave={async (name) => {
            const res = await saveJobType({ data: { name } });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            setForm((f) => ({ ...f, jobTypeId: res.id }));
            setAddJob(false);
          }}
        />
      ) : null}
    </>
  );
}
