import { FileDown, ImageDown, Plus, Printer, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { toast } from "sonner";
import { EntitySelect } from "@/components/entity-select";
import { ImageSlot } from "@/components/image-slot";
import { MoneyInput } from "@/components/money-input";
import { useAppData } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { saveAccount } from "@/lib/api/finance";
import { queryClient } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { convertAmount, formatMoney, formatMoneyInt, parseAmount, rateToBaseOf } from "@/lib/format";
import type { Account, Item, Named } from "@/lib/types";

export function AfAmount({
  value,
  size = "micro",
  className,
  whole,
}: {
  value: number;
  size?: "micro" | "sm" | "md";
  className?: string;
  whole?: boolean;
}) {
  const sizeCls = size === "md" ? "text-sm" : size === "sm" ? "text-2xs" : "text-micro";
  return (
    <span
      dir="ltr"
      className={cn("inline-flex items-baseline gap-0.5 font-medium tabular-nums leading-none", sizeCls, className)}
    >
      <span>{whole ? formatMoneyInt(value) : formatMoney(value)}</span>
      <span className="text-micro font-normal text-muted">؋</span>
    </span>
  );
}

const TAB_BORDER = {
  a: "border-tab-a",
  b: "border-tab-b",
  c: "border-tab-c",
  d: "border-tab-d",
} as const;

export function SectionTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  fill,
  contrast,
  labelClass,
}: {
  tabs: { id: T; label: string; color: keyof typeof TAB_BORDER }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  fill?: boolean;
  contrast?: boolean;
  labelClass?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-nowrap gap-1.5", fill ? "w-full" : "overflow-x-auto", contrast && "list-tabs", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cn(
            "company-chip h-11 rounded-md border px-3 text-center text-2xs font-medium whitespace-nowrap sm:text-sm",
            fill ? "min-w-0 flex-1" : "shrink-0",
            value === t.id ? "chip-on border-white/70" : "border-white/25",
            labelClass,
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function tabPanel(color: keyof typeof TAB_BORDER) {
  return cn("rounded-md border-2 bg-surface p-3 sm:p-4", TAB_BORDER[color]);
}

export function FxBar({
  enabled,
  onEnabled,
  currencies,
  currencyId,
  onCurrency,
  rate,
  onRate,
  disabled,
}: {
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  currencies: { id: number; name: string; symbol: string; rateToBase: number }[];
  currencyId: number | null;
  onCurrency: (id: number, rate: number) => void;
  rate: string;
  onRate: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-nowrap items-center justify-start gap-2 overflow-x-auto">
      <label className="flex h-11 shrink-0 items-center gap-2 whitespace-nowrap text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => onEnabled(e.target.checked)}
        />
        چندارزی
      </label>
      {enabled ? (
        <>
          <div className="w-36 shrink-0">
            <EntitySelect
              value={currencyId}
              disabled={disabled}
              options={currencies.map((c) => ({
                id: c.id,
                label: `${c.name} (${c.symbol})`,
              }))}
              onChange={(id) => {
                const n = id == null ? null : Number(id);
                if (n == null) return;
                onCurrency(n, currencies.find((c) => c.id === n)?.rateToBase ?? 1);
              }}
            />
          </div>
          <div className="w-24 shrink-0">
            <MoneyInput value={rate} onChange={onRate} disabled={disabled} />
          </div>
        </>
      ) : null}
    </div>
  );
}

export type DraftLine = {
  key: string;
  itemId: number | null;
  itemName: string;
  quantity: string;
  unitId: number | null;
  unitPrice: string;
};

export function emptyLine(unitId: number | null): DraftLine {
  return {
    key: Math.random().toString(36).slice(2),
    itemId: null,
    itemName: "",
    quantity: "",
    unitId,
    unitPrice: "",
  };
}

export function InvoiceLines({
  lines,
  onChange,
  items,
  units,
  itemLabel,
  onAddItem,
  onAddUnit,
  disabled,
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  items: Item[];
  units: Named[];
  itemLabel: string;
  onAddItem?: () => void;
  onAddUnit?: () => void;
  disabled?: boolean;
}) {
  function patch(i: number, next: Partial<DraftLine>) {
    onChange(lines.map((l, idx) => (idx === i ? { ...l, ...next } : l)));
  }
  return (
    <div>
      <div className="max-w-full overflow-x-auto">
        <table className="w-max min-w-full border-collapse text-2xs sm:text-sm">
          <thead>
            <tr className="bg-surface-2">
              <th className="border border-border px-2 py-2.5 text-center font-medium whitespace-nowrap">شماره</th>
              <th className="min-w-40 border border-border px-2 py-2.5 text-center font-medium whitespace-nowrap">
                {itemLabel}
              </th>
              <th className="min-w-20 border border-border px-2 py-2.5 text-center font-medium whitespace-nowrap">
                تعداد
              </th>
              <th className="min-w-24 border border-border px-2 py-2.5 text-center font-medium whitespace-nowrap">
                واحد
              </th>
              <th className="min-w-24 border border-border px-2 py-2.5 text-center font-medium whitespace-nowrap">
                قیمت فی
              </th>
              <th className="border border-border px-2 py-2.5 text-center font-medium whitespace-nowrap">جمع</th>
              {!disabled ? <th className="w-10 border border-border px-0 py-2.5" /> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const total = parseAmount(l.quantity) * parseAmount(l.unitPrice);
              return (
                <tr key={l.key}>
                  <td className="border border-border px-2 py-2 text-center tabular-nums whitespace-nowrap">{i + 1}</td>
                  <td className="border border-border px-1 py-2 text-center whitespace-nowrap">
                    {disabled ? (
                      <span className="whitespace-nowrap">{l.itemName}</span>
                    ) : (
                      <EntitySelect
                        compact
                        placeholder=""
                        className="min-w-40"
                        value={l.itemId}
                        options={items.map((it) => ({ id: it.id, label: it.name }))}
                        onChange={(id) => {
                          const n = id == null ? null : Number(id);
                          const it = items.find((x) => x.id === n);
                          patch(i, {
                            itemId: n,
                            itemName: it?.name ?? "",
                            unitId: it?.unitId ?? l.unitId,
                            unitPrice: it && it.salePrice > 0 ? String(it.salePrice) : l.unitPrice,
                          });
                        }}
                        onAdd={onAddItem}
                      />
                    )}
                  </td>
                  <td className="border border-border px-1 py-2 text-center whitespace-nowrap">
                    {disabled ? (
                      <span className="tabular-nums">{formatMoney(parseAmount(l.quantity))}</span>
                    ) : (
                      <MoneyInput
                        value={l.quantity}
                        onChange={(v) => patch(i, { quantity: v })}
                        className="mx-auto h-11 w-full min-w-16 px-1 text-center text-sm"
                      />
                    )}
                  </td>
                  <td className="border border-border px-1 py-2 text-center whitespace-nowrap">
                    {disabled ? (
                      units.find((u) => u.id === l.unitId)?.name || ""
                    ) : (
                      <EntitySelect
                        compact
                        placeholder=""
                        className="min-w-24"
                        value={l.unitId}
                        options={units.map((u) => ({ id: u.id, label: u.name }))}
                        onChange={(id) => patch(i, { unitId: id == null ? null : Number(id) })}
                        onAdd={onAddUnit}
                      />
                    )}
                  </td>
                  <td className="border border-border px-1 py-2 text-center whitespace-nowrap">
                    {disabled ? (
                      <span className="tabular-nums">{formatMoney(parseAmount(l.unitPrice))}</span>
                    ) : (
                      <MoneyInput
                        value={l.unitPrice}
                        onChange={(v) => patch(i, { unitPrice: v })}
                        className="mx-auto h-11 w-full min-w-16 px-1 text-center text-sm"
                      />
                    )}
                  </td>
                  <td className="border border-border px-2 py-2 text-center tabular-nums whitespace-nowrap">
                    {formatMoney(total)}
                  </td>
                  {!disabled ? (
                    <td className="w-10 border border-border px-0 py-2 text-center">
                      <button
                        type="button"
                        className="grid size-8 place-items-center text-muted hover:text-danger"
                        aria-label="حذف ردیف"
                        onClick={() => onChange(lines.filter((_, idx) => idx !== i))}
                        disabled={lines.length <= 1}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!disabled ? (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => onChange([...lines, emptyLine(units[0]?.id ?? null)])}
            className="add-box"
            aria-label="افزودن ردیف"
          >
            <Plus className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function getBg(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim() || "#f7fbfb";
}

function copyFormValues(from: HTMLElement, to: HTMLElement) {
  const srcFields = from.querySelectorAll("input, textarea, select");
  const dstFields = to.querySelectorAll("input, textarea, select");
  srcFields.forEach((el, i) => {
    const d = dstFields[i];
    if (!d) return;
    if (el instanceof HTMLInputElement && d instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio") d.checked = el.checked;
      else d.value = el.value;
    }
    if (el instanceof HTMLTextAreaElement && d instanceof HTMLTextAreaElement) d.value = el.value;
    if (el instanceof HTMLSelectElement && d instanceof HTMLSelectElement) d.value = el.value;
  });
}

async function waitForClone(clone: HTMLElement) {
  const imgs = Array.from(clone.querySelectorAll("img"));
  await Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((res) => {
            img.onload = () => res();
            img.onerror = () => res();
          }),
    ),
  );
  if (document.fonts?.ready) await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
}

function keepExportCorners(root: HTMLElement) {
  const all = [root, ...root.querySelectorAll<HTMLElement>("*")];
  for (const el of all) {
    const style = getComputedStyle(el);
    if (!style.borderTopLeftRadius || style.borderTopLeftRadius === "0px") continue;
    el.style.borderRadius = style.borderRadius;
    el.style.overflow = "hidden";
  }
}

async function capturePngDesktop(node: HTMLElement, toPng: typeof import("html-to-image").toPng): Promise<string> {
  const bg = getBg();
  const tabW = Math.ceil(Math.max(node.getBoundingClientRect().width, node.offsetWidth, 1));
  const holder = document.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText = `position:fixed;left:-16000px;top:0;z-index:-1;width:${tabW}px;background:${bg};overflow:visible;`;
  const clone = node.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".no-print, .export-exclude").forEach((el) => el.remove());
  clone.style.boxSizing = "border-box";
  clone.style.width = `${tabW}px`;
  clone.style.height = "auto";
  clone.style.maxHeight = "none";
  clone.style.overflow = "visible";
  clone.querySelectorAll<HTMLElement>("*").forEach((el) => {
    el.style.overflow = "visible";
    el.style.overflowX = "visible";
    el.style.overflowY = "visible";
    el.style.maxHeight = "none";
    (el.style as CSSStyleDeclaration).scrollbarWidth = "none";
  });
  holder.appendChild(clone);
  document.body.appendChild(holder);
  copyFormValues(node, clone);
  try {
    await waitForClone(clone);
    keepExportCorners(clone);
    const needW = Math.ceil(Math.max(tabW, clone.scrollWidth, clone.offsetWidth));
    if (needW > tabW) {
      holder.style.width = `${needW}px`;
      clone.style.width = `${needW}px`;
      await waitForClone(clone);
    }
    const w = Math.ceil(Math.max(tabW, clone.scrollWidth, clone.offsetWidth));
    const h = Math.ceil(Math.max(clone.scrollHeight, clone.offsetHeight, clone.clientHeight));
    clone.style.width = `${w}px`;
    clone.style.height = `${h}px`;
    return await toPng(clone, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: bg,
      width: w,
      height: h,
      canvasWidth: w * 2,
      canvasHeight: h * 2,
      style: { maxHeight: "none", height: `${h}px`, width: `${w}px`, overflow: "hidden", borderRadius: getComputedStyle(clone).borderRadius },
    });
  } finally {
    holder.remove();
  }
}

async function capturePngMobile(node: HTMLElement, toPng: typeof import("html-to-image").toPng): Promise<string> {
  const w = Math.max(node.scrollWidth, node.offsetWidth, node.clientWidth, 720);
  const holder = document.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText = `position:fixed;left:-12000px;top:0;z-index:-1;width:${w}px;background:${getBg()};`;
  const clone = node.cloneNode(true) as HTMLElement;
  clone.style.maxHeight = "none";
  clone.style.height = "auto";
  clone.style.overflow = "visible";
  clone.style.width = `${w}px`;
  clone.querySelectorAll(".no-print, .export-exclude").forEach((el) => el.remove());
  holder.appendChild(clone);
  document.body.appendChild(holder);
  const srcFields = node.querySelectorAll("input, textarea, select");
  const dstFields = clone.querySelectorAll("input, textarea, select");
  srcFields.forEach((el, i) => {
    const d = dstFields[i];
    if (!d) return;
    if (el instanceof HTMLInputElement && d instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio") d.checked = el.checked;
      else d.value = el.value;
    }
    if (el instanceof HTMLTextAreaElement && d instanceof HTMLTextAreaElement) d.value = el.value;
    if (el instanceof HTMLSelectElement && d instanceof HTMLSelectElement) d.value = el.value;
  });
  try {
    const imgs = Array.from(clone.querySelectorAll("img"));
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((res) => {
              img.onload = () => res();
              img.onerror = () => res();
            }),
      ),
    );
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    keepExportCorners(clone);
    const h = Math.max(clone.scrollHeight, clone.offsetHeight, clone.clientHeight);
    return await toPng(clone, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: getBg(),
      width: w,
      height: h,
      style: { maxHeight: "none", height: `${h}px`, width: `${w}px`, overflow: "hidden", borderRadius: getComputedStyle(clone).borderRadius },
    });
  } finally {
    holder.remove();
  }
}

