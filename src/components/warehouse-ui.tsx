import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { AddNameModal } from "@/components/add-name-modal";
import { ConfirmDelete } from "@/components/confirm-delete";
import { DateField, DateText } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { IconBtn } from "@/components/icon-btn";
import { ImageSlot } from "@/components/image-slot";
import { AfAmount } from "@/components/invoice-ui";
import { useAppData } from "@/components/layout/app-shell";
import { MoneyInput, amountNumber } from "@/components/money-input";
import { PartyFormModal } from "@/components/party-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { saveOpeningStock } from "@/lib/api/finance";
import {
  createWorkOrder,
  deliverWorkOrder,
  getInventory,
  listPriorProductGivers,
  patchItemImage,
  saveCatalogItem,
  updateWorkOrder,
} from "@/lib/api/inventory";
import { deleteItemCategory, listWageRates, saveItem, saveItemCategory, saveProductionOverhead, saveUnit } from "@/lib/api/setup";
import { formatMoney, emptyNum, parseAmount, todayIso } from "@/lib/format";
import { weekCodeForDate } from "@/lib/delivery-weeks";
import { useCalendarMode } from "@/lib/prefs";
import { queryClient } from "@/lib/query-client";
import { wageTotalsByModel, type BomLine, type CalendarMode, type Item, type ItemCategory, type StockCard, type WorkOrder } from "@/lib/types";
import { cn, compareFaName } from "@/lib/utils";
import { WageModal } from "@/routes/_app/setup.wages";

function weekInvoiceNo(iso: string, mode: CalendarMode): string {
  const saved = typeof localStorage === "undefined" ? "" : localStorage.getItem("hesabdar-wk1-start") || "";
  return weekCodeForDate(iso, mode, saved || null);
}

export async function refreshWarehouse() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["inventory"] }),
    queryClient.invalidateQueries({ queryKey: ["work-orders"] }),
    queryClient.invalidateQueries({ queryKey: ["bootstrap"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["warehouse-stock"] }),
    queryClient.invalidateQueries({ queryKey: ["worker-ledger"] }),
    queryClient.invalidateQueries({ queryKey: ["opening-stock"] }),
  ]);
}

export function CategoryBar({
  categories,
  value,
  onChange,
  writable,
  canEdit,
  onAdd,
  onEdit,
  onDelete,
  className,
  end,
}: {
  categories: { id: number; name: string }[];
  value: number | "all";
  onChange: (id: number | "all") => void;
  writable: boolean;
  canEdit?: boolean;
  onAdd?: () => void;
  onEdit?: (cat: { id: number; name: string }) => void;
  onDelete?: (cat: { id: number; name: string }) => void;
  className?: string;
  end?: ReactNode;
}) {
  const selected = typeof value === "number" ? categories.find((c) => c.id === value) : null;
  return (
    <div className={cn("mb-3 flex items-end gap-2", className)}>
      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto pb-0.5">
        <button
          type="button"
          onClick={() => onChange("all")}
          className={cn(
            "company-chip h-8 shrink-0 rounded-md border px-2 text-2xs whitespace-nowrap",
            value === "all" ? "chip-on border-white/70" : "border-white/25",
          )}
        >
          همه
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            className={cn(
              "company-chip h-8 shrink-0 rounded-md border px-2 text-2xs whitespace-nowrap",
              value === c.id ? "chip-on border-white/70" : "border-white/25",
            )}
          >
            {c.name}
          </button>
        ))}
        {writable && onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            className="grid size-8 shrink-0 place-items-center rounded-md border border-dashed border-border-strong text-primary hover:bg-primary-soft"
            aria-label="افزودن دسته‌بندی"
          >
            <Plus className="size-3.5" />
          </button>
        ) : null}
        {writable && selected && onDelete ? (
          <button
            type="button"
            onClick={() => onDelete(selected)}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger"
            aria-label="حذف دسته‌بندی"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
        {writable && selected && canEdit && onEdit ? (
          <button
            type="button"
            onClick={() => onEdit(selected)}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
            aria-label="ویرایش دسته‌بندی"
          >
            <Pencil className="size-3.5" />
          </button>
        ) : null}
      </div>
      {end}
    </div>
  );
}

