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
    if (!token) return setError("لینک نامعتبر یا منقضی است.");
    if (!/^\d{4,}$/.test(pin)) return setError("کد نقش باید حداقل ۴ رقم باشد.");
    if (pin !== confirm) return setError("کد و تکرار آن یکسان نیست.");
    setBusy(true);
    try {
      const res = await applyRoleResetLink({ data: { token, role, pin } });
      setDone(res.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "بازنشانی ناکام شد");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-md border border-border bg-transparent px-3 py-2";
  return (
    <div dir="rtl" className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-bold">تعیین کد جدید نقش</h1>
      {done ? (
        <>
          <p className="text-sm">کد نقش «{done}» عوض شد. این لینک دیگر کار نمی‌کند.</p>
          <Link to="/" className="text-sm underline">بازگشت به حسابدار</Link>
        </>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm">
            نقش
            <select className={input} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="accountant">حسابدار</option>
              <option value="seller">فروشنده</option>
              <option value="supervisor">ناظر</option>
            </select>
          </label>
          <label className="block text-sm">
            کد جدید (حداقل ۴ رقم)
            <input className={input} dir="ltr" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} required />
          </label>
          <label className="block text-sm">
            تکرار کد
            <input className={input} dir="ltr" type="password" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <button type="submit" disabled={busy} className="w-full rounded-md bg-primary px-3 py-2 text-primary-foreground">
            {busy ? "…" : "ثبت کد جدید"}
          </button>
        </form>
      )}
    </div>
  );
}
