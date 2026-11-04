import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmAccountantReset } from "@/components/confirm-accountant";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Guard } from "@/components/guard";
import { IconBtn } from "@/components/icon-btn";
import { useAppData } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { logoutNow } from "@/components/onboarding";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { changeRole, updateProfileName } from "@/lib/api/core";
import { setRoleToken } from "@/lib/session-role-client";
import {
  addStaffUser,
  deleteOnlineBackup,
  deleteStaffUser,
  exportWorkspace,
  importWorkspace,
  listOnlineBackups,
  resetWorkspaceData,
  restoreOnlineBackup,
  saveAppearance,
  saveOnlineBackup,
  saveRoleCodes,
  updateStaffUser,
} from "@/lib/api/workspace";
import { saveProductionEnabled } from "@/lib/api/setup";
import { canWrite } from "@/lib/permissions";
import { applyAppearance, ensureThemeContrast, paintTraderban } from "@/lib/prefs";
import { queryClient } from "@/lib/query-client";
import { DEFAULT_SETTINGS, ROLE_LABELS, type AppSettings, type ColorPreset, type Role, type StaffUser } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings")({ component: Page });

const PRESETS: {
  id: string;
  label: string;
  theme: AppSettings["theme"];
  fontColor: string;
  primaryColor: string;
  bgColor: string;
  accentColor: string;
  dangerColor: string;
}[] = [
  { id: "traderban", label: "نظم", theme: "dark", fontColor: "#f7f2f6", primaryColor: "#ff2d6a", bgColor: "#07040c", accentColor: "#f4c27a", dangerColor: "#ff4d4d" },
  { id: "traderban-light", label: "نظم روشن", theme: "light", fontColor: "#1a0c14", primaryColor: "#ff2d6a", bgColor: "#f6f0f3", accentColor: "#c4893a", dangerColor: "#ff4d4d" },
  { id: "graphite", label: "گرافیت", theme: "dark", fontColor: "#e8eef2", primaryColor: "#3d8bfd", bgColor: "#101418", accentColor: "#8aa0b4", dangerColor: "#e06c64" },
  { id: "khaki", label: "خاکی", theme: "light", fontColor: "#1c1916", primaryColor: "#1b4d3e", bgColor: "#f4f0e6", accentColor: "#8a6a2f", dangerColor: "#8f3a32" },
  { id: "sand", label: "شنی", theme: "light", fontColor: "#2a241c", primaryColor: "#6b4f2a", bgColor: "#f7f0e2", accentColor: "#9a6b32", dangerColor: "#8f3a32" },
  { id: "navy", label: "آبی", theme: "light", fontColor: "#1a2430", primaryColor: "#234e70", bgColor: "#eef3f7", accentColor: "#6a7f3a", dangerColor: "#8f3a32" },
  { id: "olive", label: "زیتونی", theme: "light", fontColor: "#1d2118", primaryColor: "#4a5c32", bgColor: "#f3f1e4", accentColor: "#8a6a2f", dangerColor: "#8f3a32" },
  { id: "clay", label: "گلی", theme: "light", fontColor: "#2a1f1c", primaryColor: "#8a4b3a", bgColor: "#f6eee8", accentColor: "#8a6a2f", dangerColor: "#8f3a32" },
  { id: "emerald", label: "زمردی", theme: "light", fontColor: "#14241c", primaryColor: "#0f6b4c", bgColor: "#eef6f1", accentColor: "#c4a35a", dangerColor: "#8f3a32" },
  { id: "rose", label: "گلابی", theme: "light", fontColor: "#2a1c20", primaryColor: "#9b3d54", bgColor: "#f8eef1", accentColor: "#b07a3a", dangerColor: "#8f3a32" },
  { id: "slate", label: "سنگی", theme: "light", fontColor: "#1c232b", primaryColor: "#3d4f61", bgColor: "#eef1f4", accentColor: "#7a8f5a", dangerColor: "#8f3a32" },
  { id: "gold", label: "طلایی", theme: "light", fontColor: "#2a2414", primaryColor: "#8a6a1f", bgColor: "#f7f2e0", accentColor: "#4a6b3a", dangerColor: "#8f3a32" },
  { id: "teal", label: "فیروزه‌ای", theme: "light", fontColor: "#142428", primaryColor: "#1a6b6b", bgColor: "#e8f4f4", accentColor: "#8a6a2f", dangerColor: "#8f3a32" },
  { id: "burgundy", label: "شرابی", theme: "light", fontColor: "#241418", primaryColor: "#7a2e3e", bgColor: "#f6ecee", accentColor: "#8a6a2f", dangerColor: "#8f3a32" },
  { id: "ink", label: "مرکب", theme: "dark", fontColor: "#ece8e0", primaryColor: "#3d7a68", bgColor: "#171a18", accentColor: "#d4b46a", dangerColor: "#e08b84" },
  { id: "night", label: "شب", theme: "dark", fontColor: "#e8eef4", primaryColor: "#4a7ea8", bgColor: "#12161c", accentColor: "#d4b46a", dangerColor: "#e08b84" },
  { id: "plum", label: "بادمجانی", theme: "dark", fontColor: "#f0e8f0", primaryColor: "#7a4e8a", bgColor: "#18141c", accentColor: "#d4b46a", dangerColor: "#e08b84" },
];

