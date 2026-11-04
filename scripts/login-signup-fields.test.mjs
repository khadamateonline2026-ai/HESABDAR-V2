import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const login = readFileSync(join(root, "src/routes/login.tsx"), "utf8");
const onboarding = readFileSync(join(root, "src/components/onboarding.tsx"), "utf8");

test("signup password and confirm both use login-field styling", () => {
  const passwordBlocks = [...login.matchAll(/<PasswordInput[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(passwordBlocks.length, 2, "expected password + confirm PasswordInput");
  for (const block of passwordBlocks) {
    assert.match(block, /login-field/, `missing login-field in:\n${block}`);
  }
  // PasswordInput itself always applies login-field on the input
  assert.match(login, /field-input login-field pe-11/);
});

test("onboarding first field is person name, not company name", () => {
  assert.match(onboarding, /label="نام"/);
  assert.doesNotMatch(onboarding, /label="نام شرکت"/);
  assert.match(onboarding, /displayName/);
  assert.match(onboarding, /placeholder="نام کسی که این نقش‌ها را مدیریت می‌کند"/);
});
