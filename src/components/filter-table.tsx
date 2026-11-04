import { Filter } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type FilterColumn<T> = {
  key: string;
  header: string;
  value: (row: T) => string;
  cell: (row: T, index: number) => ReactNode;
  filterable?: boolean;
  className?: string;
};

export function FilterTable<T>({
  rows,
  columns,
  rowKey,
  empty = "موردی ثبت نشده است",
  footer,
  tone,
}: {
  rows: T[];
  columns: FilterColumn<T>[];
  rowKey: (row: T) => string | number;
  empty?: string;
  footer?: (visible: T[]) => ReactNode;
  tone?: "a" | "b" | "c" | "d";
}) {
  const [applied, setApplied] = useState<Record<string, string[] | null>>({});

  const visible = useMemo(() => {
    return rows.filter((row) =>
      columns.every((col) => {
        if (col.filterable === false) return true;
        const sel = applied[col.key];
        if (!sel) return true;
        return sel.includes(col.value(row));
      }),
    );
  }, [rows, columns, applied]);

  return (
    <div className={tone ? "dash-card list-card" : undefined}>
    <div className={tone ? "overflow-x-auto" : "overflow-x-auto rounded-md border border-border bg-surface"}>
      <table className="w-max min-w-full border-separate border-spacing-0 text-2xs sm:text-sm">
        <thead>
          <tr className={tone ? undefined : "bg-surface-2"}>
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "border-b border-border px-2 py-2 text-center text-sm font-bold leading-none whitespace-nowrap text-fg sm:px-2.5",
                  !c.header && "w-12",
                  c.className,
                )}
              >
                <div className="flex items-center justify-center gap-0.5">
                  <span className="whitespace-nowrap">{c.header}</span>
                  {c.filterable !== false ? (
                    <ColumnFilter
                      values={uniqueValues(rows, c)}
                      selected={applied[c.key] ?? null}
                      active={Boolean(applied[c.key])}
                      onApply={(next) => setApplied((prev) => ({ ...prev, [c.key]: next }))}
                    />
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-muted">
                {empty}
              </td>
            </tr>
          ) : (
            visible.map((row, i) => (
              <tr key={rowKey(row)} className={tone ? undefined : i % 2 ? "bg-bg-warm/40" : "bg-surface"}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "border-b border-border px-2 py-2 text-center align-middle leading-none whitespace-nowrap sm:px-2.5",
                      c.className,
                    )}
                  >
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer ? <tfoot>{footer(visible)}</tfoot> : null}
      </table>
    </div>
    </div>
  );
}

function uniqueValues<T>(rows: T[], col: FilterColumn<T>): string[] {
  const set = new Set<string>();
  for (const row of rows) set.add(col.value(row));
  return [...set];
}

function ColumnFilter({
  values,
  selected,
  active,
  onApply,
}: {
  values: string[];
  selected: string[] | null;
  active: boolean;
  onApply: (next: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<string[]>(selected ?? values);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(selected ?? values);
    setQ("");
    const r = btn.current?.getBoundingClientRect();
    if (r) {
      const width = 224;
      const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
      setPos({ top: r.bottom + 4, left });
    }
  }, [open, selected, values]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btn.current?.contains(t) || panel.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const shown = values.filter((v) => !q.trim() || v.includes(q.trim()));
  const allOn = shown.length > 0 && shown.every((v) => draft.includes(v));

  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "no-print grid size-7 place-items-center rounded-sm text-subtle hover:bg-surface hover:text-fg",
          active && "bg-primary-soft text-primary",
        )}
        aria-label="فیلتر"
      >
        <Filter className="size-3.5" />
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              style={{ top: pos.top, left: pos.left }}
              className="fixed z-50 w-56 rounded-sm border border-border-strong bg-surface p-2 shadow-panel"
            >
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="جست‌وجو"
                className="field-input mb-2 h-9 text-sm"
              />
              <label className="mb-1 flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-xs hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={() => {
                    if (allOn) setDraft((d) => d.filter((x) => !shown.includes(x)));
                    else setDraft((d) => [...new Set([...d, ...shown])]);
                  }}
                />
                انتخاب همه / عدم انتخاب همه
              </label>
              <div className="max-h-40 overflow-auto">
                {shown.map((v) => (
                  <label
                    key={v}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-xs hover:bg-surface-2"
                  >
                    <input
                      type="checkbox"
                      checked={draft.includes(v)}
                      onChange={() =>
                        setDraft((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]))
                      }
                    />
                    <span className="break-all">{v || "—"}</span>
                  </label>
                ))}
              </div>
              <div className="mt-2 flex gap-1">
                <button
                  type="button"
                  className="h-9 flex-1 rounded-sm bg-primary text-xs text-primary-fg"
                  onClick={() => {
                    const next =
                      draft.length === 0 || draft.length === values.length ? null : [...draft];
                    onApply(next);
                    setOpen(false);
                  }}
                >
                  اعمال
                </button>
                <button
                  type="button"
                  className="h-9 rounded-sm border border-border px-2 text-xs"
                  onClick={() => {
                    onApply(null);
                    setDraft(values);
                    setOpen(false);
                  }}
                >
                  پاک‌کردن فیلتر
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
