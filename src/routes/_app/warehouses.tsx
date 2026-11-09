import { toast } from "sonner";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ConfirmAccountantReset } from "@/components/confirm-accountant";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Guard } from "@/components/guard";
import { SectionTabs } from "@/components/invoice-ui";
import { useAppData } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  CategoryBar,
  CategoryGroups,
  CategoryModals,
  DeliveryForm,
  ProductForm,
  RawForm,
  WorkerRawCards,
  WorkOrderList,
  refreshWarehouse,
} from "@/components/warehouse-ui";
import { deleteCatalogItem, deleteWorkOrder, getInventory, listWorkOrders, resetWorkerMaterials, saveCatalogItem } from "@/lib/api/inventory";
import { getWarehouseStock } from "@/lib/api/invoices";
import { saveOpeningStock } from "@/lib/api/finance";
import { saveItemCategory, saveUnit } from "@/lib/api/setup";
import { todayIso } from "@/lib/format";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import type { BomLine, ItemCategory, ItemOverhead, StockCard, WorkOrder } from "@/lib/types";
import { clearUsageFocus, onUsageFocus, peekUsageFocus } from "@/lib/usage-focus";
import { WarehouseNames, shopWarehouseCards } from "@/shop/warehouse-names";
import {
  asBackupNumber as asNumber,
  asBackupText as asText,
  parseWarehouseBackup,
  type WarehouseBackupBom as BackupBom,
  type WarehouseBackupItem as BackupItem,
  type WarehouseBackupSection as BackupSection,
} from "@/lib/warehouse-backup";

export const Route = createFileRoute("/_app/warehouses")({ component: Page });

type Tab = "product" | "raw" | "worker";

function Page() {
  return (
    <Guard area="warehouses">
      <Warehouses />
    </Guard>
  );
}

