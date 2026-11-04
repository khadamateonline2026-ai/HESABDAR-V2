import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const login = readFileSync(join(root, "src/routes/login.tsx"), "utf8");
const reset = readFileSync(join(root, "src/routes/reset-password.tsx"), "utf8");
const styles = readFileSync(join(root, "src/styles.css"), "utf8");
const server = readFileSync(join(root, "src/lib/auth/server.ts"), "utf8");
const sendReset = readFileSync(join(root, "src/lib/auth/send-reset-email.ts"), "utf8");
const onboarding = readFileSync(join(root, "src/components/onboarding.tsx"), "utf8");

test("signup password and confirm both use login-field styling", () => {
  const passwordBlocks = [...login.matchAll(/<PasswordInput[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(passwordBlocks.length, 2, "expected password + confirm PasswordInput");
  for (const block of passwordBlocks) {
    assert.match(block, /login-field/, `missing login-field in:\n${block}`);
  }
  assert.match(login, /field-input login-field pe-11/);
});

test("login-field autofill override uses webkit box-shadow and long transition", () => {
  assert.match(styles, /-webkit-box-shadow:\s*0 0 0 1000px var\(--login-field-bg\) inset/);
  assert.match(styles, /-webkit-text-fill-color:\s*var\(--color-fg\)/);
  assert.match(styles, /transition:\s*background-color 99999s/);
  assert.match(styles, /:-webkit-autofill/);
  assert.match(styles, /:autofill/);
});

test("login tab exposes forgot-password link and requestPasswordReset", () => {
  assert.match(login, /فراموشی رمز/);
  assert.match(login, /requestPasswordReset/);
  assert.match(login, /mode === "forgot"/);
});

test("reset-password page uses styled login fields and resetPassword", () => {
  assert.match(reset, /createFileRoute\("\/reset-password"\)/);
  assert.match(reset, /authClient\.resetPassword/);
  assert.match(reset, /login-field/);
  assert.match(reset, /تکرار رمز عبور/);
});

test("better-auth sendResetPassword wired with ~1h expiry and Resend", () => {
  assert.match(server, /sendResetPassword/);
  assert.match(server, /resetPasswordTokenExpiresIn:\s*60 \* 60/);
  assert.match(sendReset, /api\.resend\.com\/emails/);
  assert.match(sendReset, /RESEND_API_KEY/);
  assert.match(sendReset, /EMAIL_FROM/);
  assert.match(sendReset, /\/reset-password\?token=/);
  assert.match(sendReset, /assertPasswordResetAllowed/);
});

test("onboarding first field is person name, not company name", () => {
  assert.match(onboarding, /label="نام"/);
  assert.doesNotMatch(onboarding, /label="نام شرکت"/);
  assert.match(onboarding, /displayName/);
  assert.match(onboarding, /placeholder="نام کسی که این نقش‌ها را مدیریت می‌کند"/);
});
