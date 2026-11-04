import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { changeRole, completeOnboarding, applyRoleReset, requestRoleReset } from "@/lib/api/core";
import { signOut } from "@/lib/auth/client";
import { queryClient } from "@/lib/query-client";
import { clearRoleToken, setRoleToken } from "@/lib/session-role-client";
import { ROLE_LABELS, type Role, type StaffUser } from "@/lib/types";

export function clearRoleSession() {
  clearRoleToken();
}

export async function logoutNow() {
  clearRoleSession();
  await signOut("/login");
}

function suggestCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function OnboardingModal({ open }: { open: boolean; userId: string }) {
  const [displayName, setDisplayName] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [supervisor, setSupervisor] = useState(suggestCode);
  const [accountant, setAccountant] = useState(suggestCode);
  const [seller, setSeller] = useState(suggestCode);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await completeOnboarding({
        data: { displayName, companyEmail, supervisor, accountant, seller },
      });
      if (res.roleToken) setRoleToken(res.roleToken);
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت ناکام شد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="تنظیم نقش" onClose={() => undefined} hideClose>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">برای هر نقش یک رمز انتخاب کنید. پیشنهاد برنامه را می‌توانید عوض کنید.</p>
        <Field label="نام">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="نام کسی که این نقش‌ها را مدیریت می‌کند"
            required
          />
        </Field>
        <Field label="ایمیل شرکت">
          <Input dir="ltr" type="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} required />
        </Field>
        <Field label={ROLE_LABELS.accountant}>
          <Input dir="ltr" value={accountant} onChange={(e) => setAccountant(e.target.value)} required />
        </Field>
        <Field label={ROLE_LABELS.seller}>
          <Input dir="ltr" value={seller} onChange={(e) => setSeller(e.target.value)} required />
        </Field>
        <Field label={ROLE_LABELS.supervisor}>
          <Input dir="ltr" value={supervisor} onChange={(e) => setSupervisor(e.target.value)} required />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "…" : "ذخیره و ورود با نقش حسابدار"}
        </Button>
      </form>
    </Modal>
  );
}

export function RoleGateModal({
  open,
  currentRole,
  staff = [],
  onDone,
}: {
  open: boolean;
  userId: string;
  currentRole: Role;
  staff?: StaffUser[];
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>(currentRole || "accountant");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [accountant, setAccountant] = useState("");
  const [seller, setSeller] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const displayName = name.trim();
      if (!displayName) throw new Error("اسم لازم است");
      const res = await changeRole({ data: { role, code, displayName } });
      if (res.roleToken) setRoleToken(res.roleToken);
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "کد نقش نادرست است");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="نقش کاربری" onClose={() => undefined} hideClose>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">فقط پس از ورود به حساب، اسم، نقش و کد را یک‌بار وارد کنید.</p>
        <Field label="اسم">
          <Input
            value={name}
            list="gate-staff-names"
            placeholder="نام خود را بنویسید"
            onChange={(e) => {
              const next = e.target.value;
              setName(next);
              const hit = staff.find((s) => s.displayName === next);
              if (hit) setRole(hit.role);
            }}
            required
          />
          <datalist id="gate-staff-names">
            {staff.map((s) => (
              <option key={s.id} value={s.displayName} />
            ))}
          </datalist>
        </Field>
        <RoleFields role={role} code={code} onRole={setRole} onCode={setCode} />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "…" : "ورود با این نقش"}
        </Button>
        <button
          type="button"
          className="w-full text-center text-sm text-muted underline"
          onClick={() => {
            setForgot(true);
            setError("");
          }}
        >
          فراموشی رمز نقش
        </button>
      </form>
      {forgot ? (
        <form
          className="mt-4 space-y-3 border-t border-border pt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              if (!sentTo) {
                const res = await requestRoleReset();
                setSentTo(res.email);
              } else {
                await applyRoleReset({ data: { emailCode, supervisor, accountant, seller } });
                setForgot(false);
                setSentTo("");
                setEmailCode("");
                setCode("");
                setError("");
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : "بازنشانی ناکام شد");
            } finally {
              setBusy(false);
            }
          }}
        >
          {sentTo ? (
            <>
              <p className="text-sm text-muted">کد به {sentTo} فرستاده شد. رمز ورود عوض نمی‌شود.</p>
              <Field label="کد ایمیل">
                <Input dir="ltr" value={emailCode} onChange={(e) => setEmailCode(e.target.value)} required />
              </Field>
              <Field label={ROLE_LABELS.accountant}>
                <Input dir="ltr" value={accountant} onChange={(e) => setAccountant(e.target.value)} required />
              </Field>
              <Field label={ROLE_LABELS.seller}>
                <Input dir="ltr" value={seller} onChange={(e) => setSeller(e.target.value)} required />
              </Field>
              <Field label={ROLE_LABELS.supervisor}>
                <Input dir="ltr" value={supervisor} onChange={(e) => setSupervisor(e.target.value)} required />
              </Field>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "…" : "ثبت رمزهای جدید"}
              </Button>
            </>
          ) : (
            <Button type="submit" disabled={busy} className="w-full" variant="secondary">
              {busy ? "…" : "فرستادن کد به ایمیل شرکت"}
            </Button>
          )}
        </form>
      ) : null}
    </Modal>
  );
}

function RoleFields({
  role,
  code,
  onRole,
  onCode,
}: {
  role: Role;
  code: string;
  onRole: (r: Role) => void;
  onCode: (v: string) => void;
}) {
  return (
    <>
      <Field label="نقش کاربری">
        <select className="field-input" value={role} onChange={(e) => onRole(e.target.value as Role)}>
          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="کد نقش">
        <Input
          dir="ltr"
          inputMode="numeric"
          value={code}
          onChange={(e) => onCode(e.target.value)}
          required
        />
      </Field>
    </>
  );
}