function Warehouses() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "warehouses");
  const production = data?.settings.productionEnabled !== false;
  const inv = useQuery({ queryKey: ["inventory"], queryFn: () => getInventory() });
  const orders = useQuery({ queryKey: ["work-orders"], queryFn: () => listWorkOrders() });
  const [tab, setTab] = useState<Tab>(production ? "product" : "raw");
  const [catFilter, setCatFilter] = useState<{ product: number | "all"; raw: number | "all"; worker: number | "all" }>({
    product: "all",
    raw: "all",
    worker: "all",
  });
  const [addCat, setAddCat] = useState(false);
  const [editCat, setEditCat] = useState<ItemCategory | null>(null);
  const [delCat, setDelCat] = useState<ItemCategory | null>(null);
  const [productForm, setProductForm] = useState<StockCard | "new" | null>(null);
  const [rawForm, setRawForm] = useState<StockCard | "new" | null>(null);
  const [delItem, setDelItem] = useState<StockCard | null>(null);
  const [deliver, setDeliver] = useState<WorkOrder | null>(null);
  const [delOrder, setDelOrder] = useState<WorkOrder | null>(null);
  const [resetWorker, setResetWorker] = useState(false);
  const [qName, setQName] = useState("");
  const [focusItemId, setFocusItemId] = useState<number | null>(null);
  const [focusOrderId, setFocusOrderId] = useState<number | null>(null);
  const [shopWh, setShopWh] = useState<string | null>(null);
  const whStock = useQuery({
    queryKey: ["warehouse-stock"],
    queryFn: () => getWarehouseStock(),
    enabled: !production,
  });

  useEffect(() => {
    if (!production && (tab === "product" || tab === "worker")) setTab("raw");
  }, [production, tab]);

  useEffect(() => {
    function apply() {
      const f = peekUsageFocus();
      if (!f || f.page !== "warehouses") return;
      if (f.tab === "product" || f.tab === "raw" || f.tab === "worker") setTab(f.tab);
      if (f.query) setQName(f.query);
      setFocusItemId(f.itemId ?? null);
      setFocusOrderId(f.orderId ?? null);
      clearUsageFocus();
    }
    apply();
    return onUsageFocus(apply);
  }, []);

  const productCats = (data?.catalogs.itemCategories ?? []).filter((c) => c.kind === "product");
  const rawCats = (data?.catalogs.itemCategories ?? []).filter((c) => c.kind === "raw");
  const stock = inv.data;
  const filter = catFilter[tab];
  const catKind: "product" | "raw" = tab === "product" ? "product" : "raw";

  function filterCards(cards: StockCard[]) {
    const n = qName.trim().toLocaleLowerCase();
    if (!n) return cards;
    return cards.filter((card) => card.name.toLocaleLowerCase().includes(n));
  }

  function onAdd() {
    if (tab === "product") setProductForm("new");
    else if (tab === "raw") setRawForm("new");
  }

  return (
    <div>
      <PageHeader
        title={production ? "گدام‌ها (تولیدی)" : "گدام‌ها (فروشگاهی)"}
        titleClass="text-2xl font-bold"
        canAdd={writable && tab !== "worker"}
        onAdd={onAdd}
      />
      <div className="mb-4">
        {production ? (
        <SectionTabs
          fill
          contrast
          labelClass="h-12 text-base font-bold sm:text-lg"
          className="mb-0"
          value={tab}
          onChange={(id) => {
            setTab(id);
            setQName("");
            setAddCat(false);
            setEditCat(null);
            setDelCat(null);
          }}
          tabs={[
            { id: "product" as const, label: "گدام کالای تولید شده", color: "a" as const },
            { id: "raw" as const, label: "گدام مواد خام", color: "b" as const },
            { id: "worker" as const, label: "مواد نزد کارگران", color: "c" as const },
          ]}
        />
        ) : (
          <WarehouseNames writable={writable} production={production} onSelect={setShopWh} />
        )}
      </div>

      {tab === "product" ? (
        <div>
          {inv.isPending ? (
            <div className="h-40 animate-pulse rounded-md bg-border/60" />
          ) : (
            <>
              <CategoryGroups
                bar={
                  <CategoryBar
                    className="mb-2"
                    categories={productCats}
                    value={catFilter.product}
                    onChange={(id) => setCatFilter((f) => ({ ...f, product: id }))}
                    writable={writable}
                    canEdit
                    onAdd={() => setAddCat(true)}
                    onEdit={(c) => setEditCat(productCats.find((x) => x.id === c.id) ?? null)}
                    onDelete={(c) => setDelCat(productCats.find((x) => x.id === c.id) ?? null)}
                    end={
                      <div className="flex shrink-0 items-center gap-1">
                        <WarehouseBackup
                          section="product"
                          cards={stock?.products ?? []}
                          bomByProduct={stock?.bomByProduct}
                          overheadsByProduct={stock?.overheadsByProduct}
                          writable={writable}
                        />
                        <WarehouseSearch value={qName} onChange={setQName} />
                      </div>
                    }
                  />
                }
                cards={filterCards(stock?.products ?? [])}
                categories={productCats}
                filter={filter}
                costLabel="قیمت تمام شد"
                writable={writable}
                emptyText="کالای تولیدشده‌ای ثبت نشده است"
                onEdit={(c) => setProductForm(c)}
                onDelete={(c) => setDelItem(c)}
                bomByProduct={stock?.bomByProduct}
                focusItemId={focusItemId}
                tone="a"
                aligned
              />
            </>
          )}
        </div>
      ) : null}

      {tab === "raw" ? (
        <div>
          {inv.isPending ? (
            <div className="h-40 animate-pulse rounded-md bg-border/60" />
          ) : (
            <>
              <CategoryGroups
                bar={
                  <CategoryBar
                    className="mb-2"
                    categories={rawCats}
                    value={catFilter.raw}
                    onChange={(id) => setCatFilter((f) => ({ ...f, raw: id }))}
                    writable={writable}
                    onAdd={() => setAddCat(true)}
                    onDelete={(c) => setDelCat(rawCats.find((x) => x.id === c.id) ?? null)}
                    end={
                      <div className="flex shrink-0 items-center gap-1">
                        <WarehouseBackup section="raw" cards={stock?.raw ?? []} writable={writable} />
                        <WarehouseSearch value={qName} onChange={setQName} />
                      </div>
                    }
                  />
                }
                cards={filterCards(production ? (stock?.raw ?? []) : shopWarehouseCards(stock?.raw ?? [], shopWh, whStock.data))}
                categories={rawCats}
                filter={filter}
                costLabel="قیمت خرید"
                writable={writable}
                emptyText="مواد خامی ثبت نشده است"
                onEdit={(c) => setRawForm(c)}
                onDelete={(c) => setDelItem(c)}
                focusItemId={focusItemId}
                tone="b"
                aligned={production}
              />
            </>
          )}
        </div>
      ) : null}

      {tab === "worker" ? (
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            {writable ? (
              <Button variant="danger" onClick={() => setResetWorker(true)}>
                ریست مواد نزد کارگران
              </Button>
            ) : (
              <span />
            )}
            <WarehouseSearch value={qName} onChange={setQName} />
          </div>
          <WorkOrderList
            orders={(orders.data ?? []).filter((o) => {
              if (o.remaining <= 1e-9) return false;
              const n = qName.trim().toLocaleLowerCase();
              if (!n) return true;
              return o.productName.toLocaleLowerCase().includes(n) || o.workerName.toLocaleLowerCase().includes(n);
            })}
            writable={writable}
            onDeliver={setDeliver}
            onDelete={setDelOrder}
            focusOrderId={focusOrderId}
          />
          {inv.isPending ? (
            <div className="h-40 animate-pulse rounded-md bg-border/60" />
          ) : (
            <WorkerRawCards cards={filterCards(stock?.workerRaw ?? [])} focusItemId={focusItemId} />
          )}
        </div>
      ) : null}

      <CategoryModals
        addOpen={addCat}
        edit={editCat}
        del={delCat}
        kind={catKind}
        onCloseAdd={() => setAddCat(false)}
        onCloseEdit={() => setEditCat(null)}
        onCloseDel={() => setDelCat(null)}
      />
      {productForm ? (
        <ProductForm
          initial={productForm === "new" ? null : productForm}
          bomLines={
            productForm === "new" ? [] : (stock?.bomByProduct[productForm.itemId] ?? [])
          }
          defaultCategoryId={typeof catFilter.product === "number" ? catFilter.product : null}
          onClose={() => setProductForm(null)}
        />
      ) : null}
      {rawForm ? (
        <RawForm
          initial={rawForm === "new" ? null : rawForm}
          defaultCategoryId={typeof catFilter.raw === "number" ? catFilter.raw : null}
          onClose={() => setRawForm(null)}
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
        open={Boolean(delItem)}
        onClose={() => setDelItem(null)}
        onConfirm={async () => {
          if (!delItem) return;
          await deleteCatalogItem({ data: { id: delItem.itemId } });
          await refreshWarehouse();
          toast.success("حذف شد");
        }}
      />
      <ConfirmDelete
        open={Boolean(delOrder)}
        onClose={() => setDelOrder(null)}
        onConfirm={async () => {
          if (!delOrder) return;
          await deleteWorkOrder({ data: { id: delOrder.id } });
          await refreshWarehouse();
          toast.success("حذف شد");
        }}
      />
      <ConfirmAccountantReset
        open={resetWorker}
        title="ریست مواد نزد کارگران"
        message="تمام سفارش‌ها، تحویل‌ها و تاریخچه مواد نزد کارگران پاک می‌شود. برای تأیید، کد نقش حسابدار را وارد کنید."
        confirmLabel="پاک کردن تاریخچه"
        onClose={() => setResetWorker(false)}
        onConfirm={async (code) => {
          await resetWorkerMaterials({ data: { code } });
          await refreshWarehouse();
          toast.success("تاریخچه مواد نزد کارگران پاک شد");
        }}
      />
    </div>
  );
}

function WarehouseBackup({
  section,
  cards,
  bomByProduct,
  overheadsByProduct,
  writable,
}: {
  section: BackupSection;
  cards: StockCard[];
  bomByProduct?: Record<number, BomLine[]>;
  overheadsByProduct?: Record<number, ItemOverhead[]>;
  writable: boolean;
}) {
  const { data } = useAppData();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const title = section === "product" ? "گدام کالای تولید شده" : "گدام مواد خام";

  function exportFile() {
    const items = data?.catalogs.items ?? [];
    const raws = items.filter((item) => item.kind === "raw");
    const payload = {
      app: "hesabdar",
      type: "hesabdar-warehouse",
      section,
      warehouse: section,
      items: cards.map((card) => {
        const notes = items.find((item) => item.id === card.itemId)?.notes ?? "";
        const row: BackupItem = {
          name: card.name,
          category: card.categoryName || "",
          unit: card.unitName || "",
          minQty: card.minQty,
          salePrice: card.salePrice,
          purchasePrice: card.purchasePrice,
          qty: card.qty,
          notes,
        };
        if (section === "product") {
          row.bom = (bomByProduct?.[card.itemId] ?? []).map((line) => ({
            name: line.rawItemName,
            quantity: line.quantity,
            unit: line.unitName || "",
            purchasePrice: raws.find((item) => item.id === line.rawItemId)?.purchasePrice ?? 0,
          }));
          row.overheads = (overheadsByProduct?.[card.itemId] ?? []).map((row) => ({
            title: row.title,
            amount: row.amount,
          }));
        }
        return {
          ...row,
          kind: section,
          bom: row.bom ?? [],
          "حداقل موجودی": card.minQty,
          ...(section === "raw" ? { "قیمت خرید": card.purchasePrice } : {}),
        };
      }),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("فایل بک‌آپ ذخیره شد");
  }

  async function importFile(file: File) {
    const text = await file.text();
    const parsed = parseWarehouseBackup(text, section);
    const rows = parsed.items;
    const catalogs = data?.catalogs;
    const categories = [...(catalogs?.itemCategories ?? [])];
    const units = [...(catalogs?.units ?? [])];
    const items = [...(catalogs?.items ?? [])];
    const warehouseName = catalogs?.warehouses[0]?.name || "گدام اصلی";

    async function categoryId(name: string, kind: BackupSection) {
      const label = name.trim();
      if (!label) return null;
      const found = categories.find((row) => row.kind === kind && row.name === label);
      if (found) return found.id;
      const saved = await saveItemCategory({ data: { name: label, kind } });
      categories.push({ id: saved.id, name: label, kind });
      return saved.id;
    }

    async function unitId(name: string) {
      const label = name.trim();
      if (!label) return null;
      const found = units.find((row) => row.name === label);
      if (found) return found.id;
      const saved = await saveUnit({ data: { name: label } });
      units.push({ id: saved.id, name: label });
      return saved.id;
    }

    async function ensureRaw(line: BackupBom) {
      const name = asText(line.name);
      if (!name) throw new Error("نام ماده خام در فرمول خالی است");
      const found = items.find((item) => item.kind === "raw" && item.name === name);
      if (found) return found.id;
      const id = (
        await saveCatalogItem({
          data: {
            kind: "raw",
            name,
            categoryId: null,
            unitId: await unitId(asText(line.unit)),
            minQty: 0,
            salePrice: 0,
            purchasePrice: Math.max(0, asNumber(line.purchasePrice)),
            notes: "",
          },
        })
      ).id;
      items.push({
        id,
        name,
        typeId: null,
        typeName: "",
        categoryId: null,
        categoryName: "",
        unitId: null,
        unitName: asText(line.unit),
        kind: "raw",
        image: null,
        minQty: 0,
        salePrice: 0,
        purchasePrice: Math.max(0, asNumber(line.purchasePrice)),
        notes: "",
      });
      return id;
    }

    let count = 0;
    for (const row of rows) {
      const name = asText(row.name);
      if (!name) continue;
      const existing = items.find((item) => item.kind === section && item.name === name);
      const bom =
        section === "product"
          ? await (async () => {
              const merged = new Map<number, number>();
              for (const line of (Array.isArray(row.bom) ? row.bom : []).filter(
                (line) => asText(line?.name) && asNumber(line?.quantity) > 0,
              )) {
                const rawItemId = await ensureRaw(line);
                merged.set(rawItemId, (merged.get(rawItemId) ?? 0) + Math.max(0, asNumber(line.quantity)));
              }
              return [...merged.entries()].map(([rawItemId, quantity]) => ({ rawItemId, quantity }));
            })()
          : undefined;
      const saved = await saveCatalogItem({
        data: {
          id: existing?.id,
          kind: section,
          name,
          categoryId: await categoryId(asText(row.category), section),
          unitId: await unitId(asText(row.unit)),
          // Fields missing from the file keep the item's current value (no wipe on re-import).
          minQty: row.has && !row.has.minQty && existing ? existing.minQty : Math.max(0, asNumber(row.minQty)),
          salePrice: row.has && !row.has.salePrice && existing ? existing.salePrice : Math.max(0, asNumber(row.salePrice)),
          purchasePrice:
            row.has && !row.has.purchasePrice && existing ? existing.purchasePrice : Math.max(0, asNumber(row.purchasePrice)),
          notes: asText(row.notes) || existing?.notes || "",
          bom: bom,
          overheads:
            section === "product"
              ? (Array.isArray(row.overheads) ? row.overheads : [])
                  .map((line) => ({ title: asText(line.title), amount: Math.max(0, asNumber(line.amount)) }))
                  .filter((line) => line.title && line.amount > 0)
              : undefined,
        },
      });
      const qty = Math.max(0, asNumber(row.qty));
      if (!existing && qty > 0) {
        await saveOpeningStock({
          data: {
            kind: section === "product" ? "finished" : "raw",
            itemName: name,
            warehouseName,
            quantity: qty,
            occurredOn: todayIso(),
            notes: "بک‌آپ",
          },
        });
      }
      if (!existing) {
        items.push({
          id: saved.id,
          name,
          typeId: null,
          typeName: "",
          categoryId: null,
          categoryName: asText(row.category),
          unitId: null,
          unitName: asText(row.unit),
          kind: section,
          image: null,
          minQty: Math.max(0, asNumber(row.minQty)),
          salePrice: Math.max(0, asNumber(row.salePrice)),
          purchasePrice: Math.max(0, asNumber(row.purchasePrice)),
          notes: asText(row.notes),
        });
      }
      count += 1;
    }
    if (!count) throw new Error("فایل قلمی برای خواندن ندارد");
    await refreshWarehouse();
    toast.success(`${count} قلم خوانده شد`);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 shrink-0 items-center rounded-md border-2 border-tab-d bg-surface px-3 text-2xs font-medium whitespace-nowrap sm:text-sm"
      >
        بک آپ
      </button>
      <Modal open={open} title={`بک آپ ${title}`} onClose={() => (busy ? undefined : setOpen(false))}>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={exportFile}>
            ذخیره
          </Button>
          {writable ? (
            <Button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
              آپلود
            </Button>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              void importFile(file)
                .catch((err) => toast.error(err instanceof Error ? err.message : "خواندن فایل ناکام شد"))
                .finally(() => setBusy(false));
            }}
          />
        </div>
      </Modal>
    </>
  );
}

function WarehouseSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex h-11 shrink-0 items-center rounded-md border-2 border-tab-d bg-surface px-3 text-2xs font-medium sm:text-sm">
      <span className="sr-only">جستجو</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="جستجو"
        className="h-full w-24 bg-transparent text-center outline-none sm:w-28"
      />
    </label>
  );
}