export function StockCardView({
  card,
  costLabel,
  writable,
  onEdit,
  onDelete,
  bomLines,
  defaultOpen,
  highlight,
  open,
  onToggle,
  aligned,
}: {
  card: StockCard;
  costLabel: string;
  writable: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  bomLines?: BomLine[];
  defaultOpen?: boolean;
  highlight?: boolean;
  open?: boolean;
  onToggle?: () => void;
  aligned?: boolean;
}) {
  const low = card.minQty > 0 && card.qty + 1e-9 < card.minQty;
  const expandable = bomLines != null;
  const [innerOpen, setInnerOpen] = useState(Boolean(defaultOpen));
  const isOpen = onToggle ? Boolean(open) : innerOpen;
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!defaultOpen && !highlight) return;
    if (defaultOpen && !onToggle) setInnerOpen(true);
    rootRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [defaultOpen, highlight, onToggle]);
  return (
    <article
      ref={rootRef}
      className={cn(
        "list-row",
        low ? "low-stock" : "border-b border-border last:border-b-0",
        aligned && "stock-aligned",
        expandable && "cursor-pointer",
        highlight && "ring-2 ring-primary ring-inset",
      )}
      onClick={
        expandable
          ? () => {
              if (onToggle) onToggle();
              else setInnerOpen((v) => !v);
            }
          : undefined
      }
    >
      <div className={cn("flex items-center", low && !aligned && "low-stock-line")}>
        {low && !aligned ? <span className="low-stock-flag">{"\u00A0کمبود موجودی\u00A0"}</span> : null}
        <div
          className={cn(
            "grid min-w-0 flex-1 items-center self-center px-2 text-center",
            aligned ? "py-2" : low ? "py-0" : "py-1.5",
          )}
          style={{ gridTemplateColumns: aligned ? STOCK_COLS_ALIGNED : STOCK_COLS }}
        >
        {aligned ? (
          <div className="relative min-w-0">
            <div
              className="absolute inset-y-0 start-0 flex items-center"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <ImageSlot
                src={card.image}
                size={28}
                editable={writable}
                alt={card.name}
                className="shrink-0"
                onChange={async (url) => {
                  await patchItemImage({ data: { id: card.itemId, image: url } });
                  await refreshWarehouse();
                }}
                onClear={
                  writable
                    ? async () => {
                        await patchItemImage({ data: { id: card.itemId, image: null } });
                        await refreshWarehouse();
                      }
                    : undefined
                }
              />
            </div>
            <div className="truncate px-8 text-center text-sm font-semibold">{card.name}</div>
          </div>
        ) : (
        <div className="relative min-w-0">
          <div
            className="absolute inset-y-0 start-0 flex items-center"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <ImageSlot
              src={card.image}
              size={28}
              editable={writable}
              alt={card.name}
              className="shrink-0"
              onChange={async (url) => {
                await patchItemImage({ data: { id: card.itemId, image: url } });
                await refreshWarehouse();
              }}
              onClear={
                writable
                  ? async () => {
                      await patchItemImage({ data: { id: card.itemId, image: null } });
                      await refreshWarehouse();
                    }
                  : undefined
              }
            />
          </div>
          <h3 className="truncate px-8 text-center text-sm font-semibold">{card.name}</h3>
        </div>
        )}
        <div className="min-w-0 truncate text-center text-2xs tabular-nums whitespace-nowrap">
          {formatMoney(card.qty)}
          {card.unitName ? ` ${card.unitName}` : ""}
        </div>
        <div className="min-w-0 text-center text-2xs">
          <AfAmount value={card.unitCost} />
        </div>
        <div className="min-w-0 text-center text-2xs">
          <AfAmount value={card.salePrice} />
        </div>
        <div className="min-w-0 text-center text-2xs">
          <AfAmount whole value={card.valueBase} />
        </div>
        <div className="min-w-0 text-center text-2xs tabular-nums whitespace-nowrap">{formatMoney(card.minQty)}</div>
        <div className={cn("flex items-center", aligned ? "justify-center" : "justify-end")} onClick={(e) => e.stopPropagation()}>
          {writable && onEdit ? <IconBtn kind="edit" onClick={onEdit} /> : null}
          {writable && onDelete ? <IconBtn kind="delete" onClick={onDelete} /> : null}
        </div>
        {aligned ? (
          low ? <span className="low-stock-flag">کمبود موجودی</span> : <span />
        ) : null}
        </div>
      </div>
      {isOpen && expandable ? (
        <ul className="space-y-1 border-t border-border px-3 py-2 text-2xs">
          {bomLines.length ? (
            bomLines.map((line) => (
              <li key={line.rawItemId} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{line.rawItemName}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  {formatMoney(line.quantity)}
                  {line.unitName ? ` ${line.unitName}` : ""}
                </span>
              </li>
            ))
          ) : (
            <li className="text-muted">مواد خامی برای این مدل ثبت نشده است</li>
          )}
        </ul>
      ) : null}
    </article>
  );
}

const STOCK_COLS = "minmax(8rem,1.7fr) repeat(5,minmax(4.6rem,1fr)) 4.25rem";
const STOCK_COLS_ALIGNED = "repeat(6, minmax(0, 1fr)) 4.25rem 1.35rem";

function StockSheet({
  tone,
  toolbar,
  costLabel = "قیمت خرید",
  aligned,
  children,
}: {
  tone: "a" | "b" | "c" | "d";
  toolbar?: ReactNode;
  costLabel?: string;
  aligned?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="dash-card list-card">
      {toolbar ? <div className="border-b border-border px-2 pt-2">{toolbar}</div> : null}
      <div className="overflow-x-auto">
      <div className="min-w-[44rem]">
        <div
          className="list-head grid items-center border-b border-border px-2 py-2 text-center text-sm font-bold whitespace-nowrap text-muted"
          style={{ gridTemplateColumns: aligned ? STOCK_COLS_ALIGNED : STOCK_COLS }}
        >
          <span>نوع جنس</span>
          <span>موجودی</span>
          <span>{costLabel}</span>
          <span>قیمت فروش</span>
          <span>ارزش</span>
          <span>حداقل</span>
          <span />
          {aligned ? <span /> : null}
        </div>
        {children}
      </div>
      </div>
    </div>
  );
}

export function CategoryGroups({
  cards,
  categories,
  filter,
  costLabel,
  writable,
  emptyText,
  onEdit,
  onDelete,
  bomByProduct,
  focusItemId,
  tone = "b",
  bar,
  aligned,
}: {
  cards: StockCard[];
  categories: { id: number; name: string }[];
  filter: number | "all";
  costLabel: string;
  writable: boolean;
  emptyText: string;
  onEdit?: (card: StockCard) => void;
  onDelete?: (card: StockCard) => void;
  bomByProduct?: Record<number, BomLine[]>;
  focusItemId?: number | null;
  tone?: "a" | "b" | "c" | "d";
  bar?: ReactNode;
  aligned?: boolean;
}) {
  const [openId, setOpenId] = useState<number | null>(focusItemId ?? null);
  useEffect(() => {
    if (focusItemId != null) setOpenId(focusItemId);
  }, [focusItemId]);
  const sorted = [...cards].sort((a, b) => compareFaName(a.name, b.name));
  function renderCard(card: StockCard) {
    const focused = focusItemId != null && card.itemId === focusItemId;
    const expandable = Boolean(bomByProduct);
    return (
      <StockCardView
        key={card.itemId}
        card={card}
        costLabel={costLabel}
        writable={writable}
        onEdit={onEdit ? () => onEdit(card) : undefined}
        onDelete={onDelete ? () => onDelete(card) : undefined}
        bomLines={bomByProduct ? (bomByProduct[card.itemId] ?? []) : undefined}
        defaultOpen={focused && expandable}
        highlight={focused}
        open={expandable ? openId === card.itemId : undefined}
        aligned={aligned}
        onToggle={
          expandable
            ? () => setOpenId((id) => (id === card.itemId ? null : card.itemId))
            : undefined
        }
      />
    );
  }
  if (!sorted.length) {
    return (
      <StockSheet tone={tone} toolbar={bar} costLabel={costLabel} aligned={aligned}>
        <p className="px-2 py-3 text-sm text-muted">{emptyText}</p>
      </StockSheet>
    );
  }
  if (filter === "all") {
    return (
      <StockSheet tone={tone} toolbar={bar} costLabel={costLabel} aligned={aligned}>
        {sorted.map(renderCard)}
      </StockSheet>
    );
  }
  const cats = categories.filter((c) => c.id === filter);
  const grouped = cats.map((c) => ({
    id: c.id,
    name: c.name,
    items: sorted.filter((it) => it.categoryId === c.id),
  }));
  const known = new Set(categories.map((c) => c.id));
  const loose = sorted.filter((it) => it.categoryId == null || !known.has(it.categoryId));
  if (loose.length && !cats.length) grouped.push({ id: 0, name: "بدون دسته", items: loose });
  const visible = grouped;
  if (!visible.length) {
    return (
      <StockSheet tone={tone} toolbar={bar} costLabel={costLabel} aligned={aligned}>
        <p className="px-2 py-3 text-sm text-muted">در این دسته موردی نیست</p>
      </StockSheet>
    );
  }
  return (
    <StockSheet tone={tone} toolbar={bar} aligned={aligned}>
      {visible.map((g) => (
        <section key={g.id || g.name}>
          <h2 className="border-b border-border px-2 py-1.5 text-sm font-semibold">{g.name}</h2>
          {g.items.length ? (
            g.items.map((card) => renderCard(card))
          ) : (
            <p className="px-2 py-2 text-sm text-muted">در این دسته موردی نیست</p>
          )}
        </section>
      ))}
    </StockSheet>
  );
}

