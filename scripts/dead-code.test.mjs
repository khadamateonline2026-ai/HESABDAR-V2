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
