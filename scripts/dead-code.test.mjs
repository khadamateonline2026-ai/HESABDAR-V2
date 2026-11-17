import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

test("DEL-01: unused modules are removed", () => {
  for (const f of [
    "src/components/excel-button.tsx",
    "src/lib/drive-backup-client.ts",
    "src/lib/google-cloud-backup.ts",
    "src/lib/multiplayer",
  ]) {
    assert.equal(existsSync(f), false, `${f} has no importers and should be gone`);
  }
});

test("DEL-02: unused exported helpers are removed", async () => {
  const { readFileSync } = await import("node:fs");
  const where = {
    syncCurrencyToAccount: "src/components/currency-match.tsx",
    InvoiceTotals: "src/components/invoice-ui.tsx",
    useInvalidate: "src/components/layout/app-shell.tsx",
    logActivity: "src/lib/api/helpers.ts",
    idOf: "src/lib/format.ts",
    usePrefs: "src/lib/prefs.tsx",
    isFirstStage: "src/lib/types.ts",
    formatJalaliYmd: "src/lib/jalali.ts",
    headerDateLine: "src/lib/jalali.ts",
  };
  for (const [name, file] of Object.entries(where)) {
    assert.doesNotMatch(readFileSync(file, "utf8"), new RegExp(`export (async )?function ${name}\\b`), `${name} in ${file}`);
  }
});

test("DEL-03: server functions with no caller are removed", async () => {
  const { readFileSync } = await import("node:fs");
  const where = {
    "src/lib/api/ops.ts": ["listPurchases", "savePurchase", "deletePurchase", "listSales", "saveSale", "deleteSale", "getReports"],
    "src/lib/api/core.ts": ["applyRoleReset"],
    "src/lib/api/setup.ts": ["saveItemType"],
    "src/lib/api/workspace.ts": ["listCloudBackups", "restoreCloudBackup", "deleteCloudBackup", "saveCloudBackup"],
  };
  for (const [file, names] of Object.entries(where)) {
    const src = readFileSync(file, "utf8");
    for (const n of names) assert.doesNotMatch(src, new RegExp(`export const ${n} =`), `${n} in ${file}`);
  }
  assert.doesNotMatch(readFileSync("src/lib/api/core.ts", "utf8"), /function resetHash\(/);
});

const UNUSED_DEPS = [
  "@hookform/resolvers", "@radix-ui/react-accordion", "@radix-ui/react-alert-dialog", "@radix-ui/react-avatar",
  "@radix-ui/react-checkbox", "@radix-ui/react-collapsible", "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-label", "@radix-ui/react-popover", "@radix-ui/react-progress", "@radix-ui/react-radio-group",
  "@radix-ui/react-scroll-area", "@radix-ui/react-select", "@radix-ui/react-separator", "@radix-ui/react-slider",
  "@radix-ui/react-slot", "@radix-ui/react-switch", "@radix-ui/react-tabs", "@radix-ui/react-toggle",
  "@radix-ui/react-toggle-group", "@radix-ui/react-tooltip", "@tanstack/react-table", "@tanstack/router-plugin",
  "class-variance-authority", "cmdk", "date-fns", "react-day-picker", "react-hook-form", "react-resizable-panels",
  "recharts", "tw-animate-css", "vaul",
];

test("DEL-04: direct dependencies nothing imports are not declared", async () => {
  const { readFileSync } = await import("node:fs");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const d of UNUSED_DEPS) assert.equal(declared[d], undefined, `${d} is unused`);
  // The Start vite plugin still brings the router plugin in as its own dependency.
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  assert.ok(lock.packages["node_modules/@tanstack/router-plugin"], "router-plugin stays as a transitive dependency");
});