const PERSIAN_FONTS = [
  { id: "Vazirmatn", label: "وزیرمتن" },
  { id: "Estedad", label: "استعداد" },
  { id: "Sahel", label: "ساحل" },
  { id: "Shabnam", label: "شبنم" },
  { id: "Samim", label: "صمیم" },
  { id: "Rubik", label: "روبیک" },
  { id: "Noto Sans Arabic", label: "نوتو سنس" },
  { id: "IBM Plex Sans Arabic", label: "پلکس" },
  { id: "Tajawal", label: "تجوال" },
  { id: "Readex Pro", label: "ریدکس" },
  { id: "Noto Naskh Arabic", label: "نسخ" },
  { id: "Amiri", label: "امیری" },
  { id: "Scheherazade New", label: "شهرزاد" },
  { id: "Lateef", label: "لطیف" },
  { id: "Markazi Text", label: "مرکزی" },
];

function appearanceData(s: AppSettings) {
  return {
    theme: s.theme,
    fontSize: s.fontSize,
    fontFamily: s.fontFamily,
    fontColor: s.fontColor,
    primaryColor: s.primaryColor,
    bgColor: s.bgColor,
    accentColor: s.accentColor,
    dangerColor: s.dangerColor,
    listColor: s.listColor,
    cardTint: s.cardTint,
    cardTintStrength: s.cardTintStrength,
    calendar: s.calendar,
    colorPresets: s.colorPresets ?? [],
  };
}

function Page() {
  return (
    <Guard area="settings">
      <Settings />
    </Guard>
  );
}

function Settings() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "settings");
  const saved = data?.settings ?? DEFAULT_SETTINGS;
  const showLogout = typeof window !== "undefined" ? !hasGateSessionMarker() : true;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <style>{`
        html.theme-dark [data-sonner-toast],
        html.theme-dark [data-sonner-toast] * {
          color: #1a0c14 !important;
          -webkit-text-fill-color: #1a0c14 !important;
        }
      `}</style>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">تنظیمات</h1>
      </div>
      <AppearanceCard saved={saved} writable={writable} />
      <ProductionCard saved={saved} writable={writable} />
      <CalendarCard saved={saved} writable={writable} />
      <BackupCard />
      <SecurityCard writable={writable} staff={data?.staff ?? []} settings={saved} />
      {showLogout ? (
        <Button variant="danger" onClick={() => { void logoutNow(); }}>
          خروج از حساب
        </Button>
      ) : null}
    </div>
  );
}

