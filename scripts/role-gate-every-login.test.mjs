import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = readFileSync(join(root, "src/lib/api/core.ts"), "utf8");
const onboarding = readFileSync(join(root, "src/components/onboarding.tsx"), "utf8");
const login = readFileSync(join(root, "src/routes/login.tsx"), "utf8");
const sessionRole = readFileSync(join(root, "src/lib/auth/session-role.server.ts"), "utf8");

test("clearSessionRole server fn clears httpOnly role cookie", () => {
  assert.match(core, /export const clearSessionRole = createServerFn/);
  assert.match(core, /clearRoleCookie/);
});

test("clearRoleSession awaits server clear; logout and login call it", () => {
  assert.match(onboarding, /async function clearRoleSession/);
  assert.match(onboarding, /await clearSessionRole\(\)/);
  assert.match(onboarding, /await clearRoleSession\(\)/);
  assert.match(login, /await clearRoleSession\(\)/);
  assert.match(login, /useEffect\(\(\) => \{\s*void clearRoleSession\(\);/s);
  assert.match(login, /await clearRoleSession\(\);\s*await signIn\("grok-google"/s);
});

test("role cookie remains httpOnly with TTL; PIN hashing still used", () => {
  assert.match(sessionRole, /httpOnly:\s*true/);
  assert.match(sessionRole, /TOKEN_TTL_MS = 12 \* 60 \* 60 \* 1000/);
  assert.match(core, /verifyPin/);
  assert.match(core, /hashPin/);
});
