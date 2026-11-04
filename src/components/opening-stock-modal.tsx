import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AddNameModal } from "@/components/add-name-modal";
import { DateField } from "@/components/date-picker";
import { EntitySelect } from "@/components/entity-select";
import { AfAmount } from "@/components/invoice-ui";
import { useAppData } from "@/components/layout/app-shell";
import { MoneyInput, amountNumber } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { lastRawPurchaseRate, saveOpeningStock } from "@/lib/api/finance";
import { getInventory } from "@/lib/api/inventory";
import { saveItem, saveWarehouse } from "@/lib/api/setup";
import { emptyNum, formatMoney, todayIso } from "@/lib/format";
import { queryClient } from "@/lib/query-client";
import type { OpeningStock } from "@/lib/types";
import { cn } from "@/lib/utils";

export function OpeningStockModal({
  kind,
  initial,
  initialItemName,
  onClose,
}: {
  kind: "finished" | "raw";
  initial: OpeningStock | null;
  initialItemName?: string;
  onClose: () => void;
}) {
  const { data } = useAppData();
  const inv = useQuery({ queryKey: ["inventory"], queryFn: () => getInventory() });
  const items = (data?.catalogs.items ?? []).filter((i) => (kind === "raw" ? i.kind === "raw" : i.kind === "product"));
  const [itemName, setItemName] = useState(initial?.itemName ?? initialItemName ?? items[0]?.name ?? "");
  const production = data?.settings.productionEnabled !== false;
  const warehouses = (data?.catalogs.warehouses ?? []).filter((w) => {
    if (production) return true;
    if (w.name === "گدام کالای تولید شده" || w.name === "گدام مواد خام" || w.name === "مواد نزد کارگران") return false;
    return w.shopOnly === true;
  });
  const [warehouseName, setWh] = useState(initial?.warehouseName ?? warehouses[0]?.name ?? "");
  const [qty, setQty] = useState(emptyNum(initial ? Math.abs(initial.quantity) : undefined));
  const [dir, setDir] = useState<"add" | "sub">(initial && initial.quantity < 0 ? "sub" : "add");
  const [date, setDate] = useState(initial?.occurredOn || todayIso());
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [addItem, setAddItem] = useState(false);
  const [addWh, setAddWh] = useState(false);
  const [error, setError] = useState("");

  const catalogItem = items.find((i) => i.name === itemName);
  const lastBuy = useQuery({
    queryKey: ["last-raw-buy", itemName],
    queryFn: () => lastRawPurchaseRate({ data: { itemName } }),
    enabled: kind === "raw" && Boolean(itemName),
  });
  const stockCard =
    kind === "raw"
      ? inv.data?.raw.find((p) => p.name === itemName)
      : inv.data?.products.find((p) => p.name === itemName);
  const onHand = stockCard?.qty ?? 0;
  const unitCost =
    kind === "raw"
      ? lastBuy.data?.rate || catalogItem?.purchasePrice || 0
      : (stockCard?.unitCost ?? catalogItem?.purchasePrice ?? 0);
  const qtyNum = amountNumber(qty);
  const signedQty = dir === "sub" ? -qtyNum : qtyNum;
  const estValue = signedQty * unitCost;
  const nextQty = onHand - (initial?.quantity ?? 0) + signedQty;

  return (
    <>
      <Modal open title={kind === "finished" ? "تعدیل کالای تولید شده" : "تعدیل مواد خام"} onClose={onClose}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              if (!itemName.trim()) throw new Error("نام لازم است");
              if (qtyNum <= 0) throw new Error("مقدار باید بزرگ‌تر از صفر باشد");
              if (dir === "sub" && qtyNum > onHand - (initial?.quantity ?? 0) + 1e-9) {
                throw new Error("موجودی کافی نیست");
              }
              await saveOpeningStock({
                data: {
                  id: initial?.id,
                  kind,
                  itemName,
                  warehouseName,
                  quantity: signedQty,
                  occurredOn: date,
                  notes,
                },
              });
              await queryClient.invalidateQueries({ queryKey: ["opening-stock"] });
              await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
              await queryClient.invalidateQueries({ queryKey: ["inventory"] });
              await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
              await queryClient.invalidateQueries({ queryKey: ["warehouse-stock"] });
              onClose();
              toast.success("تعدیل موجودی ثبت شد");
            } catch (err) {
              setError(err instanceof Error ? err.message : "ثبت ناکام شد");
            }
          }}
        >
          <Field label="نام">
            <EntitySelect
              value={itemName}
              options={(items.length ? items : data?.catalogs.items ?? []).map((i) => ({ id: i.name, label: i.name }))}
              onChange={(id) => setItemName(id == null ? "" : String(id))}
              onAdd={() => setAddItem(true)}
            />
          </Field>
          <Field label="گدام">
            <EntitySelect
              value={warehouseName}
              options={warehouses.map((w) => ({ id: w.name, label: w.name }))}
              onChange={(id) => setWh(id == null ? "" : String(id))}
              onAdd={() => setAddWh(true)}
            />
          </Field>
          <Field label="مقدار">
            <MoneyInput value={qty} onChange={setQty} />
          </Field>
          <Field label="نوع تعدیل">
            <div className="grid grid-cols-2 rounded-md border border-border bg-surface-2 p-1">
              <button
                type="button"
                onClick={() => setDir("add")}
                className={cn(
                  "rounded-sm px-3 py-2 text-sm font-medium",
                  dir === "add" ? "bg-surface text-fg shadow-sm" : "text-muted",
                )}
              >
                افزوده شود
              </button>
              <button
                type="button"
                onClick={() => setDir("sub")}
                className={cn(
                  "rounded-sm px-3 py-2 text-sm font-medium",
                  dir === "sub" ? "bg-surface text-fg shadow-sm" : "text-muted",
                )}
              >
                کسر شود
              </button>
            </div>
          </Field>
          <div className="rounded-sm border border-border bg-surface-2 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-micro text-muted">
              <span>موجودی فعلی گدام</span>
              <span className="tabular-nums">{formatMoney(onHand)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-micro text-muted">
              <span>موجودی پس از تعدیل</span>
              <span className="tabular-nums">{formatMoney(nextQty)}</span>
            </div>
            {kind === "raw" ? (
              <div className="mt-1 flex items-center justify-between gap-2 text-micro text-muted">
                <span>ارزش = مقدار × آخرین نرخ خرید</span>
                <span className="tabular-nums">آخرین نرخ {formatMoney(unitCost)} ؋</span>
              </div>
            ) : (
              <div className="mt-1 flex items-center justify-between gap-2 text-micro text-muted">
                <span>ارزش = مقدار × قیمت تمام‌شد</span>
                <span className="tabular-nums">{formatMoney(unitCost)} ؋</span>
              </div>
            )}
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-micro tabular-nums text-muted">
                {dir === "sub" ? "−" : ""}
                {formatMoney(qtyNum)} × {formatMoney(unitCost)}
              </span>
              <AfAmount value={Math.abs(estValue)} size="sm" />
            </div>
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
        open={addItem}
        title="افزودن کالا"
        onClose={() => setAddItem(false)}
        onSave={async (name) => {
          await saveItem({
            data: { name, kind: kind === "raw" ? "raw" : "product", typeId: null, categoryId: null, unitId: null },
          });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          setItemName(name);
        }}
      />
      <AddNameModal
        open={addWh}
        title="افزودن گدام"
        onClose={() => setAddWh(false)}
        onSave={async (name) => {
          await saveWarehouse({ data: { name } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          setWh(name);
        }}
      />
    </>
  );
}
