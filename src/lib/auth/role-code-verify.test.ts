import assert from "node:assert/strict";
import test from "node:test";
import { assertPinShape, hashPin, verifyPin } from "./pin-hash.ts";
import type { Role } from "../types.ts";

/**
 * Mirrors helpers.assertAccountantPin / assertRolePin without pulling DB helpers
 * (same verifyPin contract the production-module toggle now uses).
 */
function assertRolePin(
  codes: Record<Role, string>,
  role: Role,
  code: string,
  message = "کد نقش نادرست است",
): void {
  if (!verifyPin(code.trim(), codes[role] ?? "")) throw new Error(message);
}

function assertAccountantPin(codes: Record<Role, string>, code: string): void {
  assertRolePin(codes, "accountant", code, "کد نقش حسابدار نادرست است");
}

test("onboarding hashed accountant PIN unlocks production-module toggle", () => {
  const plain = "4821";
  assertPinShape(plain);
  // completeOnboarding / saveRoleCodes store scrypt hashes
  const codes: Record<Role, string> = {
    supervisor: hashPin("1111"),
    accountant: hashPin(plain),
    seller: hashPin("3333"),
  };
  // saveProductionEnabled path
  assert.doesNotThrow(() => assertAccountantPin(codes, plain));
  assert.doesNotThrow(() => assertAccountantPin(codes, `  ${plain}  `));
  assert.throws(() => assertAccountantPin(codes, "4822"), /حسابدار/);
  // plaintext === would fail against the hash — that was the production bug
  assert.notEqual(codes.accountant, plain);
  assert.equal(codes.accountant === plain, false);
  assert.equal(verifyPin(plain, codes.accountant), true);
});

test("legacy plaintext accountant PIN still accepted", () => {
  const codes: Record<Role, string> = {
    supervisor: "1111",
    accountant: "9999",
    seller: "3333",
  };
  assert.doesNotThrow(() => assertAccountantPin(codes, "9999"));
  assert.throws(() => assertAccountantPin(codes, "0000"), /حسابدار/);
});

test("assertPinShape keeps min length 4", () => {
  assert.throws(() => assertPinShape("123"), /۴/);
  assert.doesNotThrow(() => assertPinShape("1234"));
});
