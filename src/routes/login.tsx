import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { authClient, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { clearRoleSession } from "@/components/onboarding";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({ component: LoginPage });

type Mode = "signin" | "signup" | "forgot";

function LoginPage() {
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  // Drop any prior role cookie when visiting login so RoleGate opens after sign-in.
  useEffect(() => {
    void clearRoleSession();
  }, []);

  if (isPending) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <div className="h-10 w-40 animate-pulse rounded-md bg-border" />
      </main>
    );
  }
  if (user) return <Navigate to="/" />;

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setInfo("");
    setPassword("");
    setConfirm("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    if (!authEnabled) {
      setError("ورود فعلاً فعال نیست.");
      return;
    }

    if (mode === "forgot") {
      if (!email.includes("@")) {
        setError("ایمیل معتبر وارد کنید.");
        return;
      }
      setBusy(true);
      try {
        const { error: err } = await authClient.requestPasswordReset({
          email: email.trim(),
        });
        if (err) throw new Error(err.message ?? "درخواست بازنشانی ناکام شد");
        // Neutral whether or not the address exists (Better Auth also returns ok).
        setInfo(
          "اگر این ایمیل در سیستم باشد، لینک بازنشانی رمز برایتان ارسال می‌شود. صندوق ورودی و هرزنامه را بررسی کنید.",
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "خطا در درخواست بازنشانی");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === "signup" && password !== confirm) {
      setError("رمز عبور و تکرار آن یکسان نیست.");
      return;
    }
    if (password.length < 8) {
      setError("رمز عبور حداقل ۸ حرف باشد.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error: err } = await authClient.signUp.email({
          email,
          password,
          name: email.split("@")[0] || "user",
        });
        if (err) throw new Error(err.message ?? "ثبت‌نام ناکام شد");
      } else {
        const { error: err } = await authClient.signIn.email({ email, password });
        if (err) throw new Error(err.message ?? "ورود ناکام شد");
      }
      await clearRoleSession();
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ورود");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setError("");
    setBusy(true);
    try {
      await clearRoleSession();
      await signIn("grok-google", { callbackURL: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "ورود با گوگل ناکام شد");
      setBusy(false);
    }
  }

  return (
    <main className="app-bg relative grid min-h-dvh place-items-center px-4 py-10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-primary)_32%,transparent),transparent)]" />
      <div className="glass login-sheet relative w-full max-w-md rounded-[22px] border border-white/20 p-6 shadow-panel sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 size-20 overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border">
            <img src="/app-icon.png" alt="حسابدار" className="size-full object-contain" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">حسابدار</h1>
          <p className="mt-1 text-sm text-muted">
            {mode === "forgot"
              ? "بازنشانی رمز عبور"
              : "دستیار محاسباتی شما - طراحی ساده و محاسبه دقیق"}
          </p>
        </div>

        {mode !== "forgot" ? (
          <div className="mb-5 grid grid-cols-2 rounded-md border border-border bg-surface-2 p-1">
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className={cn(
                "rounded-sm px-3 py-2 text-sm font-medium transition-colors",
                mode === "signin" ? "bg-surface text-fg shadow-sm" : "text-muted",
              )}
            >
              ورود
            </button>
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className={cn(
                "rounded-sm px-3 py-2 text-sm font-medium transition-colors",
                mode === "signup" ? "bg-surface text-fg shadow-sm" : "text-muted",
              )}
            >
              ثبت‌نام
            </button>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="ایمیل">
            <input
              type="email"
              required
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field-input login-field"
              autoComplete="email"
            />
          </Field>

          {mode !== "forgot" ? (
            <Field label="رمز عبور">
              <PasswordInput
                value={password}
                show={showPass}
                onToggle={() => setShowPass((v) => !v)}
                onChange={setPassword}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className="login-field"
              />
            </Field>
          ) : null}

          {mode === "signin" ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="text-sm text-primary hover:underline"
              >
                فراموشی رمز
              </button>
            </div>
          ) : null}

          {mode === "signup" ? (
            <Field label="تکرار رمز عبور">
              <PasswordInput
                value={confirm}
                show={showConfirm}
                onToggle={() => setShowConfirm((v) => !v)}
                onChange={setConfirm}
                autoComplete="new-password"
                className="login-field"
              />
            </Field>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {info ? <p className="text-sm text-muted">{info}</p> : null}
          <ButtonSubmit
            busy={busy}
            label={
              mode === "forgot" ? "ارسال لینک بازنشانی" : mode === "signup" ? "ثبت‌نام" : "ورود"
            }
          />
        </form>

        {mode === "forgot" ? (
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className="mt-4 w-full text-center text-sm text-muted hover:text-fg"
          >
            بازگشت به ورود
          </button>
        ) : (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 bg-border" />
              یا
              <span className="h-px flex-1 bg-border" />
            </div>
            <button
              type="button"
              onClick={() => void onGoogle()}
              disabled={busy}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-sm border border-border bg-surface text-sm hover:bg-surface-2 disabled:opacity-55"
            >
              ورود با گوگل
            </button>
          </>
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
  className,
}: {
  value: string;
  show: boolean;
  onToggle: () => void;
  onChange: (v: string) => void;
  autoComplete: string;
  className?: string;
}) {
  return (
    <div className="relative" dir="ltr">
      <input
        type={show ? "text" : "password"}
        required
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("field-input login-field pe-11", className)}
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

function ButtonSubmit({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-1 flex h-11 w-full items-center justify-center rounded-sm bg-primary text-sm font-medium text-primary-fg hover:bg-primary/90 disabled:opacity-55"
    >
      {busy ? "…" : label}
    </button>
  );
}
