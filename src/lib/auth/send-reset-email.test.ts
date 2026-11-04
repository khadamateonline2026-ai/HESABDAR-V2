import assert from "node:assert/strict";
import test from "node:test";
import { appPublicUrl, sendResetPasswordEmail } from "./send-reset-email.ts";
import { _resetPasswordResetRateLimitForTests } from "./password-reset-rate-limit.ts";

test("appPublicUrl strips trailing slash", () => {
  const prevApp = process.env.APP_URL;
  const prevAuth = process.env.BETTER_AUTH_URL;
  process.env.APP_URL = "https://example.com/";
  delete process.env.BETTER_AUTH_URL;
  assert.equal(appPublicUrl(), "https://example.com");
  process.env.APP_URL = prevApp;
  process.env.BETTER_AUTH_URL = prevAuth;
});

test("sendResetPasswordEmail posts to Resend with APP_URL token link", async () => {
  _resetPasswordResetRateLimitForTests();
  const prev = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    APP_URL: process.env.APP_URL,
  };
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "HESABDAR <noreply@example.com>";
  process.env.APP_URL = "https://hesabdar-v2.vercel.app";

  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ id: "re_mock_id" }), { status: 200 });
  }) as typeof fetch;

  try {
    await sendResetPasswordEmail({
      user: { email: "khadamateonline2026@gmail.com", name: "Owner" },
      url: "https://unused.example/callback",
      token: "tok_abc",
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.RESEND_API_KEY = prev.RESEND_API_KEY;
    process.env.EMAIL_FROM = prev.EMAIL_FROM;
    process.env.APP_URL = prev.APP_URL;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body.to, ["khadamateonline2026@gmail.com"]);
  assert.match(body.text, /https:\/\/hesabdar-v2\.vercel\.app\/reset-password\?token=tok_abc/);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.match(headers.Authorization, /re_test_key/);
});
