import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pencil, Plus, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AddNameModal } from "@/components/add-name-modal";
import { ConfirmDelete } from "@/components/confirm-delete";
import { DataTable } from "@/components/data-table";
import { DateField, DateText } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { FilterTable } from "@/components/filter-table";
import { Guard } from "@/components/guard";
import { IconBtn, RowActions } from "@/components/icon-btn";
import { AfAmount, SectionTabs } from "@/components/invoice-ui";
import { useAppData } from "@/components/layout/app-shell";
import { MoneyInput, amountNumber } from "@/components/money-input";
import { PageHeader } from "@/components/page-header";
import { PartyFormModal } from "@/components/party-form";
import { ReportSheet } from "@/components/report-tools";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { DeliveryForm, WorkOrderForm } from "@/components/warehouse-ui";
import { getInventory, listWorkOrders, deleteWorkOrder } from "@/lib/api/inventory";
import { deleteParty, deletePartyCategory, savePartyCategory } from "@/lib/api/setup";
import { getWorkerLedger, deleteWorkerDelivery, deleteWorkerPayment, listWeekDeliveries, resetWorkerAccounts, saveWorkerPayment, updateWorkerDelivery } from "@/lib/api/workers";
import { listRecurringDues } from "@/lib/api/ops";
import { defaultWeekCode, listWeekSlots, weekStartSaturday } from "@/lib/delivery-weeks";
import { emptyNum, formatMoney, todayIso } from "@/lib/format";
import { formatJalaliDisplay, formatPreferredDate } from "@/lib/jalali";
import { canWrite } from "@/lib/permissions";
import { useCalendarMode } from "@/lib/prefs";
import { queryClient } from "@/lib/query-client";
import { type Party, type PartyCategory, type RecurringDue, type WorkerDeliveryLine, type WorkerLedger, type WorkerPayment, type WorkOrder } from "@/lib/types";

export const Route = createFileRoute("/_app/workers")({ component: Page });

type Tab = "list" | "orders" | "week" | "invoice";

function Page() {
  return (
    <Guard area="workers">
      <WorkersPage />
    </Guard>
  );
}

async function refreshWorkers() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["worker-ledger"] }),
    queryClient.invalidateQueries({ queryKey: ["bootstrap"] }),
    queryClient.invalidateQueries({ queryKey: ["work-orders"] }),
    queryClient.invalidateQueries({ queryKey: ["week-deliveries"] }),
    queryClient.invalidateQueries({ queryKey: ["inventory"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["recurring-dues"] }),
    queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  ]);
}

