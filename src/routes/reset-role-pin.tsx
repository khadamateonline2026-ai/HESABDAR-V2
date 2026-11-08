import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { applyRoleResetLink } from "@/lib/api/core";

export const Route = createFileRoute("/reset-role-pin")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: ResetRolePinPage,
});

function ResetRolePinPage() {
  const { token } = Route.useSearch();
  const [role, setRole] = useState("accountant");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const toEn = (v: string) => v.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
    const pinEn = toEn(pin);
    const confirmEn = toEn(confirm);
    if (!token) return setError("لینک نامعتبر یا منقضی است.");
    if (!/^\d{4,}$/.test(pinEn)) return setError("کد نقش باید حداقل ۴ رقم باشد.");
    if (pinEn !== confirmEn) return setError("کد و تکرار آن یکسان نیست.");
    setBusy(true);
    try {
      const res = await applyRoleResetLink({ data: { token, role, pin: pinEn } });
      setDone(res.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "بازنشانی ناکام شد");
    } finally {
      setBusy(false);
    }
  }

  const roles = [
    { id: "accountant", label: "حسابدار" },
    { id: "seller", label: "فروشنده" },
    { id: "supervisor", label: "ناظر" },
  ];
  const primary =
    "mt-1 flex h-11 w-full items-center justify-center rounded-sm bg-primary text-sm font-medium text-primary-fg hover:bg-primary/90 disabled:opacity-55";
  return (
    <main className="app-bg relative grid min-h-dvh place-items-center px-4 py-10" dir="rtl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-primary)_32%,transparent),transparent)]" />
      <div className="glass login-sheet relative w-full max-w-md rounded-[22px] border border-white/20 p-6 shadow-panel sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 size-20 overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border">
            <img src="/app-icon.png" alt="حسابدار" className="size-full object-contain" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">کد جدید نقش</h1>
          <p className="mt-1 text-sm text-muted">نقش را انتخاب کنید و کد تازه بگذارید</p>
        </div>
        {done ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted">کد نقش «{done}» با موفقیت تغییر کرد. این لینک دیگر کار نمی‌کند.</p>
            <Link to="/" className={primary}>بازگشت به حسابدار</Link>
          </div>
        ) : !token ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-danger">لینک بازنشانی نامعتبر یا منقضی است.</p>
            <Link to="/" className="text-sm text-primary hover:underline">بازگشت و درخواست لینک تازه</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <span className="mb-1.5 block text-sm font-medium">نقش</span>
              <div className="grid grid-cols-3 gap-2" role="radiogroup">
                {roles.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={role === r.id}
                    onClick={() => setRole(r.id)}
                    className={
                      "h-11 rounded-sm border text-sm font-medium transition " +
                      (role === r.id
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-surface-2/60 text-muted hover:border-primary/50")
                    }
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">کد جدید (حداقل ۴ رقم)</span>
              <input className="field-input login-field text-center tracking-[0.4em]" dir="ltr" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9۰-۹]/g, ""))} required />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">تکرار کد</span>
              <input className="field-input login-field text-center tracking-[0.4em]" dir="ltr" type="password" inputMode="numeric" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/[^0-9۰-۹]/g, ""))} required />
            </label>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button type="submit" disabled={busy} className={primary}>
              {busy ? "…" : "ثبت کد جدید"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
