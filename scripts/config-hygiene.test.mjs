import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };

test("STR-07: vite config only references installed packages (no xlsx)", () => {
  const cfg = readFileSync("vite.config.ts", "utf8");
  assert.doesNotMatch(cfg, /["']xlsx["']/);
});

test("STR-07: the e2e runner is a declared dependency", () => {
  assert.ok(deps["@playwright/test"], "@playwright/test must be in devDependencies");
  const spec = readFileSync("e2e/smoke.spec.ts", "utf8");
  assert.match(spec, /@playwright\/test/);
});
