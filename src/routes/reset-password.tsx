import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { authClient, authEnabled } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
    error: typeof search.error === "string" ? search.error : "",
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token, error: tokenError } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const invalidToken = useMemo(
    () => !token || tokenError === "INVALID_TOKEN",
    [token, tokenError],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!authEnabled) {
      setError("بازنشانی فعلاً فعال نیست.");
      return;
    }
    if (invalidToken) {
      setError("لینک بازنشانی نامعتبر یا منقضی است.");
      return;
    }
    if (password.length < 8) {
      setError("رمز عبور حداقل ۸ حرف باشد.");
      return;
    }
    if (password !== confirm) {
      setError("رمز عبور و تکرار آن یکسان نیست.");
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (err) throw new Error(err.message ?? "بازنشانی ناکام شد");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در بازنشانی رمز");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-bg relative grid min-h-dvh place-items-center px-4 py-10" dir="rtl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-primary)_32%,transparent),transparent)]" />
      <div className="glass login-sheet relative w-full max-w-md rounded-[22px] border border-white/20 p-6 shadow-panel sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 size-20 overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border">
            <img src="/app-icon.png" alt="حسابدار" className="size-full object-contain" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">رمز جدید</h1>
          <p className="mt-1 text-sm text-muted">رمز عبور تازه‌ای برای حساب خود بگذارید</p>
        </div>

        {done ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted">رمز عبور با موفقیت تغییر کرد.</p>
            <Link
              to="/login"
              className="flex h-11 w-full items-center justify-center rounded-sm bg-primary text-sm font-medium text-primary-fg hover:bg-primary/90"
            >
              رفتن به ورود
            </Link>
          </div>
        ) : invalidToken ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-danger">لینک بازنشانی نامعتبر یا منقضی است.</p>
            <Link to="/login" className="text-sm text-primary hover:underline">
              بازگشت به ورود و درخواست لینک تازه
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <Field label="رمز عبور جدید">
              <PasswordInput
                value={password}
                show={showPass}
                onToggle={() => setShowPass((v) => !v)}
                onChange={setPassword}
                autoComplete="new-password"
              />
            </Field>
            <Field label="تکرار رمز عبور">
              <PasswordInput
                value={confirm}
                show={showConfirm}
                onToggle={() => setShowConfirm((v) => !v)}
                onChange={setConfirm}
                autoComplete="new-password"
              />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="mt-1 flex h-11 w-full items-center justify-center rounded-sm bg-primary text-sm font-medium text-primary-fg hover:bg-primary/90 disabled:opacity-55"
            >
              {busy ? "…" : "ثبت رمز جدید"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function PasswordInput({
  value,
  show,
  onToggle,
  onChange,
  autoComplete,
}: {
  value: string;
  show: boolean;
  onToggle: () => void;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  return (
    <div className="relative" dir="ltr">
      <input
        type={show ? "text" : "password"}
        required
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("field-input login-field pe-11")}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute inset-y-0 end-0 grid w-11 place-items-center text-muted"
        aria-label={show ? "پنهان" : "نمایش"}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