function WorkersPage() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "workers");
  const production = data?.settings.productionEnabled !== false;
  const ledger = useQuery({ queryKey: ["worker-ledger"], queryFn: () => getWorkerLedger() });
  const inv = useQuery({ queryKey: ["inventory"], queryFn: () => getInventory() });
  const orders = useQuery({ queryKey: ["work-orders"], queryFn: () => listWorkOrders() });
  const weekDeliveries = useQuery({ queryKey: ["week-deliveries"], queryFn: () => listWeekDeliveries() });
  const dues = useQuery({ queryKey: ["recurring-dues"], queryFn: () => listRecurringDues() });
  const [tab, setTab] = useState<Tab>("orders");
  const [listKind, setListKind] = useState<"contract" | "salaried">("contract");
  const [workerModal, setWorkerModal] = useState<Party | "new" | null>(null);
  const [delWorker, setDelWorker] = useState<Party | null>(null);
  const [pay, setPay] = useState<{ workerId: number; row: WorkerPayment | null } | null>(null);
  const [editDelivery, setEditDelivery] = useState<WorkerDeliveryLine | null>(null);
  const [delDelivery, setDelDelivery] = useState<WorkerDeliveryLine | null>(null);
  const [delPay, setDelPay] = useState<WorkerPayment | null>(null);
  const [workForm, setWorkForm] = useState<WorkOrder | "new" | null>(null);
  const [deliver, setDeliver] = useState<WorkOrder | null>(null);
  const [delOrder, setDelOrder] = useState<WorkOrder | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [catId, setCatId] = useState<number | null>(null);
  const [catModal, setCatModal] = useState<PartyCategory | "new" | null>(null);
  const [delCat, setDelCat] = useState<PartyCategory | null>(null);
  const workerCats = (data?.catalogs.partyCategories ?? []).filter((c) => c.kind === "worker");

  const openOrders = (orders.data ?? []).filter((o) => o.remaining > 1e-9);
  const stock = inv.data;

  useEffect(() => {
    if (!production) {
      setTab("list");
      setListKind("salaried");
    }
  }, [production]);

  useEffect(() => {
    if (production) return;
    if (!workerCats.length) {
      if (catId != null) setCatId(null);
      return;
    }
    if (!workerCats.some((c) => c.id === catId)) setCatId(workerCats[0].id);
  }, [production, workerCats, catId]);

  return (
    <div>
      <PageHeader
        title="کارگران"
        titleClass="text-2xl font-bold"
        canAdd={writable && tab !== "week" && tab !== "invoice"}
        onAdd={() =>
          tab === "orders"
            ? setWorkForm("new")
            : setWorkerModal("new")
        }
      />
      <SectionTabs
        fill={production}
        labelClass="h-12 text-base font-bold sm:text-lg"
        value={tab}
        onChange={setTab}
        tabs={[
          ...(production
            ? [
                { id: "orders" as const, label: "سفارش تولید", color: "a" as const },
                { id: "week" as const, label: "تحویلی این هفته", color: "d" as const },
                { id: "invoice" as const, label: "فاکتور", color: "c" as const },
              ]
            : []),
          { id: "list" as const, label: "لیست کارگران", color: "b" as const },
        ]}
      />

      {tab === "orders" ? (
        <div>
          <OpenOrdersTable
            rows={openOrders}
            writable={writable}
            onEdit={(r) => setWorkForm(r)}
            onDelete={setDelOrder}
            onDeliver={setDeliver}
          />
        </div>
      ) : tab === "week" ? (
        <div>
          <WeekDeliveries rows={weekDeliveries.data ?? []} pending={weekDeliveries.isPending} />
        </div>
      ) : tab === "invoice" ? (
        <WorkerWeekInvoice ledgers={ledger.data ?? []} pending={ledger.isPending} />
      ) : tab === "list" ? (
        <div className="dash-card list-card">
          <div className="border-b border-border px-2 py-2">
            {production ? (
            <div className="flex items-center justify-between gap-1.5">
            <div className="flex min-w-0 flex-1 flex-nowrap gap-1.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setListKind("contract")}
              className={
                listKind === "contract"
                  ? "company-chip chip-on h-12 shrink-0 rounded-md border border-white/70 px-3 text-base font-bold"
                  : "company-chip h-12 shrink-0 rounded-md border border-white/25 px-3 text-base font-bold"
              }
            >
              کارگران کانتراتی
            </button>
            <button
              type="button"
              onClick={() => setListKind("salaried")}
              className={
                listKind === "salaried"
                  ? "company-chip chip-on h-12 shrink-0 rounded-md border border-white/70 px-3 text-base font-bold"
                  : "company-chip h-12 shrink-0 rounded-md border border-white/25 px-3 text-base font-bold"
              }
            >
              کارگران ثابت
            </button>
            </div>
            {writable ? (
              <button
                type="button"
                onClick={() => setResetOpen(true)}
                className="h-10 shrink-0 rounded-md border border-danger/40 bg-danger-soft px-3 text-2xs font-medium text-danger"
              >
                ریست
              </button>
            ) : null}
            </div>
            ) : (
            <>
            <div className="flex w-full gap-1.5">
              {workerCats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCatId(c.id)}
                  className={
                    catId === c.id
                      ? "company-chip chip-on h-12 min-w-0 flex-1 truncate rounded-md border border-white/70 px-2 text-base font-bold"
                      : "company-chip h-12 min-w-0 flex-1 truncate rounded-md border border-white/25 px-2 text-base font-bold"
                  }
                >
                  {c.name}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between">
              {writable ? (
                <button
                  type="button"
                  onClick={() => setResetOpen(true)}
                  className="h-10 shrink-0 rounded-md border border-danger/40 bg-danger-soft px-3 text-2xs font-medium text-danger"
                >
                  ریست
                </button>
              ) : (
                <span />
              )}
              {writable ? (
                <div className="flex items-center gap-0.5" dir="ltr">
                  <button
                    type="button"
                    onClick={() => setCatModal("new")}
                    className="grid size-8 place-items-center rounded-md border border-dashed border-border-strong text-primary hover:bg-primary-soft"
                    aria-label="افزودن دسته‌بندی"
                  >
                    <Plus className="size-3.5" />
                  </button>
                  {catId != null ? (
                    <button
                      type="button"
                      onClick={() => {
                        const row = workerCats.find((c) => c.id === catId);
                        if (row) setCatModal(row);
                      }}
                      className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
                      aria-label="ویرایش دسته‌بندی"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  ) : null}
                  {catId != null ? (
                    <button
                      type="button"
                      onClick={() => {
                        const row = workerCats.find((c) => c.id === catId);
                        if (row) setDelCat(row);
                      }}
                      className="grid size-8 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger"
                      aria-label="حذف دسته‌بندی"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            </>
            )}
          </div>
          {ledger.isPending ? (
            <div className="h-40 animate-pulse rounded-md bg-border/60" />
          ) : (
            (() => {
              const rows = (ledger.data ?? []).filter((r) => {
                if (listKind === "salaried" ? r.worker.employment !== "salaried" : r.worker.employment === "salaried") {
                  return false;
                }
                if (!production && catId != null) return r.worker.categoryId === catId;
                return true;
              });
              if (!rows.length) {
                return (
                  <p className="px-3 py-3 text-sm text-muted">
                    {listKind === "salaried" ? "کارگر ثابتی ثبت نشده است" : "کارگر کانتراتی ثبت نشده است"}
                  </p>
                );
              }
              return (
                <div className="list-rows">
                  {rows.map((row) =>
                    listKind === "salaried" ? (
                      <SalariedCard
                        key={row.worker.id}
                        row={row}
                        dues={(dues.data ?? []).filter((d) => d.workerId === row.worker.id)}
                        open={openId === row.worker.id}
                        writable={writable}
                        onToggle={() => setOpenId((id) => (id === row.worker.id ? null : row.worker.id))}
                        onEdit={() => setWorkerModal(row.worker)}
                        onDelete={() => setDelWorker(row.worker)}
                        onPay={() => setPay({ workerId: row.worker.id, row: null })}
                        onEditPay={(p) => setPay({ workerId: row.worker.id, row: p })}
                      />
                    ) : (
                      <WorkerCard
                        key={row.worker.id}
                        row={row}
                        open={openId === row.worker.id}
                        writable={writable}
                        onToggle={() => setOpenId((id) => (id === row.worker.id ? null : row.worker.id))}
                        onEdit={() => setWorkerModal(row.worker)}
                        onDelete={() => setDelWorker(row.worker)}
                        onPay={() => setPay({ workerId: row.worker.id, row: null })}
                        onEditPay={(p) => setPay({ workerId: row.worker.id, row: p })}
                        onDeletePay={setDelPay}
                        onEditDelivery={setEditDelivery}
                        onDeleteDelivery={setDelDelivery}
                      />
                    ),
                  )}
                </div>
              );
            })()
          )}
        </div>
      ) : null}

      {workerModal ? (
        <PartyFormModal
          kind="worker"
          initial={workerModal === "new" ? null : workerModal}
          defaultEmployment={production ? listKind : "salaried"}
          salariedOnly={!production}
          onClose={() => setWorkerModal(null)}
        />
      ) : null}
      <ConfirmDelete
        open={Boolean(delWorker)}
        onClose={() => setDelWorker(null)}
        onConfirm={async () => {
          if (!delWorker) return;
          await deleteParty({ data: { id: delWorker.id, kind: delWorker.kind } });
          await refreshWorkers();
          toast.success("حذف شد");
        }}
      />
      <ConfirmDelete
        open={Boolean(delCat)}
        onClose={() => setDelCat(null)}
        onConfirm={async () => {
          if (!delCat) return;
          await deletePartyCategory({ data: { id: delCat.id } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          toast.success("حذف شد");
        }}
      />
      <AddNameModal
        open={catModal != null}
        title={catModal === "new" ? "افزودن دسته‌بندی" : "ویرایش دسته‌بندی"}
        initial={catModal && catModal !== "new" ? catModal.name : ""}
        onClose={() => setCatModal(null)}
        onSave={async (name) => {
          if (!name) return;
          await savePartyCategory({
            data: {
              id: catModal && catModal !== "new" ? catModal.id : undefined,
              kind: "worker",
              name,
            },
          });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          toast.success("ثبت شد");
        }}
      />
      {pay ? (
        <PayModal
          workerId={pay.workerId}
          initial={pay.row}
          onClose={() => setPay(null)}
        />
      ) : null}
      {editDelivery ? (
        <DeliveryEditModal line={editDelivery} onClose={() => setEditDelivery(null)} />
      ) : null}
      <ConfirmDelete
        open={Boolean(delDelivery)}
        title="حذف ردیف تحویل"
        message="این تحویل از همه مراحل همین سفارش کم می‌شود و موجودی گدام اصلاح می‌شود. برای تأیید، کد یک‌رقمی را وارد کنید."
        onClose={() => setDelDelivery(null)}
        onConfirm={async () => {
          if (!delDelivery) return;
          await deleteWorkerDelivery({ data: { id: delDelivery.id } });
          await refreshWorkers();
          toast.success("حذف شد");
        }}
      />
      <ConfirmDelete
        open={Boolean(delPay)}
        title="حذف پرداختی"
        message="این پرداختی حذف می‌شود و مبلغ به همان دخل برمی‌گردد. برای تأیید، کد یک‌رقمی را وارد کنید."
        onClose={() => setDelPay(null)}
        onConfirm={async () => {
          if (!delPay) return;
          await deleteWorkerPayment({ data: { id: delPay.id } });
          await refreshWorkers();
          toast.success("حذف شد");
        }}
      />
      {workForm ? (
        <WorkOrderForm
          products={stock?.products ?? []}
          rawStock={stock?.raw ?? []}
          bomByProduct={stock?.bomByProduct ?? {}}
          initial={workForm === "new" ? null : workForm}
          onClose={() => setWorkForm(null)}
        />
      ) : null}
      {deliver && stock ? (
        <DeliveryForm
          order={deliver}
          workerStock={stock.workerRaw}
          bomByProduct={stock.bomByProduct}
          onClose={() => setDeliver(null)}
        />
      ) : null}
      <ConfirmDelete
        open={Boolean(delOrder)}
        onClose={() => setDelOrder(null)}
        onConfirm={async () => {
          if (!delOrder) return;
          await deleteWorkOrder({ data: { id: delOrder.id } });
          await refreshWorkers();
          toast.success("حذف شد");
        }}
      />
      {resetOpen ? (
        <ResetWorkersModal
          workers={(data?.catalogs.parties ?? []).filter((p) => p.kind === "worker")}
          onClose={() => setResetOpen(false)}
        />
      ) : null}
    </div>
  );
}

function WeekDeliveries({
  rows,
  pending,
}: {
  rows: {
    id: number;
    occurredOn: string;
    workerName: string;
    productName: string;
    quantity: number;
    stageName: string;
  }[];
  pending: boolean;
}) {
  const cal = useCalendarMode();
  const today = todayIso();
  const [weekOne, setWeekOne] = useState("");
  const [gear, setGear] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const saved = localStorage.getItem("hesabdar-wk1-start") || "";
    if (saved) setWeekOne(saved);
  }, []);
  const slots = listWeekSlots(today, cal, weekOne || null);
  const [weekCode, setWeekCode] = useState<string | null>(null);
  const selected = slots.find((s) => s.code === weekCode) ?? slots.find((s) => s.code === defaultWeekCode(slots, today));
  const visible = selected
    ? rows.filter((r) => r.occurredOn >= selected.start && r.occurredOn <= selected.end)
    : [];
  const spanStart = slots[0]?.start ?? "";
  const spanEnd = slots[slots.length - 1]?.end ?? "";

  return (
    <div>
      <div className="mb-2 flex items-center justify-start gap-4" dir="ltr">
        <select
          className="field-input h-10 w-auto min-w-28"
          value={selected?.code ?? ""}
          onChange={(e) => setWeekCode(e.target.value)}
          aria-label="هفته"
        >
          {slots.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          aria-label="تنظیم شروع هفته"
          onClick={() => {
            setDraft(weekOne || slots[0]?.start || today);
            setGear(true);
          }}
        >
          <Settings className="size-4" />
        </button>
        {spanStart && spanEnd ? (
          <p className="text-sm">
            ({cal === "jalali" ? formatJalaliDisplay(spanEnd) : formatPreferredDate(spanEnd, cal)})
            {" – "}
            ({cal === "jalali" ? formatJalaliDisplay(spanStart) : formatPreferredDate(spanStart, cal)})
          </p>
        ) : null}
      </div>
      <Modal open={gear} title="شروع هفته WK-1" onClose={() => setGear(false)}>
        <div className="space-y-3">
          <Field label="تاریخ شروع هفته WK-1">
            <DateField value={draft} onChange={setDraft} />
          </Field>
          <Button
            type="button"
            onClick={() => {
              const next = weekStartSaturday(draft.slice(0, 10));
              if (!next) return;
              localStorage.setItem("hesabdar-wk1-start", next);
              setWeekOne(next);
              setGear(false);
            }}
          >
            ثبت
          </Button>
        </div>
      </Modal>
      {pending ? (
        <div className="h-24 animate-pulse rounded-md bg-border/60" />
      ) : (
        <DataTable
          rows={visible}
          rowKey={(r) => r.id}
          empty="تحویلی در این هفته نیست"
          tone="d"
          columns={[
            { header: "تاریخ تحویل", cell: (r) => <DateText iso={r.occurredOn} /> },
            { header: "نام کارگر", cell: (r) => r.workerName || "—" },
            { header: "مدل کالا", cell: (r) => r.productName || "—" },
            {
              header: "تعداد تحویل‌شده",
              cell: (r) => <span className="tabular-nums">{formatMoney(r.quantity)}</span>,
            },
          ]}
        />
      )}
    </div>
  );
}

function WorkerWeekInvoice({ ledgers, pending }: { ledgers: WorkerLedger[]; pending: boolean }) {
  const cal = useCalendarMode();
  const today = todayIso();
  const [weekOne, setWeekOne] = useState("");
  const [weekCode, setWeekCode] = useState<string | null>(null);
  const [workerId, setWorkerId] = useState<number | null>(null);
  useEffect(() => {
    setWeekOne(localStorage.getItem("hesabdar-wk1-start") || "");
  }, []);
  const slots = listWeekSlots(today, cal, weekOne || null);
  const selected = slots.find((s) => s.code === weekCode) ?? slots.find((s) => s.code === defaultWeekCode(slots, today));
  const workers = ledgers.filter((l) => l.worker.employment !== "salaried");
  const row = workers.find((l) => l.worker.id === workerId) ?? workers[0] ?? null;
  const from = selected?.start ?? "";
  const to = selected?.end ?? "";
  const deliveries = (row?.deliveries ?? []).filter((d) => from && d.occurredOn >= from && d.occurredOn <= to);
  const payments = (row?.payments ?? []).filter((p) => from && p.occurredOn >= from && p.occurredOn <= to);
  const weekWage = deliveries.reduce((s, d) => s + d.wageTotal, 0);
  const weekPaid = payments.reduce((s, p) => s + p.amount, 0);
  const weekLeft = weekWage - weekPaid;
  const models = row?.models ?? [];

  return (
    <ReportSheet
      title={row ? `فاکتور ${row.worker.name} ${selected?.code ?? ""}` : "فاکتور کارگر"}
      lead={
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="هفته">
            <select
              className="field-input h-11"
              value={selected?.code ?? ""}
              onChange={(e) => setWeekCode(e.target.value)}
            >
              {slots.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="کارگر">
            <EntitySelect
              value={row?.worker.id ?? null}
              options={workers.map((l) => ({ id: l.worker.id, label: l.worker.name }))}
              onChange={(id) => setWorkerId(id == null ? null : Number(id))}
            />
          </Field>
        </div>
      }
    >
      {pending ? (
        <p className="text-sm text-muted">در حال بارگذاری</p>
      ) : !row || !selected ? (
        <p className="text-sm text-muted">کارگر کانتراتی یا هفته‌ای برای فاکتور نیست</p>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5">
            <p className="font-bold">نام: {row.worker.name}</p>
            <p className="font-bold">تاریخ: <DateText iso={today} /></p>
            <p className="font-bold">شماره فاکتور: {selected.code}</p>
          </div>
          <div className="grid grid-cols-2 items-start gap-2">
          <div className="min-w-0 space-y-2">
          <section className="overflow-hidden rounded-md border border-border">
            <h3 className="border-b border-border bg-surface-2 px-2 py-1 font-bold">تحویلی این هفته</h3>
            <table className="w-full border-collapse text-center text-2xs">
              <thead>
                <tr>
                  <th className="border-b border-border px-1.5 py-1 font-bold">مدل</th>
                  <th className="border-b border-border px-1.5 py-1 font-bold">تعداد</th>
                  <th className="border-b border-border px-1.5 py-1 font-bold">فی</th>
                  <th className="border-b border-border px-1.5 py-1 font-bold">مبلغ</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.length ? (
                  deliveries.map((d) => (
                    <tr key={d.id}>
                      <td className="border-b border-border px-1.5 py-0.5">{d.productName}</td>
                      <td className="border-b border-border px-1.5 py-0.5 tabular-nums">{formatMoney(d.quantity)}</td>
                      <td className="border-b border-border px-1.5 py-0.5">
                        <AfAmount value={d.wagePerUnit} size="sm" />
                      </td>
                      <td className="border-b border-border px-1.5 py-0.5">
                        <AfAmount value={d.wageTotal} size="sm" />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-1.5 py-1 text-muted">
                      تحویلی در این هفته نیست
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
          <section className="overflow-hidden rounded-md border border-border">
            <h3 className="border-b border-border bg-surface-2 px-2 py-1 font-bold">دریافتی این هفته</h3>
            <table className="w-full border-collapse text-center text-2xs">
              <thead>
                <tr>
                  <th className="border-b border-border px-1.5 py-1 font-bold">مبلغ</th>
                  <th className="border-b border-border px-1.5 py-1 font-bold">یادداشت</th>
                </tr>
              </thead>
              <tbody>
                {payments.length ? (
                  payments.map((p) => (
                    <tr key={p.id}>
                      <td className="border-b border-border px-1.5 py-0.5">
                        <AfAmount value={p.amount} size="sm" />
                      </td>
                      <td className="border-b border-border px-1.5 py-0.5">{p.notes || "—"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="border-b border-border px-1.5 py-1 text-muted">
                      دریافتی در این هفته نیست
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-surface-2 font-bold">
                <tr>
                  <td className="border-t border-border px-1.5 py-0.5">طلب کل هفته</td>
                  <td className="border-t border-border px-1.5 py-0.5">
                    <AfAmount value={weekWage} size="sm" />
                  </td>
                </tr>
                <tr>
                  <td className="border-t border-border px-1.5 py-0.5">دریافتی هفته</td>
                  <td className="border-t border-border px-1.5 py-0.5">
                    <AfAmount value={weekPaid} size="sm" />
                  </td>
                </tr>
                <tr>
                  <td className="border-t border-border px-1.5 py-0.5">باقی مانده هفته</td>
                  <td className="border-t border-border px-1.5 py-0.5">
                    <AfAmount value={weekLeft} size="sm" />
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
          </div>
          <div className="min-w-0">
          <section className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse text-center text-2xs">
              <thead className="bg-surface-2">
                <tr>
                  <th className="border-b border-border px-1.5 py-1 font-bold">شماره</th>
                  <th className="border-b border-border px-1.5 py-1 font-bold">مدل</th>
                  <th className="border-b border-border px-1.5 py-1 font-bold">تعداد کل سفارش</th>
                  <th className="border-b border-border px-1.5 py-1 font-bold">تعداد کل تحویلی</th>
                  <th className="border-b border-border px-1.5 py-1 font-bold">تعداد کل باقی مانده</th>
                </tr>
              </thead>
              <tbody>
                {models.length ? (
                  models.map((m, i) => (
                    <tr key={m.productId}>
                      <td className="border-b border-border px-1.5 py-0.5 tabular-nums">{i + 1}</td>
                      <td className="border-b border-border px-1.5 py-0.5">{m.productName}</td>
                      <td className="border-b border-border px-1.5 py-0.5 tabular-nums">{formatMoney(m.qtyOrdered)}</td>
                      <td className="border-b border-border px-1.5 py-0.5 tabular-nums">{formatMoney(m.qtyDelivered)}</td>
                      <td className="border-b border-border px-1.5 py-0.5 tabular-nums">
                        {formatMoney(Math.max(0, m.qtyOrdered - m.qtyDelivered))}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-1.5 py-1 text-muted">
                      سفارشی ثبت نشده است
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-surface-2 font-bold">
                <tr>
                  <td className="border-t border-border px-1.5 py-0.5" colSpan={4}>
                    کل دستمزد
                  </td>
                  <td className="border-t border-border px-1.5 py-0.5">
                    <AfAmount value={row.workTotal} size="sm" />
                  </td>
                </tr>
                <tr>
                  <td className="border-t border-border px-1.5 py-0.5" colSpan={4}>
                    کل دریافتی
                  </td>
                  <td className="border-t border-border px-1.5 py-0.5">
                    <AfAmount value={row.paidTotal} size="sm" />
                  </td>
                </tr>
                <tr>
                  <td className="border-t border-border px-1.5 py-0.5" colSpan={4}>
                    کل باقی مانده
                  </td>
                  <td className="border-t border-border px-1.5 py-0.5">
                    <AfAmount value={row.owed} size="sm" />
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
          </div>
          </div>
        </div>
      )}
    </ReportSheet>
  );
}

function OpenOrdersTable({
  rows,
  writable,
  onEdit,
  onDelete,
  onDeliver,
}: {
  rows: WorkOrder[];
  writable: boolean;
  onEdit: (row: WorkOrder) => void;
  onDelete: (row: WorkOrder) => void;
  onDeliver: (row: WorkOrder) => void;
}) {
  const cal = useCalendarMode();

  return (
    <FilterTable
      rows={rows}
      rowKey={(r) => r.id}
      empty="سفارش در حال کاری نیست"
      tone="a"
        columns={[
          {
            key: "n",
            header: "شماره",
            filterable: false,
            value: () => "",
            cell: (_r, i) => <span className="tabular-nums">{i + 1}</span>,
          },
          {
            key: "date",
            header: "تاریخ",
            value: (r) => formatPreferredDate(r.occurredOn, cal),
            cell: (r) => <DateText iso={r.occurredOn} />,
          },
          {
            key: "inv",
            header: "شماره فاکتور",
            value: (r) => r.invoiceNo,
            cell: (r) => <span className="tabular-nums">{r.invoiceNo}</span>,
          },
          {
            key: "name",
            header: "نوع مدل کالا",
            value: (r) => r.productName,
            cell: (r) => r.productName,
          },
          {
            key: "worker",
            header: "اسم کارگر",
            value: (r) => r.workerName || "—",
            cell: (r) => r.workerName || "—",
          },
          {
            key: "qty",
            header: "تعداد سفارش",
            value: (r) => formatMoney(r.quantity),
            cell: (r) => <span className="tabular-nums">{formatMoney(r.quantity)}</span>,
          },
          {
            key: "delivered",
            header: "تحویل شده",
            value: (r) => formatMoney(r.deliveredQty),
            cell: (r) => <span className="tabular-nums">{formatMoney(r.deliveredQty)}</span>,
          },
          {
            key: "remain",
            header: "باقی‌مانده",
            value: (r) => formatMoney(r.remaining),
            cell: (r) => <span className="tabular-nums">{formatMoney(r.remaining)}</span>,
          },
          {
            key: "act",
            header: "",
            filterable: false,
            className: "w-32",
            value: () => "",
            cell: (r) => (
              <div className="flex items-center justify-center gap-1">
                {writable ? <IconBtn kind="edit" onClick={() => onEdit(r)} /> : null}
                {writable ? <IconBtn kind="delete" onClick={() => onDelete(r)} /> : null}
                {writable ? (
                  <Button variant="primary" onClick={() => onDeliver(r)}>
                    ثبت تحویل
                  </Button>
                ) : null}
              </div>
            ),
          },
        ]}
        footer={(visible) => {
          const cell =
            "border-t border-border px-2 py-2 text-center align-middle leading-none whitespace-nowrap tabular-nums sm:px-2.5";
          return (
            <tr className="bg-surface-2 font-bold">
              <td className="border-t border-border px-2 py-2 text-start align-middle leading-none whitespace-nowrap sm:px-2.5">
                مجموع ({visible.length})
              </td>
              <td className={cell} />
              <td className={cell} />
              <td className={cell} />
              <td className={cell} />
              <td className={cell}>{formatMoney(visible.reduce((s, r) => s + r.quantity, 0))}</td>
              <td className={cell}>{formatMoney(visible.reduce((s, r) => s + r.deliveredQty, 0))}</td>
              <td className={cell}>{formatMoney(visible.reduce((s, r) => s + r.remaining, 0))}</td>
              <td className={cell} />
            </tr>
          );
        }}
    />
  );
}

function WorkerCard({
  row,
  open,
  writable,
  onToggle,
  onEdit,
  onDelete,
  onPay,
  onEditPay,
  onDeletePay,
  onEditDelivery,
  onDeleteDelivery,
}: {
  row: WorkerLedger;
  open: boolean;
  writable: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPay: () => void;
  onEditPay: (p: WorkerPayment) => void;
  onDeletePay: (p: WorkerPayment) => void;
  onEditDelivery: (d: WorkerDeliveryLine) => void;
  onDeleteDelivery: (d: WorkerDeliveryLine) => void;
}) {
  const w = row.worker;
  return (
    <div className="list-row border-b border-border last:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-3">
        <button type="button" onClick={onToggle} className="min-w-0 text-right">
          <div className="text-sm font-semibold">{w.name}</div>
          <div className="text-2xs text-muted">
            {w.jobTypeName || "بدون وظیفه"}
            {w.phone ? ` — ${w.phone}` : ""}
          </div>
        </button>
        <AfAmount value={row.owed} size="sm" className={row.owed > 0 ? "text-danger" : ""} />
        <RowActions canWrite={writable} onEdit={onEdit} onDelete={onDelete} onPay={onPay} />
      </div>
      {open ? (
        <div className="border-t border-border p-3">
          <ReportSheet title={`حساب ${w.name}`}>
            <h4 className="mb-2 text-sm font-medium">مدل‌های کارشده</h4>
            {row.deliveries.length ? (
              <DataTable
                rows={row.deliveries}
                rowKey={(m) => m.id}
                empty="هنوز مدلی کار نشده است"
                columns={[
                  { header: "مدل", cell: (m) => m.productName },
                  {
                    header: "تعداد",
                    cell: (m) => <span className="tabular-nums">{formatMoney(m.quantity)}</span>,
                  },
                  { header: "تاریخ", cell: (m) => <DateText iso={m.occurredOn} /> },
                  { header: "تحویل به", cell: (m) => (m.toWarehouse ? "گدام" : m.toWorkerName || "—") },
                  { header: "دستمزد فی", cell: (m) => <AfAmount value={m.wagePerUnit} size="sm" /> },
                  { header: "مجموع", cell: (m) => <AfAmount value={m.wageTotal} size="sm" /> },
                  {
                    header: "",
                    className: "w-24 no-print",
                    cell: (m) =>
                      writable ? (
                        <div className="flex items-center justify-center gap-1">
                          <IconBtn kind="edit" onClick={() => onEditDelivery(m)} />
                          <IconBtn kind="delete" onClick={() => onDeleteDelivery(m)} />
                        </div>
                      ) : null,
                  },
                ]}
              />
            ) : (
              <DataTable
                rows={row.models}
                rowKey={(m) => m.productId}
                empty="هنوز مدلی کار نشده است"
                columns={[
                  { header: "مدل", cell: (m) => m.productName },
                  {
                    header: "سفارش",
                    cell: (m) => <span className="tabular-nums">{formatMoney(m.qtyOrdered)}</span>,
                  },
                  {
                    header: "تحویل",
                    cell: (m) => <span className="tabular-nums">{formatMoney(m.qtyDelivered)}</span>,
                  },
                  {
                    header: "باقی",
                    cell: (m) => (
                      <span className="tabular-nums">{formatMoney(Math.max(0, m.qtyOrdered - m.qtyDelivered))}</span>
                    ),
                  },
                  { header: "دستمزد فی", cell: (m) => <AfAmount value={m.wagePerUnit} size="sm" /> },
                  { header: "مجموع", cell: (m) => <AfAmount value={m.wageTotal} size="sm" /> },
                ]}
              />
            )}
            <h4 className="mt-4 mb-2 text-sm font-medium">پرداختی‌ها</h4>
            <DataTable
              rows={row.payments}
              rowKey={(p) => p.id}
              empty="پرداختی ثبت نشده است"
              columns={[
                {
                  header: "تاریخ",
                  cell: (p) => <DateText iso={p.occurredOn} />,
                },
                { header: "مبلغ", cell: (p) => <AfAmount value={p.amount} size="sm" /> },
                { header: "شماره", cell: (p) => <span className="tabular-nums">{p.invoiceNo}</span> },
                { header: "دخل", cell: (p) => p.accountName || "—" },
                { header: "یادداشت", cell: (p) => p.notes || "—" },
                {
                  header: "",
                  className: "w-24 no-print",
                  cell: (p) =>
                    writable ? (
                      <div className="flex items-center justify-center gap-1">
                        <IconBtn kind="edit" onClick={() => onEditPay(p)} />
                        <IconBtn kind="delete" onClick={() => onDeletePay(p)} />
                      </div>
                    ) : null,
                },
              ]}
            />
            <dl className="mt-4 grid grid-cols-3 gap-2 rounded-sm bg-surface-2 p-3 text-center">
              <div>
                <dt className="whitespace-nowrap text-2xs text-muted">کل کار</dt>
                <dd>
                  <AfAmount value={row.workTotal} size="sm" />
                </dd>
              </div>
              <div>
                <dt className="whitespace-nowrap text-2xs text-muted">کل دریافتی</dt>
                <dd>
                  <AfAmount value={row.paidTotal} size="sm" />
                </dd>
              </div>
              <div>
                <dt className="whitespace-nowrap text-2xs text-muted">کل طلب</dt>
                <dd>
                  <AfAmount value={row.owed} size="sm" className={row.owed > 0 ? "text-danger" : ""} />
                </dd>
              </div>
            </dl>
          </ReportSheet>
        </div>
      ) : null}
    </div>
  );
}

function duesCovered(dues: RecurringDue[], paidTotal: number): RecurringDue[] {
  let rest = paidTotal;
  return [...dues]
    .sort((a, b) => (a.dueOn === b.dueOn ? a.period.localeCompare(b.period) : a.dueOn.localeCompare(b.dueOn)))
    .map((d) => {
      if (rest + 1e-9 >= d.amount) {
        rest -= d.amount;
        return { ...d, status: "paid" as const };
      }
      return { ...d, status: "unpaid" as const };
    });
}

function SalariedCard({
  row,
  dues,
  open,
  writable,
  onToggle,
  onEdit,
  onDelete,
  onPay,
  onEditPay,
}: {
  row: WorkerLedger;
  dues: RecurringDue[];
  open: boolean;
  writable: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPay: () => void;
  onEditPay: (p: WorkerPayment) => void;
}) {
  const w = row.worker;
  const covered = duesCovered(dues, row.paidTotal);
  const owed = row.owed;

  return (
    <div className="list-row border-b border-border last:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-3">
        <button type="button" onClick={onToggle} className="min-w-0 text-right">
          <div className="text-sm font-semibold">{w.name}</div>
          <div className="text-2xs text-muted">
            معاش ماهوار
            {w.phone ? ` — ${w.phone}` : ""}
          </div>
        </button>
        <AfAmount value={owed} size="sm" className={owed > 0 ? "text-danger" : ""} />
        <RowActions canWrite={writable} onEdit={onEdit} onDelete={onDelete} onPay={onPay} />
      </div>
      {open ? (
        <div className="border-t border-border p-3">
          <ReportSheet title={`معاش ${w.name}`}>
            <dl className="grid grid-cols-3 gap-2 rounded-sm bg-surface-2 p-3 text-center">
              <div>
                <dt className="whitespace-nowrap text-2xs text-muted">معاش ماهوار</dt>
                <dd>
                  <AfAmount value={w.salary} size="sm" />
                </dd>
              </div>
              <div>
                <dt className="whitespace-nowrap text-2xs text-muted">پرداخت‌شده</dt>
                <dd>
                  <AfAmount value={row.paidTotal} size="sm" />
                </dd>
              </div>
              <div>
                <dt className="whitespace-nowrap text-2xs text-muted">کل طلب</dt>
                <dd>
                  <AfAmount value={owed} size="sm" className={owed > 0 ? "text-danger" : ""} />
                </dd>
              </div>
            </dl>
            <h4 className="mt-4 mb-2 text-sm font-medium">طلبات معاش</h4>
            <DataTable
              rows={covered}
              rowKey={(d) => `${d.recurringId}-${d.period}`}
              empty="موعدی نیست"
              columns={[
                { header: "دوره", cell: (d) => d.period },
                { header: "موعد", cell: (d) => <DateText iso={d.dueOn} /> },
                { header: "مبلغ", cell: (d) => <AfAmount value={d.amount} size="sm" /> },
                { header: "وضعیت", cell: (d) => (d.status === "paid" ? "پرداخت شده" : "طلب") },
              ]}
            />
            <h4 className="mt-4 mb-2 text-sm font-medium">پرداختی‌ها</h4>
            <DataTable
              rows={row.payments}
              rowKey={(p) => p.id}
              empty="پرداختی ثبت نشده است"
              columns={[
                { header: "تاریخ", cell: (p) => <DateText iso={p.occurredOn} /> },
                { header: "مبلغ", cell: (p) => <AfAmount value={p.amount} size="sm" /> },
                { header: "شماره", cell: (p) => <span className="tabular-nums">{p.invoiceNo}</span> },
                { header: "یادداشت", cell: (p) => p.notes || "—" },
                {
                  header: "",
                  className: "w-28 no-print",
                  cell: (p) => (writable ? <IconBtn kind="edit" onClick={() => onEditPay(p)} /> : null),
                },
              ]}
            />
          </ReportSheet>
        </div>
      ) : null}
    </div>
  );
}

function DeliveryEditModal({ line, onClose }: { line: WorkerDeliveryLine; onClose: () => void }) {
  const { data } = useAppData();
  const others = (data?.catalogs.parties ?? []).filter(
    (p) => p.kind === "worker" && p.employment !== "salaried" && p.id !== line.workerId,
  );
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [occurredOn, setOccurredOn] = useState(line.occurredOn || todayIso());
  const [toWorkerId, setToWorkerId] = useState<number | null>(
    line.toWarehouse ? null : (line.toWorkerId ?? others[0]?.id ?? null),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const qty = amountNumber(quantity);

  return (
    <Modal open title={`ویرایش تحویل — ${line.productName}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (qty <= 0) throw new Error("تعداد تحویل باید بزرگ‌تر از صفر باشد");
            if (!line.toWarehouse && toWorkerId == null) throw new Error("کارگر مرحله بعد را انتخاب کنید");
            await updateWorkerDelivery({
              data: {
                id: line.id,
                quantity: qty,
                occurredOn,
                toWorkerId: line.toWarehouse ? null : toWorkerId,
              },
            });
            await refreshWorkers();
            toast.success("ثبت شد");
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "ثبت ناکام شد");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="تعداد">
          <MoneyInput value={quantity} onChange={setQuantity} />
        </Field>
        <Field label="تاریخ">
          <DateField value={occurredOn} onChange={setOccurredOn} />
        </Field>
        {line.toWarehouse ? (
          <p className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm">تحویل به گدام محصول</p>
        ) : (
          <Field label="تحویل به مرحله بعد">
            <EntitySelect
              value={toWorkerId}
              options={(() => {
                const opts = others.map((w) => ({
                  id: w.id,
                  label: w.name,
                }));
                if (line.toWorkerId != null && !opts.some((o) => o.id === line.toWorkerId)) {
                  opts.unshift({ id: line.toWorkerId, label: line.toWorkerName || "کارگر" });
                }
                return opts;
              })()}
              onChange={(id) => setToWorkerId(id == null ? null : Number(id))}
            />
          </Field>
        )}
        {error ? <p className="whitespace-pre-line text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy}>
          ثبت
        </Button>
      </form>
    </Modal>
  );
}

function PayModal({
  workerId,
  initial,
  onClose,
}: {
  workerId: number;
  initial: WorkerPayment | null;
  onClose: () => void;
}) {
  const { data } = useAppData();
  const [amount, setAmount] = useState(emptyNum(initial?.amount));
  const [occurredOn, setOccurredOn] = useState(initial?.occurredOn || todayIso());
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [accountId, setAccountId] = useState<number | null>(
    initial?.accountId ?? data?.catalogs.accounts[0]?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Modal open title={initial ? `ویرایش ${initial.invoiceNo}` : "ثبت پرداختی"} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const n = amountNumber(amount);
            if (n <= 0) throw new Error("مبلغ باید بزرگ‌تر از صفر باشد");
            await saveWorkerPayment({
              data: { id: initial?.id, workerId, amount: n, occurredOn, notes, accountId },
            });
            await refreshWorkers();
            toast.success("ثبت شد");
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "خطا");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="تاریخ">
          <DateField value={occurredOn} onChange={setOccurredOn} />
        </Field>
        <Field label="مبلغ">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="از حساب">
          <EntitySelect
            value={accountId}
            options={(data?.catalogs.accounts ?? []).map((a) => ({ id: a.id, label: `${a.name} (${a.currencySymbol})` }))}
            onChange={(id) => setAccountId(id == null ? null : Number(id))}
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
  );
}

function ResetWorkersModal({ workers, onClose }: { workers: Party[]; onClose: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const contract = workers.filter((w) => w.employment !== "salaried");
  const salaried = workers.filter((w) => w.employment === "salaried");
  const options = [
    { id: "all-contract", label: "همه کارگران کانتراتی" },
    { id: "all-salaried", label: "همه کارگران ثابت" },
    ...workers.map((w) => ({
      id: String(w.id),
      label: `${w.name} (${w.employment === "salaried" ? "ثابت" : "کانتراتی"})`,
    })),
  ];

  function resolveIds(): number[] {
    if (pick === "all-contract") return contract.map((w) => w.id);
    if (pick === "all-salaried") return salaried.map((w) => w.id);
    const id = Number(pick);
    return Number.isFinite(id) && id > 0 ? [id] : [];
  }

  return (
    <Modal open title="ریست حساب کارگران" onClose={() => !busy && onClose()}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const workerIds = resolveIds();
          if (!workerIds.length) {
            setError("کارگر را انتخاب کنید");
            return;
          }
          if (!code.trim()) return;
          setBusy(true);
          setError("");
          try {
            await resetWorkerAccounts({ data: { code: code.trim(), workerIds } });
            await refreshWorkers();
            toast.success("کارکرد و دریافتی پاک شد و مبالغ به دخل برگشت");
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "عملیات ناکام شد");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm leading-relaxed text-muted">
          کارکرد و دریافتی کارگر انتخاب‌شده پاک می‌شود. اطلاعات اولیه کارگر می‌ماند و مبالغ پرداخت‌شده به دخل اصلی برمی‌گردد.
        </p>
        <Field label="کارگر">
          <EntitySelect value={pick} options={options} onChange={(id) => setPick(id == null ? null : String(id))} />
        </Field>
        <Field label="کد نقش حسابدار">
          <Input dir="ltr" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="danger" disabled={busy || !code.trim() || !pick}>
            {busy ? "…" : "ریست"}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            انصراف
          </Button>
        </div>
      </form>
    </Modal>
  );
}