export async function capturePng(node: HTMLElement): Promise<string> {
  const { toPng } = await import("html-to-image");
  if (window.matchMedia("(min-width: 768px)").matches) return capturePngDesktop(node, toPng);
  return capturePngMobile(node, toPng);
}

export async function downloadPng(node: HTMLElement, filename: string) {
  const url = await capturePng(node);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.png`;
  a.click();
}

export async function downloadPdf(node: HTMLElement, filename: string) {
  const url = await capturePng(node);
  const { jsPDF } = await import("jspdf");
  const img = new Image();
  img.src = url;
  await img.decode();
  if (window.matchMedia("(min-width: 768px)").matches) {
    const cssW = img.width / 2;
    const cssH = img.height / 2;
    const mmW = Math.max(80, (cssW * 25.4) / 96);
    const mmH = Math.max(80, (cssH * 25.4) / 96);
    const pdf = new jsPDF({
      orientation: mmW >= mmH ? "landscape" : "portrait",
      unit: "mm",
      format: [mmW, mmH],
      compress: true,
    });
    pdf.addImage(url, "PNG", 0, 0, mmW, mmH);
    pdf.save(`${filename}.pdf`);
    return;
  }
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const maxW = pageW - 16;
  const usableH = pageH - 16;
  const imgW = maxW;
  const imgH = (img.height * imgW) / img.width;
  if (imgH <= usableH) pdf.addImage(url, "PNG", (pageW - imgW) / 2, margin, imgW, imgH);
  else {
    const pageHeightPx = (img.width * usableH) / imgW;
    let y = 0;
    let page = 0;
    while (y < img.height - 1) {
      if (page > 0) pdf.addPage();
      const sliceH = Math.min(pageHeightPx, img.height - y);
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = sliceH;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = getBg();
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, y, img.width, sliceH, 0, 0, img.width, sliceH);
        const slice = canvas.toDataURL("image/png");
        const sliceMm = (sliceH * imgW) / img.width;
        pdf.addImage(slice, "PNG", (pageW - imgW) / 2, margin, imgW, sliceMm);
      }
      y += pageHeightPx;
      page += 1;
    }
  }
  pdf.save(`${filename}.pdf`);
}

export function InvoiceBrand({
  logo,
  name,
  phones,
  invoiceNo,
  invoiceCaption,
  editable,
  onLogo,
}: {
  logo?: string | null;
  name: string;
  phones: string[];
  invoiceNo: string;
  invoiceCaption?: string;
  editable?: boolean;
  onLogo?: (url: string | null) => void;
}) {
  const line = phones.filter(Boolean).join(" - ") || "شماره تماس ثبت نشده";
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 overflow-x-auto">
      <ImageSlot
        src={logo}
        size={64}
        editable={Boolean(editable && onLogo)}
        alt={name}
        className="shrink-0"
        onChange={onLogo}
      />
      <div className="min-w-0 text-center">
        <div className="text-lg font-bold whitespace-nowrap">{name}</div>
        <div className="mt-1 text-2xs tabular-nums whitespace-nowrap text-muted" dir="ltr">
          {line}
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap">
        {invoiceCaption ? <span>{invoiceCaption}</span> : null}
        <span className="tabular-nums" dir="ltr">
          {invoiceNo}
        </span>
      </div>
    </div>
  );
}

export function InvoiceTotals({
  total,
  totalBase,
  paid,
  paidLabel,
  onPaid,
  remaining,
  remainingBase,
  fx,
  fxRate,
  currencySymbol,
  accountId,
  accountName,
  accounts,
  onAccount,
  view,
  currencies,
  invoiceCurrencyId,
  accountLabel = "از حساب",
  exportExcludeAccount,
  paidRate,
  paidSymbol,
  paidExtra,
}: {
  total: number;
  totalBase: number;
  paid: string;
  paidLabel: string;
  onPaid: (v: string) => void;
  remaining: number;
  remainingBase: number;
  fx: boolean;
  fxRate: number;
  currencySymbol?: string;
  accountId: number | null;
  accountName?: string;
  accounts: Account[];
  onAccount: (id: number | null) => void;
  view?: boolean;
  currencies?: { id: number; rateToBase: number; symbol: string }[];
  invoiceCurrencyId?: number | null;
  accountLabel?: string;
  exportExcludeAccount?: boolean;
  paidRate?: number;
  paidSymbol?: string;
  paidExtra?: ReactNode;
}) {
  const [addAcc, setAddAcc] = useState(false);
  const paidN = parseAmount(paid);
  const usePaidRate = paidRate != null && paidRate > 0;
  const paidBase = paidN * (usePaidRate ? paidRate : fx ? fxRate : 1);
  const cur = usePaidRate ? paidSymbol ?? "" : fx ? currencySymbol ?? "" : "";
  const acc = accounts.find((a) => a.id === accountId);
  const mismatch = Boolean(
    !usePaidRate && acc && invoiceCurrencyId != null && acc.currencyId !== invoiceCurrencyId && paidN > 0,
  );
  const equiv =
    mismatch && acc && currencies
      ? convertAmount(paidN, fx ? fxRate : rateToBaseOf(currencies, invoiceCurrencyId), rateToBaseOf(currencies, acc.currencyId))
      : 0;
  return (
    <div className="space-y-1.5">
      <TripleRow
        label="جمع کل"
        mid={<AfAmount value={totalBase} size="sm" />}
        left={
          fx ? (
            <span className="tabular-nums text-sm whitespace-nowrap">
              {formatMoney(total)} {cur}
            </span>
          ) : null
        }
      />
      <TripleRow
        label={paidLabel}
        mid={fx || usePaidRate ? <AfAmount value={paidBase} size="sm" /> : null}
        left={
          view ? (
            <span className="tabular-nums text-sm whitespace-nowrap">
              {formatMoney(paidN)} {cur}
            </span>
          ) : (
            <MoneyInput value={paid} onChange={onPaid} className="h-10 w-full text-sm" />
          )
        }
      />
      {paidExtra}
      <div className={"space-y-1" + (exportExcludeAccount ? " no-print export-exclude" : "")}>
        <span className="block text-2xs text-muted whitespace-nowrap">{accountLabel}</span>
        {view ? (
          <p className="text-sm whitespace-nowrap">{accountName || acc?.name || ""}</p>
        ) : (
          <EntitySelect
            value={accountId}
            placeholder=""
            options={accounts.map((a) => ({ id: a.id, label: `${a.name} (${a.currencySymbol})` }))}
            onChange={(id) => onAccount(id == null ? null : Number(id))}
            onAdd={() => setAddAcc(true)}
          />
        )}
      </div>
      {addAcc ? (
        <AccountFormModal
          onClose={() => setAddAcc(false)}
          onSaved={(id) => {
            onAccount(id);
            setAddAcc(false);
          }}
        />
      ) : null}
      {mismatch && acc ? (
        <p
          className={
            "rounded-sm border border-danger/50 bg-danger-soft px-3 py-2 text-2xs text-danger" +
            (exportExcludeAccount ? " no-print export-exclude" : "")
          }
        >
          ارز فاکتور با ارز دخل «{acc.name}» یکسان نیست. معادل ثبت در دخل:{" "}
          <span className="tabular-nums" dir="ltr">
            {formatMoney(equiv)} {acc.currencySymbol}
          </span>
        </p>
      ) : null}
      <TripleRow
        label="باقی‌مانده"
        mid={<AfAmount value={remainingBase} size="sm" />}
        left={
          fx ? (
            <span className="tabular-nums text-sm whitespace-nowrap">
              {formatMoney(remaining)} {cur}
            </span>
          ) : null
        }
      />
    </div>
  );
}

export function AccountFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved?: (id: number) => void;
}) {
  const { data } = useAppData();
  const afn = data?.catalogs.currencies.find((c) => c.name === "افغانی")?.id;
  const [name, setName] = useState("");
  const [currencyId, setCurrencyId] = useState<number | null>(afn ?? data?.catalogs.currencies[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Modal open title="افزودن حساب" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!currencyId) {
            setError("ارز را انتخاب کنید");
            return;
          }
          setBusy(true);
          setError("");
          try {
            const res = await saveAccount({
              data: { name, currencyId, openingBalance: 0 },
            });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            toast.success("ثبت شد");
            onSaved?.(res.id);
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "خطا");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="نام حساب">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="ارز">
          <EntitySelect
            value={currencyId}
            options={(data?.catalogs.currencies ?? []).map((c) => ({
              id: c.id,
              label: `${c.name} (${c.symbol})`,
            }))}
            onChange={(id) => setCurrencyId(id == null ? null : Number(id))}
          />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy}>
          ثبت
        </Button>
      </form>
    </Modal>
  );
}

function TripleRow({ label, mid, left }: { label: string; mid?: ReactNode; left?: ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block text-2xs text-muted whitespace-nowrap">{label}</span>
      {left ? <div>{left}</div> : null}
      {mid ? <div>{mid}</div> : null}
    </div>
  );
}

export function SheetActions({
  targetRef,
  filename,
  image,
  pdf,
}: {
  targetRef: RefObject<HTMLElement | null>;
  filename: string;
  image?: boolean;
  pdf?: boolean;
}) {
  async function run(kind: "png" | "pdf") {
    const node = targetRef.current;
    if (!node) return;
    try {
      if (kind === "png") await downloadPng(node, filename);
      else await downloadPdf(node, filename);
    } catch {
      toast.error(kind === "png" ? "ذخیره عکس ناکام شد" : "ذخیره PDF ناکام شد");
    }
  }
  return (
    <div className="no-print mt-3 flex flex-wrap justify-end gap-2">
      <ToolBtn label="چاپ" onClick={() => window.print()}>
        <Printer className="size-4" />
      </ToolBtn>
      {image ? (
        <ToolBtn label="ذخیره عکس" onClick={() => void run("png")}>
          <ImageDown className="size-4" />
        </ToolBtn>
      ) : null}
      {pdf ? (
        <ToolBtn label="ذخیره PDF" onClick={() => void run("pdf")}>
          <FileDown className="size-4" />
        </ToolBtn>
      ) : null}
    </div>
  );
}

function ToolBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm hover:bg-surface-2"
    >
      {children}
      {label}
    </button>
  );
}

export function useSheetRef() {
  return useRef<HTMLDivElement>(null);
}

export function ErrorLines({ message }: { message: string }) {
  const lines = message
    .split(/\n+|؛/g)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return (
    <ul className="mt-3 space-y-1 rounded-sm border border-danger/35 bg-danger-soft px-3 py-2">
      {lines.map((line, i) => (
        <li key={`${i}-${line}`} className="text-sm leading-6 text-danger">
          {line}
        </li>
      ))}
    </ul>
  );
}
