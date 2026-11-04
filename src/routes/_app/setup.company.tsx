import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FocusEvent } from "react";
import { toast } from "sonner";
import { Guard } from "@/components/guard";
import { ImageSlot } from "@/components/image-slot";
import { useAppData } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { saveCompany } from "@/lib/api/core";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";

export const Route = createFileRoute("/_app/setup/company")({ component: Page });

function Page() {
  return (
    <Guard area="company">
      <CompanyForm />
    </Guard>
  );
}

function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);
  return inset;
}

function CompanyForm() {
  const { data } = useAppData();
  const company = data?.company;
  const writable = canWrite(data?.profile?.role, "company");
  const kb = useKeyboardInset();
  const [form, setForm] = useState({
    name: "",
    logo: null as string | null,
    licenseNo: "",
    tin: "",
    address: "",
    phone1: "",
    phone2: "",
    phone3: "",
    email: "",
  });

  useEffect(() => {
    if (!company) return;
    setForm({
      name: company.name,
      logo: company.logo,
      licenseNo: company.licenseNo,
      tin: company.tin,
      address: company.address,
      phone1: company.phone1,
      phone2: company.phone2,
      phone3: company.phone3,
      email: company.email,
    });
  }, [company]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onFieldFocus(e: FocusEvent<HTMLDivElement>) {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    if (!el.matches("input, textarea")) return;
    window.setTimeout(() => {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 300);
  }

  async function save() {
    await saveCompany({ data: form });
    await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    toast.success("ذخیره شد");
  }

  const barBottom =
    kb > 80 ? `${kb}px` : "calc(4rem + env(safe-area-inset-bottom, 0px))";

  return (
    <div className="invoice-form space-y-6" onFocusCapture={onFieldFocus}>
      <div className="flex flex-col-reverse items-stretch justify-between gap-4 sm:flex-row sm:items-center">
        <input
          disabled={!writable}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          className="field-input w-full text-xl font-bold"
        />
        <div className="flex justify-start sm:justify-end">
          <ImageSlot src={form.logo} editable={writable} onChange={(v) => set("logo", v)} size={112} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-surface p-4">
        <Field label="شماره جواز">
          <Input disabled={!writable} value={form.licenseNo} onChange={(e) => set("licenseNo", e.target.value)} />
        </Field>
        <Field label="شماره مالیاتی (TIN)">
          <Input disabled={!writable} dir="ltr" value={form.tin} onChange={(e) => set("tin", e.target.value)} />
        </Field>
        <Field label="شماره تماس ۱">
          <Input disabled={!writable} dir="ltr" value={form.phone1} onChange={(e) => set("phone1", e.target.value)} />
        </Field>
        <Field label="شماره تماس ۲">
          <Input disabled={!writable} dir="ltr" value={form.phone2} onChange={(e) => set("phone2", e.target.value)} />
        </Field>
        <Field label="شماره تماس ۳">
          <Input disabled={!writable} dir="ltr" value={form.phone3} onChange={(e) => set("phone3", e.target.value)} />
        </Field>
        <Field label="ایمیل">
          <Input disabled={!writable} dir="ltr" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="آدرس">
            <Textarea disabled={!writable} value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
        </div>
      </div>

      {writable ? (
        <>
          <div className="h-24" />
          <div
            className="fixed inset-x-0 z-40 border-t border-border bg-surface px-3 py-2.5 shadow-panel"
            style={{ bottom: barBottom }}
          >
            <div className="mx-auto flex max-w-6xl justify-start gap-2">
              <Button onClick={() => void save()}>ذخیره</Button>
              <Button
                variant="secondary"
                onClick={() =>
                  company &&
                  setForm({
                    name: company.name,
                    logo: company.logo,
                    licenseNo: company.licenseNo,
                    tin: company.tin,
                    address: company.address,
                    phone1: company.phone1,
                    phone2: company.phone2,
                    phone3: company.phone3,
                    email: company.email,
                  })
                }
              >
                لغو
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
