import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmAccountantReset } from "@/components/confirm-accountant";
import { ConfirmDelete } from "@/components/confirm-delete";
import { FilterTable } from "@/components/filter-table";
import { IconBtn } from "@/components/icon-btn";
import { useAppData } from "@/components/layout/app-shell";
import { DateRangeBar, ReportSheet, dateRangeError, inDateRange } from "@/components/report-tools";
import { deleteActivityLog, listActivityLog, resetActivityLog, type ActivityLogRow } from "@/lib/api/reports";
import { formatPreferredDate } from "@/lib/jalali";
import { canWrite } from "@/lib/permissions";
import { useCalendarMode } from "@/lib/prefs";
import { queryClient } from "@/lib/query-client";

export const Route = createFileRoute("/_app/reports/history")({ component: HistoryReport });

function formatWhen(iso: string, mode: ReturnType<typeof useCalendarMode>) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = formatPreferredDate(d.toISOString().slice(0, 10), mode);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${hh}:${mm}`;
}

function HistoryReport() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "reports");
  const calendar = useCalendarMode();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [del, setDel] = useState<ActivityLogRow | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const list = useQuery({ queryKey: ["activity-log"], queryFn: () => listActivityLog() });
  const rangeErr = dateRangeError(from, to);
  const rows = useMemo(() => {
    const all = list.data ?? [];
    if (rangeErr) return all;
    return all.filter((r) => inDateRange(r.occurredAt.slice(0, 10), from, to));
  }, [list.data, from, to, rangeErr]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["activity-log"] });
  }

  return (
    <div>
      <ReportSheet title="تاریخچه عملکرد">
        {writable ? (
          <div className="no-print flex justify-end">
            <button
              type="button"
              className="h-8 rounded-sm border border-danger/40 bg-danger-soft px-2 text-2xs font-medium text-danger hover:bg-danger/15"
              onClick={() => setResetOpen(true)}
            >
              ریست کلی
            </button>
          </div>
        ) : null}
        <p className="text-sm text-muted">
          این فهرست فقط گزارش عملکرد است. حذف یا ریست آن روی محاسبات، موجودی و حساب‌ها اثر ندارد.
        </p>
        <DateRangeBar from={from} to={to} onFrom={setFrom} onTo={setTo} onClear={() => { setFrom(""); setTo(""); }} error={rangeErr} />
        <FilterTable
          tone="c"
          rows={rows}
          rowKey={(r) => r.id}
          empty="تاریخچه‌ای ثبت نشده است"
          columns={[
            {
              key: "when",
              header: "تاریخ",
              value: (r) => formatWhen(r.occurredAt, calendar),
              cell: (r) => (
                <span className="tabular-nums whitespace-nowrap" dir="ltr">
                  {formatWhen(r.occurredAt, calendar)}
                </span>
              ),
            },
            { key: "area", header: "بخش", value: (r) => r.areaLabel, cell: (r) => r.areaLabel },
            { key: "action", header: "عمل", value: (r) => r.action, cell: (r) => r.action },
            { key: "title", header: "عنوان", value: (r) => r.title, cell: (r) => r.title || "—" },
            { key: "detail", header: "توضیح", value: (r) => r.detail, cell: (r) => r.detail || "—" },
            {
              key: "del",
              header: "",
              filterable: false,
              value: () => "",
              cell: (r) =>
                writable ? <IconBtn kind="delete" onClick={() => setDel(r)} /> : null,
            },
          ]}
        />
      </ReportSheet>
      <ConfirmDelete
        open={Boolean(del)}
        title="حذف از تاریخچه"
        message="فقط همین ردیف از تاریخچه حذف می‌شود. محاسبات برنامه تغییر نمی‌کند."
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deleteActivityLog({ data: { id: del.id } });
          await refresh();
          toast.success("از تاریخچه حذف شد");
        }}
      />
      <ConfirmAccountantReset
        open={resetOpen}
        title="ریست کلی تاریخچه"
        message="تمام ردیف‌های تاریخچه عملکرد پاک می‌شود. محاسبات، موجودی و حساب‌ها تغییر نمی‌کند. کد حسابدار را وارد کنید."
        confirmLabel="پاک کردن تاریخچه"
        onClose={() => setResetOpen(false)}
        onConfirm={async (code) => {
          await resetActivityLog({ data: { code } });
          await refresh();
          toast.success("تاریخچه پاک شد");
        }}
      />
    </div>
  );
}
