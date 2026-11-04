import { Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type SelectOption = { id: number | string; label: string };

export function EntitySelect({
  value,
  options,
  onChange,
  onAdd,
  placeholder = "انتخاب کنید",
  disabled,
  compact,
  className,
}: {
  value: number | string | null;
  options: SelectOption[];
  onChange: (id: number | string | null) => void;
  onAdd?: () => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);
  const selected = options.find((o) => String(o.id) === String(value));
  const filtered = useMemo(() => {
    const needle = q.trim();
    if (!needle) return options;
    return options.filter((o) => o.label.includes(needle) || String(o.id).includes(needle));
  }, [options, q]);

  function place() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, 220), vw - 16);
    const spaceBelow = vh - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const below = spaceBelow >= 160 || spaceBelow >= spaceAbove;
    const maxH = Math.min(288, Math.max(120, below ? spaceBelow : spaceAbove));
    let left = r.right - width;
    if (left < 8) left = 8;
    if (left + width > vw - 8) left = Math.max(8, vw - 8 - width);
    const top = below ? r.bottom + 4 : Math.max(8, r.top - maxH - 4);
    setPos({ top, left, width, maxH });
  }

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onWin = () => place();
    window.addEventListener("resize", onWin);
    document.addEventListener("scroll", onWin, true);
    return () => {
      window.removeEventListener("resize", onWin);
      document.removeEventListener("scroll", onWin, true);
    };
  }, [open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (root.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  return (
    <div ref={root} className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "field-input flex items-center overflow-visible",
          compact
            ? "mx-auto h-11 min-w-max justify-center px-2 text-center text-sm"
            : "justify-between gap-2 text-right",
          !selected && "text-subtle",
          className,
        )}
      >
        <span className="whitespace-nowrap">{selected?.label ?? placeholder}</span>
        {compact ? null : <span className="text-subtle">▾</span>}
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxH }}
              className="overlay-popover fixed overflow-auto rounded-sm border border-border-strong bg-surface text-fg shadow-panel"
            >
              <div className="sticky top-0 border-b border-border bg-surface p-2">
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="جست‌وجو"
                  className="field-input h-9 text-sm"
                />
              </div>
              <button
                type="button"
                className="block w-full px-3 py-2.5 text-right text-sm text-muted hover:bg-surface-2 hover:text-fg"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                — {placeholder || "خالی"}
              </button>
              {filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={cn(
                    "block w-full px-3 py-2.5 text-right text-sm whitespace-nowrap hover:bg-surface-2 hover:text-fg",
                    String(o.id) === String(value) && "bg-primary-soft text-fg",
                  )}
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              ))}
              {onAdd ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-right text-sm text-primary hover:bg-primary-soft"
                  onClick={() => {
                    setOpen(false);
                    onAdd();
                  }}
                >
                  <Plus className="size-4" />
                  افزودن
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
