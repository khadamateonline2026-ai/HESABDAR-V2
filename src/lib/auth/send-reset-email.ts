import {
  assertPasswordResetAllowed,
  recordPasswordResetRequest,
} from "./password-reset-rate-limit";

const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

export function appPublicUrl(): string {
  const raw = env("APP_URL") ?? env("BETTER_AUTH_URL") ?? "http://localhost:8080";
  return raw.replace(/\/+$/, "");
}

export type SendResetPasswordArgs = {
  user: { email: string; name?: string | null };
  url: string;
  token: string;
};

/**
 * Send a Persian password-reset email via Resend.
 * Link points at APP_URL/reset-password?token=… (not the Better Auth callback hop).
 */
export async function sendResetPasswordEmail(
  { user, token }: SendResetPasswordArgs,
): Promise<void> {
  assertPasswordResetAllowed(user.email);

  const key = env("RESEND_API_KEY");
  const from = env("EMAIL_FROM") ?? env("ROLE_MAIL_FROM");
  if (!key || !from) {
    throw new Error("ارسال ایمیل روی این سرور فعال نیست");
  }

  const link = `${appPublicUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [user.email],
      subject: "بازنشانی رمز عبور حسابدار",
      text:
        `برای تنظیم رمز عبور جدید روی لینک زیر بزنید (حدود یک ساعت معتبر است):\n\n` +
        `${link}\n\n` +
        `اگر شما این درخواست را نداده‌اید، این پیام را نادیده بگیرید.`,
      html:
        `<p dir="rtl">برای تنظیم رمز عبور جدید روی لینک زیر بزنید (حدود یک ساعت معتبر است):</p>` +
        `<p><a href="${link}">${link}</a></p>` +
        `<p dir="rtl">اگر شما این درخواست را نداده‌اید، این پیام را نادیده بگیرید.</p>`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ارسال ایمیل ناکام شد${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }

  const payload = (await res.json().catch(() => null)) as { id?: string } | null;
  console.info("[password-reset] Resend accepted", {
    id: payload?.id ?? null,
    to: user.email,
  });

  recordPasswordResetRequest(user.email);
}
