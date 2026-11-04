import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { tablesToSheets, type ExcelSheet } from "@/lib/excel";
import { cn } from "@/lib/utils";

export function ExcelButton({
  filename,
  getSheets,
  disabled,
  className,
}: {
  filename: string;
  getSheets: () => ExcelSheet[] | Promise<ExcelSheet[]>;
  disabled?: boolean;
  className?: string;
}) {
  async function run() {
    try {
      const sheets = await getSheets();
      const usable = sheets.filter((s) => s.headers.length && s.rows.length);
      if (!usable.length) {
        toast.error("موردی برای خروجی نیست");
        return;
      }
      const { downloadExcel } = await import("@/lib/excel-write");
      await downloadExcel(filename, usable);
    } catch {
      toast.error("خروجی اکسل ناکام شد");
    }
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void run()}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm hover:bg-surface-2 disabled:opacity-50",
        className,
      )}
    >
      <FileSpreadsheet className="size-4 shrink-0" />
      <span className="truncate">خروجی اکسل</span>
    </button>
  );
}

export function sheetsFromNode(node: HTMLElement | null): ExcelSheet[] {
  if (!node) return [];
  return tablesToSheets(node);
}