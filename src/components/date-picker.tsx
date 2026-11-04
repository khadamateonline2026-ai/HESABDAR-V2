import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  formatJalaliDisplay,
  formatPreferredDate,
  GREGORIAN_MONTHS,
  gregorianMonthLength,
  gregorianToJalali,
  JALALI_MONTHS,
  jalaliMonthLength,
  jalaliToGregorianIso,
  monthStartWeekday,
  WEEKDAYS_SHORT,
} from "@/lib/jalali";
import { isoToDisplay, todayIso } from "@/lib/format";
import { useCalendarMode } from "@/lib/prefs";
import { cn } from "@/lib/utils";

export function DateText({ iso, className }: { iso?: string | null; className?: string }) {
  const mode = useCalendarMode();
  if (!iso) return <span className={className}>—</span>;
  return <span className={cn("tabular-nums", className)}>{formatPreferredDate(iso, mode)}</span>;
}

export function DateField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
}) {
  const calendar = useCalendarMode();
  const [open, setOpen] = useState(false);
  const calRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const label = value ? formatPreferredDate(value, calendar) : "";

  return (
    <div className="relative">
      <div className="relative">
        <input
          readOnly
          disabled={disabled}
          value={label}
          placeholder=""
          onClick={() => !disabled && setOpen(true)}
          className="field-input cursor-pointer pl-11"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen((v) => !v)}
          className="absolute top-1/2 left-2 grid size-8 -translate-y-1/2 place-items-center rounded-sm text-muted hover:bg-surface-2"
          aria-label="تقویم"
        >
          <CalendarDays className="size-4" />
        </button>
      </div>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[90] flex items-center justify-center p-3">
              <button
                type="button"
                className="absolute inset-0 bg-fg/20"
                aria-label="بستن تقویم"
                onClick={() => setOpen(false)}
              />
              <div ref={calRef} className="relative z-10" onMouseDown={(e) => e.stopPropagation()}>
                <CalendarCard
                  value={value || todayIso()}
                  defaultMode={calendar}
                  onSelect={(iso) => {
                    onChange(iso);
                    setOpen(false);
                  }}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function CalendarCard({
  value,
  onSelect,
  defaultMode,
}: {
  value: string;
  onSelect: (iso: string) => void;
  defaultMode: "jalali" | "gregorian";
}) {
  const [mode, setMode] = useState<"jalali" | "gregorian">(defaultMode);

  const initial = useMemo(() => {
    if (mode === "jalali") return gregorianToJalali(value);
    const [y, m] = value.split("-").map(Number);
    return { y, m, d: 1 };
  }, [value, mode]);
  const [cursor, setCursor] = useState(initial);

  useEffect(() => {
    if (mode === "jalali") setCursor(gregorianToJalali(value));
    else {
      const [y, m] = value.split("-").map(Number);
      setCursor({ y, m, d: 1 });
    }
  }, [mode, value]);

  const length =
    mode === "jalali" ? jalaliMonthLength(cursor.y, cursor.m) : gregorianMonthLength(cursor.y, cursor.m);
  const start = monthStartWeekday(cursor.y, cursor.m, mode === "jalali");
  const cells: (number | null)[] = [...Array(start).fill(null), ...Array.from({ length }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  const monthName = mode === "jalali" ? JALALI_MONTHS[cursor.m - 1] : GREGORIAN_MONTHS[cursor.m - 1];

  function shift(delta: number) {
    let m = cursor.m + delta;
    let y = cursor.y;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    if (m > 12) {
      m = 1;
      y += 1;
    }
    setCursor({ y, m, d: 1 });
  }

  function pick(day: number) {
    if (mode === "jalali") onSelect(jalaliToGregorianIso(cursor.y, cursor.m, day));
    else onSelect(`${cursor.y}-${String(cursor.m).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }

  const selected = mode === "jalali" ? gregorianToJalali(value) : parseG(value);

  return (
    <div className="w-80 rounded-md border border-border-strong bg-surface p-3 shadow-panel">
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-sm bg-surface-2 p-1">
        <button
          type="button"
          onClick={() => setMode("jalali")}
          className={cn("h-8 rounded-sm text-xs", mode === "jalali" && "bg-surface font-medium")}
        >
          هجری شمسی
        </button>
        <button
          type="button"
          onClick={() => setMode("gregorian")}
          className={cn("h-8 rounded-sm text-xs", mode === "gregorian" && "bg-surface font-medium")}
        >
          میلادی
        </button>
      </div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => shift(1)} className="grid size-8 place-items-center rounded-sm hover:bg-surface-2" aria-label="ماه بعد">
          <ChevronRight className="size-4" />
        </button>
        <div className="text-sm font-medium">
          {monthName} {cursor.y}
        </div>
        <button type="button" onClick={() => shift(-1)} className="grid size-8 place-items-center rounded-sm hover:bg-surface-2" aria-label="ماه قبل">
          <ChevronLeft className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-2xs text-muted">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          const isSel =
            day != null && selected.y === cursor.y && selected.m === cursor.m && selected.d === day;
          return (
            <button
              key={i}
              type="button"
              disabled={day == null}
              onClick={() => day && pick(day)}
              className={cn(
                "grid h-8 place-items-center rounded-sm text-xs",
                day == null && "opacity-0",
                isSel && "bg-primary text-primary-fg",
                day && !isSel && "hover:bg-surface-2",
              )}
            >
              {day ?? ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function parseG(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export { isoToDisplay, formatJalaliDisplay };
