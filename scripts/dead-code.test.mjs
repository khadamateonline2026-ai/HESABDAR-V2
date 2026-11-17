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