function newBomRow(): { key: string; rawItemId: number | null; quantity: string } {
  return { key: Math.random().toString(36).slice(2), rawItemId: null, quantity: "" };
}

function itemIdOf(initial: StockCard | Item | null): number | undefined {
  if (!initial) return undefined;
  return "itemId" in initial ? initial.itemId : initial.id;
}

export function ProductForm({
  initial,
  bomLines,
  defaultCategoryId,
  onClose,
}: {
  initial: StockCard | Item | null;
  bomLines: BomLine[];
  defaultCategoryId: number | null;
  onClose: () => void;
}) {
  const { data } = useAppData();
  const production = data?.settings.productionEnabled !== false;
  const inv = useQuery({ queryKey: ["inventory"], queryFn: () => getInventory() });
  const cats = (data?.catalogs.itemCategories ?? []).filter((c) => c.kind === "product");
  const units = data?.catalogs.units ?? [];
  const products = (data?.catalogs.items ?? []).filter((i) => i.kind === "product");
  const rawItems = (data?.catalogs.items ?? []).filter((i) => i.kind === "raw");
  const [editId, setEditId] = useState<number | undefined>(itemIdOf(initial));
  const [name, setName] = useState(initial?.name ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(initial?.categoryId ?? defaultCategoryId ?? cats[0]?.id ?? null);
  const [unitId, setUnitId] = useState<number | null>(initial?.unitId ?? units[0]?.id ?? null);
  const [minQty, setMinQty] = useState(emptyNum(initial?.minQty));
  const [salePrice, setSalePrice] = useState(emptyNum(initial?.salePrice));
  const [purchasePrice, setPurchasePrice] = useState(emptyNum(initial?.purchasePrice));
  const [bom, setBom] = useState<{ key: string; rawItemId: number | null; quantity: string }[]>(
    bomLines.length
      ? bomLines.map((b) => ({ key: String(b.rawItemId), rawItemId: b.rawItemId, quantity: String(b.quantity) }))
      : [],
  );
  const [extras, setExtras] = useState<{ key: string; title: string; amount: string }[]>(() => {
    const id = itemIdOf(initial);
    const rows = id != null ? (inv.data?.overheadsByProduct[id] ?? []) : [];
    return rows.map((o) => ({ key: String(o.id), title: o.title, amount: emptyNum(o.amount) }));
  });
  const [pane, setPane] = useState<"bom" | "extra">("bom");
  const [bomOpen, setBomOpen] = useState(true);
  const wageRates = useQuery({ queryKey: ["wages"], queryFn: () => listWageRates() });
  const [add, setAdd] = useState<"cat" | "unit" | "raw" | "name" | "wage" | "overhead" | null>(null);
  const [rawTarget, setRawTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [leave, setLeave] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [stockQty, setStockQty] = useState("");
  const extrasLoaded = useRef(Boolean(extras.length) || !editId);
  const [notes, setNotes] = useState(() => {
    const id = itemIdOf(initial);
    return products.find((i) => i.id === id)?.notes ?? "";
  });

  useEffect(() => {
    if (extrasLoaded.current || !inv.data || !editId) return;
    const rows = inv.data.overheadsByProduct[editId] ?? [];
    setExtras(rows.map((o) => ({ key: String(o.id), title: o.title, amount: emptyNum(o.amount) })));
    extrasLoaded.current = true;
  }, [inv.data, editId]);

  const nameOptions = useMemo(() => {
    const opts = products.map((i) => ({ id: i.name, label: i.name }));
    if (name && !products.some((i) => i.name === name)) opts.push({ id: name, label: name });
    return opts;
  }, [products, name]);

  const finishedCost = useMemo(() => {
    const rawCards = inv.data?.raw ?? [];
    let sum = 0;
    for (const line of bom) {
      if (!line.rawItemId) continue;
      const card = rawCards.find((r) => r.itemId === line.rawItemId);
      const raw = rawItems.find((i) => i.id === line.rawItemId);
      const unit =
        (raw?.purchasePrice ?? 0) > 1e-9
          ? raw!.purchasePrice
          : card && card.unitCost > 1e-9
            ? card.unitCost
            : 0;
      sum += amountNumber(line.quantity) * unit;
    }
    for (const e of extras) sum += amountNumber(e.amount);
    return sum;
  }, [bom, extras, inv.data, rawItems]);

  function patchBom(key: string, next: Partial<{ rawItemId: number | null; quantity: string }>) {
    setBom((rows) => rows.map((r) => (r.key === key ? { ...r, ...next } : r)));
  }

  function applyProduct(found: Item) {
    setEditId(found.id);
    setName(found.name);
    setCategoryId(found.categoryId);
    setUnitId(found.unitId);
    setMinQty(emptyNum(found.minQty));
    setSalePrice(emptyNum(found.salePrice));
    setPurchasePrice(emptyNum(found.purchasePrice));
    const lines = inv.data?.bomByProduct[found.id] ?? [];
    setBom(
      lines.length
        ? lines.map((b) => ({ key: String(b.rawItemId), rawItemId: b.rawItemId, quantity: String(b.quantity) }))
        : [],
    );
    const ov = inv.data?.overheadsByProduct[found.id] ?? [];
    setExtras(ov.map((o) => ({ key: String(o.id), title: o.title, amount: emptyNum(o.amount) })));
    setNotes(found.notes ?? "");
  }

  function requestClose() {
    if (dirty) {
      setLeave(true);
      return;
    }
    onClose();
  }

  return (
    <>
      <Modal open title={editId ? "ویرایش کالا" : "افزودن کالا"} onClose={requestClose} wide>
        <form
          ref={formRef}
          className="space-y-3"
          onChangeCapture={() => setDirty(true)}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              if (!name.trim()) throw new Error("نام لازم است");
              const cleaned = bom.filter((b) => b.rawItemId || amountNumber(b.quantity) > 0);
              const lines: { rawItemId: number; quantity: number }[] = [];
              for (const line of cleaned) {
                if (!line.rawItemId) throw new Error("ماده خام هر ردیف را انتخاب کنید");
                const q = amountNumber(line.quantity);
                if (q <= 0) throw new Error("مقدار مورد نیاز نمی‌تواند صفر یا منفی باشد");
                lines.push({ rawItemId: line.rawItemId, quantity: q });
              }
              await saveCatalogItem({
                data: {
                  id: editId,
                  kind: "product",
                  name,
                  categoryId,
                  unitId,
                  minQty: Math.max(0, amountNumber(minQty)),
                  salePrice: Math.max(0, amountNumber(salePrice)),
                  purchasePrice: production ? Math.max(0, finishedCost) : Math.max(0, amountNumber(purchasePrice)),
                  bom: lines,
                  overheads: extras
                    .map((x) => ({ title: x.title.trim(), amount: amountNumber(x.amount) }))
                    .filter((x) => x.title && x.amount > 0),
                  notes,
                },
              });
              const addQty = amountNumber(stockQty);
              if (addQty > 0) {
                await saveOpeningStock({
                  data: {
                    kind: "finished",
                    itemName: name.trim(),
                    warehouseName: data?.catalogs.warehouses[0]?.name || "گدام اصلی",
                    quantity: addQty,
                    occurredOn: todayIso(),
                    notes: "",
                  },
                });
              }
              await refreshWarehouse();
              toast.success("ثبت شد");
              onClose();
            } catch (err) {
              setError(err instanceof Error ? err.message : "ثبت ناکام شد");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="نام کالا">
            <EntitySelect
              value={name || null}
              options={nameOptions}
              onChange={(id) => {
                setDirty(true);
                const n = id == null ? "" : String(id);
                setName(n);
                const found = products.find((i) => i.name === n);
                if (found) applyProduct(found);
                else {
                  setEditId(undefined);
                  setNotes("");
                }
              }}
              onAdd={() => setAdd("name")}
            />
          </Field>
          <Field label="دسته‌بندی">
            <EntitySelect
              value={categoryId}
              options={cats.map((c) => ({ id: c.id, label: c.name }))}
              onChange={(id) => setCategoryId(id == null ? null : Number(id))}
              onAdd={() => setAdd("cat")}
            />
          </Field>
          <Field label="واحد">
            <EntitySelect
              value={unitId}
              options={units.map((u) => ({ id: u.id, label: u.name }))}
              onChange={(id) => setUnitId(id == null ? null : Number(id))}
              onAdd={() => setAdd("unit")}
            />
          </Field>
          {production ? null : (
            <Field label="قیمت خرید">
              <MoneyInput value={purchasePrice} onChange={setPurchasePrice} />
            </Field>
          )}
          <Field label="قیمت فروش">
            <MoneyInput value={salePrice} onChange={setSalePrice} />
          </Field>
          <Field label="هشدار حداقل موجودی">
            <MoneyInput value={minQty} onChange={setMinQty} />
          </Field>
          <Field label="موجودی اولیه">
            <MoneyInput value={stockQty} onChange={setStockQty} />
          </Field>
          <div className="rounded-sm border border-border p-3">
            <div className="mb-2 flex items-center justify-between rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm">
              <span className="text-muted">قیمت تمام‌شد</span>
              <AfAmount value={finishedCost} />
            </div>
            <div className="mb-2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (pane === "bom") setBomOpen((v) => !v);
                  else {
                    setPane("bom");
                    setBomOpen(true);
                  }
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-md border px-2 text-2xs whitespace-nowrap",
                  pane === "bom" ? "border-primary bg-primary-soft text-fg" : "border-border bg-surface text-muted",
                )}
              >
                مواد خام لازم
                <ChevronDown className={cn("size-3.5 transition-transform", pane === "bom" && bomOpen && "rotate-180")} />
              </button>
              <button
                type="button"
                onClick={() => setPane("extra")}
                className={cn(
                  "h-8 rounded-md border px-2 text-2xs whitespace-nowrap",
                  pane === "extra" ? "border-primary bg-primary-soft text-fg" : "border-border bg-surface text-muted",
                )}
              >
                سایر مصارف
              </button>
              {pane === "bom" ? (
              <button
                type="button"
                onClick={() => setBom((rows) => [...rows, newBomRow()])}
                className="add-box ms-auto"
                aria-label="افزودن"
              >
                <Plus className="size-4" />
              </button>
              ) : null}
            </div>
            {pane === "bom" ? (
              bomOpen ? (
              bom.length ? (
                <div className="overflow-x-auto">
                  <div className="min-w-[28rem] space-y-2">
                  <div className="grid grid-cols-[minmax(0,1.1fr)_4rem_3.5rem_5rem_5rem_2.5rem] items-center gap-1 text-center text-2xs font-medium text-muted">
                    <span>مواد خام</span>
                    <span>مقدار</span>
                    <span>واحد</span>
                    <span>قیمت خرید</span>
                    <span>مجموع</span>
                    <span />
                  </div>
                  {bom.map((row) => {
                    const used = new Set(bom.filter((r) => r.key !== row.key && r.rawItemId).map((r) => r.rawItemId));
                    const options = rawItems.filter((i) => i.id === row.rawItemId || !used.has(i.id));
                    const selected = rawItems.find((i) => i.id === row.rawItemId);
                    const card = (inv.data?.raw ?? []).find((c) => c.itemId === row.rawItemId);
                    const unitPrice =
                      (selected?.purchasePrice ?? 0) > 1e-9
                        ? selected!.purchasePrice
                        : card && card.unitCost > 1e-9
                          ? card.unitCost
                          : 0;
                    const lineTotal = amountNumber(row.quantity) * unitPrice;
                    return (
                      <div
                        key={row.key}
                        className="grid grid-cols-[minmax(0,1.1fr)_4rem_3.5rem_5rem_5rem_2.5rem] items-center gap-1"
                      >
                        <EntitySelect
                          value={row.rawItemId}
                          placeholder=""
                          options={options.map((i) => ({ id: i.id, label: i.name }))}
                          onChange={(id) => patchBom(row.key, { rawItemId: id == null ? null : Number(id) })}
                          onAdd={() => {
                            setRawTarget(row.key);
                            setAdd("raw");
                          }}
                        />
                        <MoneyInput value={row.quantity} onChange={(v) => patchBom(row.key, { quantity: v })} />
                        <span className="flex h-11 items-center justify-center text-center text-xs whitespace-nowrap">{selected?.unitName || ""}</span>
                        <span className="flex h-11 items-center justify-center text-center">
                          {row.rawItemId ? <AfAmount value={unitPrice} /> : <span className="text-muted">—</span>}
                        </span>
                        <span className="flex h-11 items-center justify-center text-center">
                          {row.rawItemId ? <AfAmount value={lineTotal} /> : <span className="text-muted">—</span>}
                        </span>
                        <button
                          type="button"
                          className="grid size-11 place-items-center text-muted hover:text-danger"
                          aria-label="حذف ردیف"
                          onClick={() => setBom((rows) => rows.filter((r) => r.key !== row.key))}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    );
                  })}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">هنوز ماده‌ای اضافه نشده است</p>
              )
              ) : null
            ) : (
              <div className="space-y-2">
                {(() => {
                  const overheads = data?.catalogs.productionOverheads ?? [];
                  const remaining = overheads.filter((o) => !extras.some((e) => e.title.trim() === o.title.trim()));
                  const wageChoices = wageTotalsByModel(wageRates.data ?? []).filter(
                    (t) => !extras.some((e) => e.title.trim() === `نرخ دستمزد — ${t.productModel}`),
                  );
                  return (
                    <>
                      <EntitySelect
                        value={null}
                        placeholder="انتخاب از نرخ دستمزد"
                        options={wageChoices.map((t) => ({
                          id: t.productModel,
                          label: `${t.productModel} — ${formatMoney(t.total)}`,
                        }))}
                        onChange={(id) => {
                          const model = id == null ? "" : String(id);
                          const found = wageChoices.find((t) => t.productModel === model);
                          if (!found) return;
                          setExtras((rows) => [
                            ...rows,
                            {
                              key: Math.random().toString(36).slice(2),
                              title: `نرخ دستمزد — ${found.productModel}`,
                              amount: emptyNum(found.total),
                            },
                          ]);
                        }}
                        onAdd={() => setAdd("wage")}
                      />
                      <EntitySelect
                        value={null}
                        placeholder="انتخاب از هزینه‌های متفرقه تولید"
                        options={remaining.map((o) => ({
                          id: o.id,
                          label: `${o.title} — ${formatMoney(o.amount)}`,
                        }))}
                        onChange={(id) => {
                          const n = id == null ? null : Number(id);
                          const found = remaining.find((o) => o.id === n);
                          if (!found) return;
                          setExtras((rows) => [
                            ...rows,
                            { key: Math.random().toString(36).slice(2), title: found.title, amount: emptyNum(found.amount) },
                          ]);
                        }}
                        onAdd={() => setAdd("overhead")}
                      />
                    </>
                  );
                })()}
                {extras.length ? (
                  <>
                    <div className="grid grid-cols-[minmax(0,1fr)_6rem_2.5rem] items-center gap-1 text-center text-2xs font-medium text-muted">
                      <span>عنوان</span>
                      <span>مبلغ</span>
                      <span />
                    </div>
                    {extras.map((row) => (
                      <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_6rem_2.5rem] items-center gap-1">
                        <span className="flex h-11 items-center truncate px-2 text-sm">{row.title}</span>
                        <span className="flex h-11 items-center justify-center">
                          <AfAmount value={amountNumber(row.amount)} />
                        </span>
                        <button
                          type="button"
                          className="grid size-11 place-items-center text-muted hover:text-danger"
                          aria-label="حذف ردیف"
                          onClick={() => setExtras((rows) => rows.filter((r) => r.key !== row.key))}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="text-sm text-muted">از نرخ دستمزد یا هزینه‌های متفرقه تولید انتخاب کنید</p>
                )}
              </div>
            )}
          </div>
          <Field label="یادداشت">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            ثبت
          </Button>
        </form>
      </Modal>
      {leave ? (
        <Modal open title="تغییرات ذخیره نشده است" onClose={() => setLeave(false)}>
          <p className="text-sm">تغییرات ذخیره نشده است.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setLeave(false);
                formRef.current?.requestSubmit();
              }}
            >
              ذخیره
            </Button>
            <Button
              type="button"
              onClick={() => {
                setLeave(false);
                onClose();
              }}
            >
              لغو ذخیره
            </Button>
          </div>
        </Modal>
      ) : null}
      <AddNameModal
        open={add === "name"}
        title="نام کالای جدید"
        onClose={() => setAdd(null)}
        onSave={async (n) => {
          setName(n);
          setEditId(undefined);
        }}
      />
      <AddNameModal
        open={add === "cat"}
        title="افزودن دسته‌بندی کالا"
        onClose={() => setAdd(null)}
        onSave={async (n) => {
          const res = await saveItemCategory({ data: { name: n, kind: "product" } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          setCategoryId(res.id);
        }}
      />
      <AddNameModal
        open={add === "unit"}
        title="افزودن واحد"
        onClose={() => setAdd(null)}
        onSave={async (n) => {
          const res = await saveUnit({ data: { name: n } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          setUnitId(res.id);
        }}
      />
      <AddNameModal
        open={add === "raw"}
        title="افزودن مواد خام"
        onClose={() => {
          setAdd(null);
          setRawTarget(null);
        }}
        onSave={async (n) => {
          const rawCats = (data?.catalogs.itemCategories ?? []).filter((c) => c.kind === "raw");
          const res = await saveItem({
            data: {
              name: n,
              kind: "raw",
              typeId: null,
              categoryId: rawCats[0]?.id ?? null,
              unitId: units[0]?.id ?? null,
            },
          });
          await refreshWarehouse();
          if (rawTarget) patchBom(rawTarget, { rawItemId: res.id });
        }}
      />
      {add === "wage" ? (
        <WageModal initialRows={null} rates={wageRates.data ?? []} onClose={() => setAdd(null)} />
      ) : null}
      {add === "overhead" ? <AddOverheadModal onClose={() => setAdd(null)} /> : null}
    </>
  );
}

function AddOverheadModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <Modal open title="افزودن هزینه تولید" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await saveProductionOverhead({ data: { title, amount: parseAmount(amount) } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          toast.success("ثبت شد");
          onClose();
        }}
      >
        <Field label="تشریح">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field label="مبلغ">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Button type="submit">ثبت</Button>
      </form>
    </Modal>
  );
}

export function RawForm({
  initial,
  defaultCategoryId,
  onClose,
}: {
  initial: StockCard | Item | null;
  defaultCategoryId: number | null;
  onClose: () => void;
}) {
  const { data } = useAppData();
  const cats = (data?.catalogs.itemCategories ?? []).filter((c) => c.kind === "raw");
  const units = data?.catalogs.units ?? [];
  const raws = (data?.catalogs.items ?? []).filter((i) => i.kind === "raw");
  const [editId, setEditId] = useState<number | undefined>(itemIdOf(initial));
  const [name, setName] = useState(initial?.name ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(initial?.categoryId ?? defaultCategoryId ?? cats[0]?.id ?? null);
  const [unitId, setUnitId] = useState<number | null>(initial?.unitId ?? units[0]?.id ?? null);
  const [minQty, setMinQty] = useState(emptyNum(initial?.minQty));
  const [salePrice, setSalePrice] = useState(emptyNum(initial?.salePrice));
  const [purchasePrice, setPurchasePrice] = useState(emptyNum(initial?.purchasePrice));
  const [add, setAdd] = useState<"cat" | "unit" | "name" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [leave, setLeave] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [stockQty, setStockQty] = useState("");
  const [notes, setNotes] = useState(() => {
    const id = itemIdOf(initial);
    return raws.find((i) => i.id === id)?.notes ?? "";
  });

  const nameOptions = useMemo(() => {
    const opts = raws.map((i) => ({ id: i.name, label: i.name }));
    if (name && !raws.some((i) => i.name === name)) opts.push({ id: name, label: name });
    return opts;
  }, [raws, name]);

  function requestClose() {
    if (dirty) {
      setLeave(true);
      return;
    }
    onClose();
  }

  return (
    <>
      <Modal open title={editId ? "ویرایش مواد خام" : "افزودن مواد خام"} onClose={requestClose}>
        <form
          ref={formRef}
          className="space-y-3"
          onChangeCapture={() => setDirty(true)}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              if (!name.trim()) throw new Error("نام لازم است");
              await saveCatalogItem({
                data: {
                  id: editId,
                  kind: "raw",
                  name,
                  categoryId,
                  unitId,
                  minQty: Math.max(0, amountNumber(minQty)),
                  salePrice: Math.max(0, amountNumber(salePrice)),
                  purchasePrice: Math.max(0, amountNumber(purchasePrice)),
                  notes,
                },
              });
              const addQty = amountNumber(stockQty);
              if (addQty > 0) {
                await saveOpeningStock({
                  data: {
                    kind: "raw",
                    itemName: name.trim(),
                    warehouseName: data?.catalogs.warehouses[0]?.name || "گدام اصلی",
                    quantity: addQty,
                    occurredOn: todayIso(),
                    notes: "",
                  },
                });
              }
              await refreshWarehouse();
              toast.success("ثبت شد");
              onClose();
            } catch (err) {
              setError(err instanceof Error ? err.message : "ثبت ناکام شد");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="نام مواد">
            <EntitySelect
              value={name || null}
              options={nameOptions}
              onChange={(id) => {
                setDirty(true);
                const n = id == null ? "" : String(id);
                setName(n);
                const found = raws.find((i) => i.name === n);
                if (found) {
                  setEditId(found.id);
                  setCategoryId(found.categoryId);
                  setUnitId(found.unitId);
                  setMinQty(emptyNum(found.minQty));
                  setSalePrice(emptyNum(found.salePrice));
                  setPurchasePrice(emptyNum(found.purchasePrice));
                  setNotes(found.notes ?? "");
                } else {
                  setEditId(undefined);
                  setNotes("");
                }
              }}
              onAdd={() => setAdd("name")}
            />
          </Field>
          <Field label="دسته‌بندی">
            <EntitySelect
              value={categoryId}
              options={cats.map((c) => ({ id: c.id, label: c.name }))}
              onChange={(id) => setCategoryId(id == null ? null : Number(id))}
              onAdd={() => setAdd("cat")}
            />
          </Field>
          <Field label="واحد">
            <EntitySelect
              value={unitId}
              options={units.map((u) => ({ id: u.id, label: u.name }))}
              onChange={(id) => setUnitId(id == null ? null : Number(id))}
              onAdd={() => setAdd("unit")}
            />
          </Field>
          <Field label="قیمت خرید">
            <MoneyInput value={purchasePrice} onChange={setPurchasePrice} />
          </Field>
          <Field label="قیمت فروش">
            <MoneyInput value={salePrice} onChange={setSalePrice} />
          </Field>
          <Field label="هشدار حداقل موجودی">
            <MoneyInput value={minQty} onChange={setMinQty} />
          </Field>
          <Field label="موجودی اولیه">
            <MoneyInput value={stockQty} onChange={setStockQty} />
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
      {leave ? (
        <Modal open title="تغییرات ذخیره نشده است" onClose={() => setLeave(false)}>
          <p className="text-sm">تغییرات ذخیره نشده است.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setLeave(false);
                formRef.current?.requestSubmit();
              }}
            >
              ذخیره
            </Button>
            <Button
              type="button"
              onClick={() => {
                setLeave(false);
                onClose();
              }}
            >
              لغو ذخیره
            </Button>
          </div>
        </Modal>
      ) : null}
      <AddNameModal
        open={add === "name"}
        title="نام مواد خام جدید"
        onClose={() => setAdd(null)}
        onSave={async (n) => {
          setName(n);
          setEditId(undefined);
        }}
      />
      <AddNameModal
        open={add === "cat"}
        title="افزودن دسته‌بندی مواد خام"
        onClose={() => setAdd(null)}
        onSave={async (n) => {
          const res = await saveItemCategory({ data: { name: n, kind: "raw" } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          setCategoryId(res.id);
        }}
      />
      <AddNameModal
        open={add === "unit"}
        title="افزودن واحد"
        onClose={() => setAdd(null)}
        onSave={async (n) => {
          const res = await saveUnit({ data: { name: n } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          setUnitId(res.id);
        }}
      />
    </>
  );
}


export function WorkOrderForm({
  products,
  rawStock,
  bomByProduct,
  initial,
  onClose,
}: {
  products: StockCard[];
  rawStock: StockCard[];
  bomByProduct: Record<number, BomLine[]>;
  initial?: WorkOrder | null;
  onClose: () => void;
}) {
  const { data } = useAppData();
  const cal = useCalendarMode();
  const workers = (data?.catalogs.parties ?? []).filter(
    (p) => p.kind === "worker" && p.employment !== "salaried",
  );
  const [workerId, setWorkerId] = useState<number | null>(
    initial?.workerId ?? workers[0]?.id ?? null,
  );
  const [productId, setProductId] = useState<number | null>(initial?.productId ?? products[0]?.itemId ?? null);
  const [quantity, setQuantity] = useState(emptyNum(initial?.quantity));
  const [occurredOn, setOccurredOn] = useState(initial?.occurredOn || todayIso());
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [addWorker, setAddWorker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const qty = amountNumber(quantity);
  const bom = productId ? (bomByProduct[productId] ?? []) : [];
  const lockedProduct = Boolean(initial && initial.deliveredQty > 1e-9);
  const needs = useMemo(
    () =>
      bom.map((line) => {
        const need = line.quantity * qty;
        const extra =
          initial && productId === initial.productId ? line.quantity * initial.remaining : 0;
        const have = (rawStock.find((r) => r.itemId === line.rawItemId)?.qty ?? 0) + extra;
        return { ...line, need, have, ok: have + 1e-9 >= need };
      }),
    [bom, qty, rawStock, initial, productId],
  );

  return (
    <>
      <Modal open title={initial ? `ویرایش سفارش ${initial.invoiceNo}` : "سفارش کار جدید"} onClose={onClose} wide>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              if (!productId) throw new Error("کالا را انتخاب کنید");
              if (qty <= 0) throw new Error("تعداد سفارش باید بزرگ‌تر از صفر باشد");
              if (!needs.length) throw new Error("فرمول مواد خام این کالا ثبت نشده است");
              const missing = needs.filter((n) => !n.ok);
              if (missing.length) {
                throw new Error(
                  `مواد خام کافی نیست: ${missing.map((n) => `${n.rawItemName} (موجود ${formatMoney(n.have)}، لازم ${formatMoney(n.need)})`).join("؛ ")}`,
                );
              }
              if (initial) {
                await updateWorkOrder({
                  data: {
                    id: initial.id,
                    workerId,
                    productId,
                    quantity: qty,
                    occurredOn,
                    notes,
                    invoiceNo: weekInvoiceNo(occurredOn, cal),
                  },
                });
                toast.success("سفارش ویرایش شد");
              } else {
                await createWorkOrder({
                  data: {
                    workerId,
                    productId,
                    quantity: qty,
                    occurredOn,
                    notes,
                    invoiceNo: weekInvoiceNo(occurredOn, cal),
                  },
                });
                toast.success("سفارش ثبت شد و مواد به نزد کارگران منتقل شد");
              }
              await refreshWarehouse();
              onClose();
            } catch (err) {
              setError(err instanceof Error ? err.message : "ثبت ناکام شد");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="کارگر">
              <EntitySelect
                value={workerId}
                options={workers.map((w) => ({
                  id: w.id,
                  label: w.name,
                }))}
                onChange={(id) => setWorkerId(id == null ? null : Number(id))}
                onAdd={() => setAddWorker(true)}
              />
            </Field>
            <Field label="کالای تولیدشده">
              <EntitySelect
                value={productId}
                options={products.map((p) => ({ id: p.itemId, label: p.name }))}
                onChange={(id) => setProductId(id == null ? null : Number(id))}
                disabled={lockedProduct}
              />
            </Field>
            <Field label="تعداد">
              <MoneyInput value={quantity} onChange={setQuantity} />
            </Field>
            <Field label="تاریخ">
              <DateField value={occurredOn} onChange={setOccurredOn} />
            </Field>
          </div>
          <Field label="یادداشت">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {productId ? (
            <div className="rounded-sm border border-border bg-surface-2 p-3">
              <p className="mb-2 text-2xs font-medium text-muted">مواد خام لازم از گدام مواد خام</p>
              {needs.length ? (
                <ul className="space-y-1.5">
                  {needs.map((n) => (
                    <li key={n.rawItemId} className={cn("text-sm", n.ok ? "" : "text-danger")}>
                      {n.rawItemName}: لازم {formatMoney(n.need)}
                      {n.unitName ? ` ${n.unitName}` : ""} — موجود {formatMoney(n.have)}
                      {n.ok ? "" : " (ناکافی)"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-danger">فرمول مواد خام این کالا ثبت نشده است</p>
              )}
            </div>
          ) : null}
          {error ? <p className="whitespace-pre-line text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {initial ? "ذخیره" : "ثبت سفارش"}
          </Button>
        </form>
      </Modal>
      {addWorker ? (
        <PartyFormModal
          kind="worker"
          initial={null}
          defaultEmployment="contract"
          onClose={() => setAddWorker(false)}
          onSaved={(id) => {
            setWorkerId(id);
            setAddWorker(false);
          }}
        />
      ) : null}
    </>
  );
}

export function DeliveryForm({
  order,
  onClose,
}: {
  order: WorkOrder;
  workerStock?: StockCard[];
  bomByProduct?: Record<number, BomLine[]>;
  onClose: () => void;
}) {
  const { data } = useAppData();
  const cal = useCalendarMode();
  const givers = useQuery({
    queryKey: ["prior-givers", order.workerId, order.productId],
    queryFn: () =>
      listPriorProductGivers({ data: { workerId: order.workerId ?? 0, productId: order.productId } }),
    enabled: order.workerId != null,
  });
  const blocked = new Set(givers.data ?? []);
  const others = (data?.catalogs.parties ?? []).filter(
    (p) =>
      p.kind === "worker" &&
      p.employment !== "salaried" &&
      p.id !== order.workerId &&
      !blocked.has(p.id) &&
      (order.workerId == null || givers.isSuccess),
  );
  const warehouses = (data?.catalogs.warehouses ?? []).filter((w) => {
    if (w.shopOnly) return false;
    if (w.name === "گدام مواد خام" || w.name === "مواد نزد کارگران") return false;
    return true;
  });
  const warehouseChoices = warehouses.length
    ? warehouses
    : [{ id: 0, name: "گدام کالای تولید شده" }];
  const options = [
    ...others.map((w) => ({ id: `worker:${w.id}`, label: w.name })),
    ...warehouseChoices.map((w) => ({ id: `wh:${w.id}`, label: w.name })),
  ];
  const [quantity, setQuantity] = useState(String(order.remaining));
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [dest, setDest] = useState<string | null>(options[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const qty = amountNumber(quantity);
  const toWarehouse = typeof dest === "string" && dest.startsWith("wh:");

  return (
    <Modal
      open
      title={`ثبت تحویل — ${order.productName}`}
      onClose={onClose}
    >
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (qty <= 0) throw new Error("تعداد تحویل باید بزرگ‌تر از صفر باشد");
            if (!dest) throw new Error("مرحله بعد را انتخاب کنید");
            const workerId = dest.startsWith("worker:") ? Number(dest.slice(7)) : null;
            await deliverWorkOrder({
              data: {
                id: order.id,
                quantity: qty,
                occurredOn,
                notes,
                toWorkerId: toWarehouse ? null : workerId,
                toWarehouse,
                invoiceNo: weekInvoiceNo(occurredOn, cal),
              },
            });
            await refreshWarehouse();
            toast.success(toWarehouse ? "به گدام تحویل شد" : "تحویل به مرحله بعد ثبت شد");
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "ثبت ناکام شد");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-muted">
          تحویل‌دهنده: <span className="text-fg">{order.workerName || "—"}</span>
        </p>
        <p className="text-sm text-muted">
          باقی‌مانده نزد این کارگر: <span className="tabular-nums text-fg">{formatMoney(order.remaining)}</span>
          {order.stageName ? ` — ${order.stageName}` : ""}
        </p>
        <Field label="تعداد تحویل">
          <MoneyInput value={quantity} onChange={setQuantity} />
        </Field>
        <Field label="تحویل به مرحله بعد">
          <EntitySelect
            value={dest}
            options={options}
            onChange={(id) => setDest(id == null ? null : String(id))}
          />
        </Field>
        <Field label="تاریخ">
          <DateField value={occurredOn} onChange={setOccurredOn} />
        </Field>
        <Field label="یادداشت">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error ? <p className="whitespace-pre-line text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy}>
          ثبت تحویل
        </Button>
      </form>
    </Modal>
  );
}

export function WorkOrderList({
  orders,
  writable,
  onDeliver,
  onEdit,
  onDelete,
  focusOrderId,
}: {
  orders: WorkOrder[];
  writable: boolean;
  onDeliver: (order: WorkOrder) => void;
  onEdit?: (order: WorkOrder) => void;
  onDelete?: (order: WorkOrder) => void;
  focusOrderId?: number | null;
}) {
  if (!orders.length) return <p className="mb-4 text-sm text-muted">سفارش کاری ثبت نشده است</p>;
  return (
    <ul className="mb-6 space-y-2">
      {orders.map((o) => (
        <li
          key={o.id}
          ref={focusOrderId === o.id ? (el) => el?.scrollIntoView({ block: "center", behavior: "smooth" }) : undefined}
          className={cn(
            "rounded-md border border-border bg-surface px-3 py-2.5",
            focusOrderId === o.id && "ring-2 ring-primary",
          )}
        >
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[44rem] items-center gap-3 text-center"
              style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr)) 8.5rem" }}
            >
              <div className="min-w-0 truncate text-sm font-semibold">{o.productName}</div>
              <span className="min-w-0 truncate text-2xs text-muted">{o.workerName || "بدون کارگر"}</span>
              <span className="truncate text-2xs tabular-nums text-muted">
                {formatMoney(o.deliveredQty)} از {formatMoney(o.quantity)}
              </span>
              <span className="truncate text-2xs tabular-nums text-muted">
                {o.remaining > 1e-9 ? `باقی ${formatMoney(o.remaining)}` : "کامل"}
              </span>
              <span className="truncate text-2xs text-muted">
                <DateText iso={o.occurredOn} />
              </span>
              <span className="flex items-center justify-center gap-1">
                <span className="shrink-0 text-2xs font-medium tabular-nums text-muted" dir="ltr">
                  {o.invoiceNo}
                </span>
                {writable && onEdit ? <IconBtn kind="edit" onClick={() => onEdit(o)} /> : null}
                {writable && onDelete && o.deliveredQty < 1e-9 ? (
                  <IconBtn kind="delete" onClick={() => onDelete(o)} />
                ) : null}
                {o.remaining > 1e-9 && writable && !o.isLastStage ? (
                  <Button variant="secondary" className="h-8 px-2 text-2xs" onClick={() => onDeliver(o)}>
                    ثبت تحویل
                  </Button>
                ) : null}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function WorkerRawCards({ cards, focusItemId }: { cards: StockCard[]; focusItemId?: number | null }) {
  const [open, setOpen] = useState(false);
  const held = [...cards.filter((c) => c.qty > 1e-9)].sort((a, b) => compareFaName(a.name, b.name));
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1">
        <h2 className="text-sm font-semibold text-muted">مواد نزد کارگران</h2>
        <ChevronDown className={cn("size-3.5 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <StockSheet tone="c" costLabel="قیمت خرید" aligned>
          {held.length ? (
            held.map((card) => (
              <StockCardView
                key={card.itemId}
                card={card}
                costLabel="قیمت خرید"
                writable={false}
                aligned
                highlight={focusItemId === card.itemId}
              />
            ))
          ) : (
            <p className="px-2 py-3 text-sm text-muted">مواد نزد کارگران نیست</p>
          )}
        </StockSheet>
      ) : null}
    </div>
  );
}

export function CategoryModals({
  addOpen,
  edit,
  del,
  kind,
  onCloseAdd,
  onCloseEdit,
  onCloseDel,
}: {
  addOpen: boolean;
  edit: ItemCategory | null;
  del: ItemCategory | null;
  kind: Item["kind"];
  onCloseAdd: () => void;
  onCloseEdit: () => void;
  onCloseDel: () => void;
}) {
  return (
    <>
      <AddNameModal
        open={addOpen}
        title={kind === "product" ? "افزودن دسته‌بندی کالا" : "افزودن دسته‌بندی مواد خام"}
        onClose={onCloseAdd}
        onSave={async (name) => {
          await saveItemCategory({ data: { name, kind } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
      <AddNameModal
        open={Boolean(edit)}
        title="ویرایش دسته‌بندی"
        initial={edit?.name ?? ""}
        onClose={onCloseEdit}
        onSave={async (name) => {
          if (!edit) return;
          await saveItemCategory({ data: { id: edit.id, name, kind } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
      <ConfirmDelete
        open={Boolean(del)}
        title="حذف دسته‌بندی"
        message="این دسته‌بندی حذف شود؟ کالاهای آن بدون دسته می‌مانند."
        onClose={onCloseDel}
        onConfirm={async () => {
          if (!del) return;
          await deleteItemCategory({ data: { id: del.id } });
          await refreshWarehouse();
          toast.success("حذف شد");
        }}
      />
    </>
  );
}
