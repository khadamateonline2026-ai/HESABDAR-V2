import { FileDown, ImageDown, Printer, X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { DateField } from "@/components/date-picker";
import { capturePng, downloadPdf } from "@/components/invoice-ui";
import { cn } from "@/lib/utils";

export function DateRangeBar({
  from,
  to,
  onFrom,
  onTo,
  onClear,
  error,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onClear: () => void;
  error?: string;
}) {
  return (
    <div className="mb-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
      <div className="min-w-0">
        <span className="mb-1.5 block truncate text-sm font-medium">از تاریخ</span>
        <DateField value={from} onChange={onFrom} />
      </div>
      <div className="min-w-0">
        <span className="mb-1.5 block truncate text-sm font-medium">الی تاریخ</span>
        <DateField value={to} onChange={onTo} />
      </div>
      <button
        type="button"
        onClick={onClear}
        className="grid size-11 place-items-center rounded-sm border border-border text-muted hover:bg-surface-2 hover:text-fg"
        aria-label="پاک‌کردن بازه تاریخ"
      >
        <X className="size-4" />
      </button>
      {error ? <p className="col-span-3 text-sm text-danger">{error}</p> : null}
    </div>
  );
}

export function inDateRange(iso: string, from: string, to: string): boolean {
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

export function dateRangeError(from: string, to: string): string {
  if (from && to && from > to) return "تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد";
  return "";
}

export function SummaryStats({ items }: { items: { label: string; value: string }[] }) {
  const cols =
    items.length <= 2
      ? "grid-cols-2"
      : items.length === 3
        ? "grid-cols-3"
        : "grid-cols-4";
  return (
    <dl className={cn("mt-2 grid gap-2", cols)}>
      {items.map((it) => (
        <div
          key={it.label}
          className="min-w-0 rounded-sm border border-border bg-surface px-1.5 py-1.5 text-center"
        >
          <dt className="truncate text-micro leading-tight text-muted">{it.label}</dt>
          <dd className="mt-0.5 truncate text-2xs font-semibold tabular-nums leading-tight" dir="ltr">
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ReportSheet({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLDivElement>(null);

  async function saveImage() {
    const node = ref.current;
    if (!node) return;
    try {
      const url = await capturePng(node);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title}.png`;
      a.click();
    } catch {
      toast.error("ذخیره تصویر ناکام شد");
    }
  }

  async function savePdf() {
    const node = ref.current;
    if (!node) return;
    try {
      await downloadPdf(node, title);
    } catch {
      toast.error("ذخیره PDF ناکام شد");
    }
  }

  return (
    <div>
      {lead ? (
        <div ref={leadRef} className="export-exclude no-print mb-4 space-y-3">
          {lead}
        </div>
      ) : null}
      <div ref={ref} className="print-sheet space-y-4 rounded-md border border-border bg-surface p-4 sm:p-5">
        {children}
      </div>
      <div className="no-print mt-3 grid grid-cols-3 gap-1">
        <IconAction label="چاپ" onClick={() => window.print()}>
          <Printer className="size-4" />
        </IconAction>
        <IconAction label="ذخیره عکس" onClick={() => void saveImage()}>
          <ImageDown className="size-4" />
        </IconAction>
        <IconAction label="ذخیره PDF" onClick={() => void savePdf()}>
          <FileDown className="size-4" />
        </IconAction>
      </div>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-10 min-w-0 items-center justify-center gap-1 rounded-sm border border-border bg-surface px-1 text-2xs hover:bg-surface-2",
      )}
    >
      {children}
      <span className="truncate">{label}</span>
    </button>
  );
}
