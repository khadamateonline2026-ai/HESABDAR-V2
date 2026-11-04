import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeAuthFlags } from "./auth-flags.ts";

describe("computeAuthFlags", () => {
  it("treats email/password-only deploy as authConfigured without Grok secret", () => {
    const flags = computeAuthFlags({
      viteAuthEnabled: "true",
      grokClientId: undefined,
      grokClientSecret: undefined,
      emailAndPasswordEnabled: true,
    });
    assert.equal(flags.authDisabled, false);
    assert.equal(flags.grokOAuthConfigured, false);
    assert.equal(flags.authConfigured, true);
  });

  it("keeps authConfigured false when auth is explicitly disabled", () => {
    const flags = computeAuthFlags({
      viteAuthEnabled: "false",
      grokClientId: "id",
      grokClientSecret: "secret",
      emailAndPasswordEnabled: true,
    });
    assert.equal(flags.authDisabled, true);
    assert.equal(flags.grokOAuthConfigured, false);
    assert.equal(flags.authConfigured, false);
  });

  it("enables grok OAuth only when both id and secret are set", () => {
    const withBoth = computeAuthFlags({
      viteAuthEnabled: "true",
      grokClientId: "id",
      grokClientSecret: "secret",
      emailAndPasswordEnabled: false,
    });
    assert.equal(withBoth.grokOAuthConfigured, true);
    assert.equal(withBoth.authConfigured, true);

    const idOnly = computeAuthFlags({
      viteAuthEnabled: "true",
      grokClientId: "id",
      grokClientSecret: "",
      emailAndPasswordEnabled: false,
    });
    assert.equal(idOnly.grokOAuthConfigured, false);
    assert.equal(idOnly.authConfigured, false);
  });

  it("does not treat whitespace-only Grok secret as configured", () => {
    const flags = computeAuthFlags({
      viteAuthEnabled: "true",
      grokClientId: "id",
      grokClientSecret: "   ",
      emailAndPasswordEnabled: true,
    });
    assert.equal(flags.grokOAuthConfigured, false);
    assert.equal(flags.authConfigured, true);
  });
});
