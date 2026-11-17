import "@/lib/testing/test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb } from "@/lib/testing/pglite-db";

const API = join(process.cwd(), "src/lib/api");
const files = readdirSync(API).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

/** Every sql`…` / tx`…` template in the API, with ${…} (nested templates too) as $n. */
function sqlTemplates(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const re = /\b(?:sql|tx)(?:<[^`>]*(?:<[^`>]*>[^`>]*)*>)?`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let text = "";
    let n = 0;
    while (i < src.length && src[i] !== "`") {
      if (src[i] === "$" && src[i + 1] === "{") {
        let depth = 1;
        i += 2;
        while (i < src.length && depth > 0) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}") depth--;
          else if (src[i] === "`") {
            i++;
            while (i < src.length && src[i] !== "`") i++;
          }
          i++;
        }
        text += `$${++n}`;
        continue;
      }
      text += src[i++];
    }
    re.lastIndex = i + 1;
    if (/\b(select|insert|update|delete)\b/i.test(text)) {
      out.push({ line: src.slice(0, m.index).split("\n").length, text });
    }
  }
  return out;
}

async function brokenQueries(upTo?: string): Promise<string[]> {
  const db = await createTestDb(upTo ? { upTo } : {});
  const bad: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(API, f), "utf8");
    for (const q of sqlTemplates(src)) {
      try {
        await db.pg.describeQuery(q.text);
      } catch (e) {
        bad.push(`${f}:${q.line}: ${(e as Error).message}`);
      }
    }
  }
  await db.close();
  return bad;
}

test("STR-01 bug: before 0033 a fresh DB lacked columns the app only added at request time", async () => {
  const bad = await brokenQueries("0032_role_pin_version.sql");
  assert.ok(bad.length > 0, "queries failed on a fresh DB unless some other page ran its ALTER first");
  assert.ok(bad.some((b) => /production_enabled|font_family|received_fx_rate|shop_only/.test(b)), bad.join("\n"));
});

test("STR-01 fix: every API query is valid on a DB built from migrations alone", async () => {
  const bad = await brokenQueries();
  assert.deepEqual(bad, []);
});

test("STR-01 invariant: no schema changes at request time", () => {
  for (const f of files) {
    const src = readFileSync(join(API, f), "utf8");
    assert.doesNotMatch(src, /\.query\(\s*["'`]\s*(alter|create|drop)\s+(table|index)/i, f);
  }
});