function ProductionCard({ saved, writable }: { saved: AppSettings; writable: boolean }) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<boolean | null>(null);
  const on = saved.productionEnabled !== false;

  return (
    <section className="tb-card space-y-3 p-4">
      <h2 className="font-semibold">بخش تولیدی</h2>
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-1">
        <ModeBtn active={on} disabled={!writable || busy} onClick={() => on || setPending(true)}>
          فعال
        </ModeBtn>
        <ModeBtn active={!on} disabled={!writable || busy} onClick={() => !on || setPending(false)}>
          غیرفعال
        </ModeBtn>
      </div>
      <ConfirmAccountantReset
        open={pending != null}
        title="بخش تولیدی"
        message="برای فعال یا غیرفعال کردن بخش تولیدی، کد حسابدار را وارد کنید."
        confirmLabel="ثبت"
        onClose={() => setPending(null)}
        onConfirm={async (code) => {
          if (pending == null) return;
          setBusy(true);
          try {
            await saveProductionEnabled({ data: { enabled: pending, code } });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            toast.success(pending ? "بخش تولیدی فعال شد" : "بخش تولیدی غیرفعال شد");
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}

function AppearanceCard({ saved, writable }: { saved: AppSettings; writable: boolean }) {
  const [draft, setDraft] = useState(saved);

  useEffect(() => setDraft(saved), [saved]);
  useEffect(() => {
    applyAppearance(draft);
  }, [draft]);

  async function persist(next: AppSettings) {
    applyAppearance(next);
    try {
      await saveAppearance({ data: appearanceData(next) });
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      toast.success("ثبت شد");
    } catch {
      applyAppearance(saved);
      toast.error("ثبت ناکام شد");
    }
  }

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setPainted<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraft((d) => ({ ...paintTraderban(d), [key]: value }));
  }

  const look = paintTraderban(draft);

  return (
    <section className="tb-card space-y-4 p-4">
      <div>
        <h2 className="font-semibold">ظاهر</h2>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">حالت نمایش</p>
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-1">
          <ModeBtn
            active={look.theme === "light"}
            disabled={!writable}
            onClick={() =>
              setDraft((d) =>
                ensureThemeContrast({
                  ...paintTraderban(d),
                  theme: "light",
                  bgColor: "#f6f0f3",
                  fontColor: "#1a0c14",
                }),
              )
            }
          >
            روشن
          </ModeBtn>
          <ModeBtn
            active={look.theme === "dark"}
            disabled={!writable}
            onClick={() =>
              setDraft((d) =>
                ensureThemeContrast({
                  ...paintTraderban(d),
                  theme: "dark",
                  bgColor: "#07040c",
                  fontColor: "#f7f2f6",
                }),
              )
            }
          >
            تاریک
          </ModeBtn>
        </div>
      </div>
      <Field label="اندازه فونت">
        <input
          type="range"
          min={75}
          max={138}
          disabled={!writable}
          value={Math.round((draft.fontSize / 16) * 100)}
          onChange={(e) => set("fontSize", Math.min(22, Math.max(12, Math.round((Number(e.target.value) / 100) * 16))))}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-micro text-muted">
          <span>۷۵٪</span>
          <span className="tabular-nums">{Math.round((draft.fontSize / 16) * 100)}٪</span>
          <span>۱۳۸٪</span>
        </div>
      </Field>
      <Field label="فونت">
        <select
          className="field-input h-11 w-full"
          disabled={!writable}
          value={PERSIAN_FONTS.some((f) => f.id === (look.fontFamily || "Vazirmatn")) ? look.fontFamily || "Vazirmatn" : "Vazirmatn"}
          onChange={(e) => set("fontFamily", e.target.value)}
          style={{ fontFamily: `"${look.fontFamily || "Vazirmatn"}", "Vazirmatn", sans-serif` }}
        >
          {PERSIAN_FONTS.map((font) => (
            <option key={font.id} value={font.id} style={{ fontFamily: `"${font.id}", "Vazirmatn", sans-serif` }}>
              {font.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ColorField label="رنگ فونت" value={look.fontColor} disabled={!writable} onChange={(v) => setPainted("fontColor", v)} />
        <ColorField label="رنگ اصلی" value={look.primaryColor} disabled={!writable} onChange={(v) => setPainted("primaryColor", v)} />
        <ColorField label="رنگ پس‌زمینه" value={look.bgColor} disabled={!writable} onChange={(v) => setPainted("bgColor", v)} />
        <ColorField label="رنگ تاکیدی" value={look.accentColor} disabled={!writable} onChange={(v) => setPainted("accentColor", v)} />
        <ColorField label="رنگ هشدار" value={look.dangerColor} disabled={!writable} onChange={(v) => setPainted("dangerColor", v)} />
        <ColorField label="رنگ کارت‌های لیست" value={look.listColor} disabled={!writable} onChange={(v) => setPainted("listColor", v)} />
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">رنگ ملایم کارت‌های داشبورد</p>
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-1">
          <ModeBtn active={draft.cardTint} disabled={!writable} onClick={() => set("cardTint", true)}>
            فعال
          </ModeBtn>
          <ModeBtn active={!draft.cardTint} disabled={!writable} onClick={() => set("cardTint", false)}>
            غیرفعال
          </ModeBtn>
        </div>
      </div>
      <Field label="شدت رنگ کارت‌های داشبورد">
        <input
          type="range"
          min={0}
          max={100}
          disabled={!writable || !draft.cardTint}
          value={draft.cardTintStrength}
          onChange={(e) => set("cardTintStrength", Number(e.target.value))}
          className="w-full accent-primary disabled:opacity-40"
        />
        <div className="flex justify-between text-micro text-muted">
          <span>کم</span>
          <span className="tabular-nums">{draft.cardTintStrength}</span>
          <span>زیاد</span>
        </div>
      </Field>
      <PresetEditor draft={draft} setDraft={setDraft} writable={writable} />
      {writable ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void persist(draft)}>ثبت</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(saved);
              applyAppearance(saved);
            }}
          >
            لغو تغییرات
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const next = {
                ...saved,
                ...appearanceData(DEFAULT_SETTINGS),
                calendar: saved.calendar,
                roleCodes: saved.roleCodes,
                colorPresets: saved.colorPresets,
              };
              setDraft(next);
              applyAppearance(next);
            }}
          >
            بازگشت به تنظیمات اولیه
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium">{label}</span>
      <div className="overflow-hidden rounded-md border border-border">
        <input
          type="color"
          disabled={disabled}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#1b4d3e"}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full cursor-pointer appearance-none border-0 bg-transparent p-0 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
        />
      </div>
    </label>
  );
}

function colorsOf(s: AppSettings): Omit<ColorPreset, "id" | "label"> {
  return {
    theme: s.theme,
    fontColor: s.fontColor,
    primaryColor: s.primaryColor,
    bgColor: s.bgColor,
    accentColor: s.accentColor,
    dangerColor: s.dangerColor,
  };
}

function PresetEditor({
  draft,
  setDraft,
  writable,
}: {
  draft: AppSettings;
  setDraft: (fn: (d: AppSettings) => AppSettings) => void;
  writable: boolean;
}) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const custom = draft.colorPresets ?? [];
  const options = [...PRESETS, ...custom];
  const look = paintTraderban(draft);
  const hex = (v: unknown) => String(v ?? "").toLowerCase();
  const selectedId =
    options.find(
      (p) =>
        p.theme === look.theme &&
        hex(p.fontColor) === hex(look.fontColor) &&
        hex(p.primaryColor) === hex(look.primaryColor) &&
        hex(p.bgColor) === hex(look.bgColor) &&
        hex(p.accentColor) === hex(look.accentColor) &&
        hex(p.dangerColor) === hex(look.dangerColor),
    )?.id ?? "";

  function applyPreset(p: ColorPreset | (typeof PRESETS)[number]) {
    setDraft((d) =>
      ensureThemeContrast({
        ...d,
        theme: p.theme,
        fontColor: p.fontColor,
        primaryColor: p.primaryColor,
        bgColor: p.bgColor,
        accentColor: p.accentColor,
        dangerColor: p.dangerColor,
      }),
    );
  }

  function saveNew() {
    const label = name.trim();
    if (!label) {
      toast.error("نام الگو را بنویسید");
      return;
    }
    const next: ColorPreset = {
      id: `custom-${Date.now()}`,
      label,
      ...colorsOf(paintTraderban(draft)),
    };
    setDraft((d) => ({ ...d, colorPresets: [...(d.colorPresets ?? []), next] }));
    setName("");
    toast.success("الگو ذخیره شد؛ ثبت را بزنید");
  }

  function updateExisting() {
    if (!editingId) return;
    setDraft((d) => ({
      ...d,
      colorPresets: (d.colorPresets ?? []).map((p) => (p.id === editingId ? { ...p, ...colorsOf(paintTraderban(d)), label: name.trim() || p.label } : p)),
    }));
    toast.success("الگو به‌روز شد؛ ثبت را بزنید");
  }

  return (
    <div>
      <Field label="الگوی رنگ">
        <select
          className="field-input h-11 w-full"
          disabled={!writable}
          value={selectedId}
          onChange={(e) => {
            const picked = options.find((p) => p.id === e.target.value);
            if (!picked) return;
            applyPreset(picked);
            if (custom.some((p) => p.id === picked.id)) {
              setEditingId(picked.id);
              setName(picked.label);
            } else {
              setEditingId(null);
            }
          }}
        >
          <option value="">انتخاب الگو</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      {writable ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-[8rem] flex-1">
            <Field label="نام الگوی دستی">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً الگوی شرکت" />
            </Field>
          </div>
          <Button type="button" variant="secondary" onClick={saveNew}>
            ذخیره الگوی جدید
          </Button>
          {editingId ? (
            <Button type="button" variant="secondary" onClick={updateExisting}>
              به‌روزرسانی الگو
            </Button>
          ) : null}
          {editingId ? (
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setDraft((d) => ({ ...d, colorPresets: (d.colorPresets ?? []).filter((x) => x.id !== editingId) }));
                setEditingId(null);
                setName("");
              }}
            >
              حذف الگو
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CalendarCard({ saved, writable }: { saved: AppSettings; writable: boolean }) {
  return (
    <section className="tb-card space-y-3 p-4">
      <h2 className="font-semibold">تقویم</h2>
      <p className="text-sm text-muted">تقویم پیش‌فرض برای انتخاب تاریخ</p>
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-1">
        <ModeBtn
          active={saved.calendar === "jalali"}
          disabled={!writable}
          onClick={() =>
            void saveAppearance({
              data: appearanceData({ ...saved, calendar: "jalali" }),
            }).then(() => queryClient.invalidateQueries({ queryKey: ["bootstrap"] }))
          }
        >
          هجری شمسی
        </ModeBtn>
        <ModeBtn
          active={saved.calendar === "gregorian"}
          disabled={!writable}
          onClick={() =>
            void saveAppearance({
              data: appearanceData({ ...saved, calendar: "gregorian" }),
            }).then(() => queryClient.invalidateQueries({ queryKey: ["bootstrap"] }))
          }
        >
          میلادی
        </ModeBtn>
      </div>
    </section>
  );
}

function BackupCard() {
  const list = useQuery({ queryKey: ["backups"], queryFn: () => listOnlineBackups() });
  const [del, setDel] = useState<number | null>(null);
  const [ask, setAsk] = useState<{ mode: "online"; id: number } | { mode: "file"; payload: string } | null>(null);

  async function doExport() {
    const dump = await exportWorkspace();
    const blob = new Blob([dump.json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `daftar-hesab-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("فایل ذخیره شد");
  }

  return (
    <section className="tb-card space-y-3 p-4">
      <h2 className="font-semibold">ذخیره اطلاعات</h2>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            await saveOnlineBackup({ data: {} });
            await queryClient.invalidateQueries({ queryKey: ["backups"] });
            toast.success("پشتیبان آنلاین ذخیره شد");
          }}
        >
          پشتیبان آنلاین (فضای ابری)
        </Button>
        <Button variant="secondary" onClick={() => void doExport()}>
          خروجی فایل
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              const { exportWorkspaceExcel } = await import("@/lib/excel-workspace");
              await exportWorkspaceExcel();
              toast.success("فایل اکسل ذخیره شد");
            } catch {
              toast.error("خروجی اکسل ناکام شد");
            }
          }}
        >
          خروجی اکسل
        </Button>
        <label className="inline-flex h-11 cursor-pointer items-center rounded-sm border border-border-strong bg-surface px-4 text-sm hover:bg-surface-2">
          درون‌ریزی فایل
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              void f.text().then((payload) => setAsk({ mode: "file", payload }));
            }}
          />
        </label>
      </div>
      <ul className="divide-y divide-border rounded-sm border border-border">
        {(list.data ?? []).map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
            <div>
              <div>{b.label}</div>
              <div className="text-xs tabular-nums text-muted">{b.createdAt}</div>
            </div>
            <div className="flex items-center">
              <button
                type="button"
                className="h-9 rounded-sm px-2 text-xs text-primary hover:bg-primary-soft"
                onClick={() => setAsk({ mode: "online", id: b.id })}
              >
                بازیابی
              </button>
              <IconBtn kind="delete" onClick={() => setDel(b.id)} />
            </div>
          </li>
        ))}
        {!list.data?.length ? <li className="px-3 py-6 text-center text-sm text-muted">پشتیبان آنلاینی نیست</li> : null}
      </ul>
      <ConfirmDelete
        open={del != null}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (del == null) return;
          await deleteOnlineBackup({ data: { id: del } });
          await queryClient.invalidateQueries({ queryKey: ["backups"] });
        }}
      />
      <ConfirmAccountantReset
        open={ask != null}
        title={ask?.mode === "file" ? "بازیابی از فایل" : "بازیابی پشتیبان"}
        message="بازیابی، اطلاعات فعلی را با این پشتیبان جایگزین می‌کند. کد حسابدار را وارد کنید."
        confirmLabel="بازیابی"
        onClose={() => setAsk(null)}
        onConfirm={async (code) => {
          if (!ask) return;
          if (ask.mode === "file") await importWorkspace({ data: { payload: ask.payload, code } });
          else await restoreOnlineBackup({ data: { id: ask.id, code } });
          await queryClient.invalidateQueries();
          toast.success(ask.mode === "file" ? "اطلاعات بازیابی شد" : "بازیابی شد");
        }}
      />
    </section>
  );
}

function SecurityCard({
  writable,
  staff,
  settings,
}: {
  writable: boolean;
  staff: StaffUser[];
  settings: AppSettings;
}) {
  const [tab, setTab] = useState<"users" | "codes" | "me" | "reset">("users");
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<StaffUser | null>(null);
  const [del, setDel] = useState<StaffUser | null>(null);
  const [codes, setCodes] = useState(settings.roleCodes);
  useEffect(() => setCodes(settings.roleCodes), [settings.roleCodes]);

  return (
    <section className="tb-card space-y-3 p-4">
      <h2 className="font-semibold">امنیت و نظارت</h2>
      <div className="flex flex-nowrap gap-1 overflow-x-auto">
        {(
          [
            ["users", "کاربران"],
            ["codes", "کد نقش"],
            ["me", "حساب فعلی"],
            ["reset", "ریست"],
          ] as const
        )
          .filter(([id]) => {
            if (id === "codes") return writable;
            if (id === "reset") return writable;
            return true;
          })
          .map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "h-8 shrink-0 rounded-sm px-2.5 text-2xs whitespace-nowrap",
                tab === id ? "bg-primary text-primary-fg" : "bg-surface-2 text-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
      </div>
      {tab === "users" ? (
        <div className="space-y-2">
          {writable ? (
            <div className="flex justify-end">
              <Button variant="secondary" className="h-8 px-3 text-2xs" onClick={() => setAdd(true)}>
                افزودن کاربر
              </Button>
            </div>
          ) : null}
          <ul className="divide-y divide-border overflow-hidden rounded-sm border border-border">
            {staff.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{u.displayName}</div>
                  <div className="text-xs text-muted">
                    {ROLE_LABELS[u.role]}
                    {u.isOwner ? " — کاربر اصلی" : ""}
                  </div>
                </div>
                {writable ? (
                  <div className="flex">
                    <IconBtn kind="edit" onClick={() => setEdit(u)} />
                    <IconBtn kind="delete" onClick={() => setDel(u)} disabled={u.isOwner} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {tab === "codes" && writable ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Field label={ROLE_LABELS.supervisor}>
              <Input dir="ltr" value={codes.supervisor} onChange={(e) => setCodes((c) => ({ ...c, supervisor: e.target.value }))} />
            </Field>
            <Field label={ROLE_LABELS.accountant}>
              <Input dir="ltr" value={codes.accountant} onChange={(e) => setCodes((c) => ({ ...c, accountant: e.target.value }))} />
            </Field>
            <Field label={ROLE_LABELS.seller}>
              <Input dir="ltr" value={codes.seller} onChange={(e) => setCodes((c) => ({ ...c, seller: e.target.value }))} />
            </Field>
          </div>
          <Button
            onClick={async () => {
              await saveRoleCodes({ data: codes });
              await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
              toast.success("کدها ذخیره شد");
            }}
          >
            ثبت کدها
          </Button>
        </div>
      ) : null}
      {tab === "me" ? <NameRoleQuick /> : null}
      {tab === "reset" && writable ? <ResetPanel /> : null}

      {add ? <StaffForm title="افزودن کاربر" onClose={() => setAdd(false)} /> : null}
      {edit ? <StaffForm title="ویرایش کاربر" initial={edit} onClose={() => setEdit(null)} /> : null}
      <ConfirmDelete
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deleteStaffUser({ data: { id: del.id } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
    </section>
  );
}

function ResetPanel() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-muted">
        با ریست، تمام داده‌های ثبت‌شده (فاکتورها، موجودی، طرف‌حساب‌ها، هزینه‌ها و سفارش‌ها) پاک می‌شود. شرکت، ظاهر برنامه، کاربران و پشتیبان‌های آنلاین باقی می‌مانند تا بعداً بازیابی شوند.
      </p>
      <Button variant="danger" onClick={() => setOpen(true)}>
        ریست اطلاعات آزمایشی
      </Button>
      <Modal open={open} title="ریست اطلاعات" onClose={() => !busy && setOpen(false)}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await resetWorkspaceData({ data: { code } });
              await queryClient.invalidateQueries();
              setCode("");
              setOpen(false);
              toast.success("اطلاعات آزمایشی پاک شد");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "ریست ناکام شد");
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-sm leading-relaxed">برای تأیید، کد نقش حسابدار را وارد کنید. پشتیبان‌های آنلاین پاک نمی‌شوند.</p>
          <Field label="کد حسابدار">
            <Input dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" disabled={busy || !code.trim()}>
              پاک کردن داده‌ها
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              انصراف
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function NameRoleQuick() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "settings");
  const [name, setName] = useState(data?.profile?.displayName ?? "");
  const [role, setRole] = useState<Role>(data?.profile?.role ?? "accountant");
  const [code, setCode] = useState("");
  useEffect(() => {
    setName(data?.profile?.displayName ?? "");
    setRole(data?.profile?.role ?? "accountant");
  }, [data?.profile]);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {writable ? (
          <Field label="نام کاربر">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        ) : null}
        <Field label="نقش">
          <select className="field-input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="کد نقش">
          <Input dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        {writable ? (
          <Button
            onClick={async () => {
              await updateProfileName({ data: { displayName: name } });
              await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
              toast.success("ذخیره شد");
            }}
          >
            ذخیره نام
          </Button>
        ) : null}
        <Button
          onClick={async () => {
            const res = await changeRole({ data: { role, code } });
            if (res.roleToken) setRoleToken(res.roleToken);
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            setCode("");
            toast.success("نقش به‌روز شد");
          }}
        >
          ثبت نقش
        </Button>
      </div>
    </div>
  );
}

function StaffForm({ title, initial, onClose }: { title: string; initial?: StaffUser; onClose: () => void }) {
  const [name, setName] = useState(initial?.displayName ?? "");
  const [role, setRole] = useState<Role>(initial?.role ?? "seller");
  const [code, setCode] = useState("");
  return (
    <Modal open title={title} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (initial) {
            await updateStaffUser({ data: { id: initial.id, displayName: name, role, code } });
          } else {
            await addStaffUser({ data: { displayName: name, role, code } });
          }
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          toast.success("ثبت شد");
          onClose();
        }}
      >
        <Field label="نام">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="نقش">
          <select className="field-input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="کد نقش">
          <Input dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} required />
        </Field>
        <Button type="submit">ثبت</Button>
      </form>
    </Modal>
  );
}

function ModeBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        active
          ? "h-11 w-full rounded-md bg-primary text-sm font-medium text-primary-fg"
          : "h-11 w-full rounded-md text-sm text-muted hover:text-fg disabled:opacity-55"
      }
    >
      {children}
    </button>
  );
}
