/**
 * Pure flags for whether auth (and optional Grok OAuth) is active.
 *
 * Email/password alone must be enough for `requireUserId` on a deployed app
 * that has no Grok broker secret. Grok OAuth is optional and only loads when
 * both client id and secret are present.
 */
export type AuthFlagInput = {
  viteAuthEnabled: string | undefined;
  grokClientId: string | undefined;
  grokClientSecret: string | undefined;
  emailAndPasswordEnabled: boolean;
};

export type AuthFlags = {
  /** Explicit off-switch: VITE_AUTH_ENABLED === "false". */
  authDisabled: boolean;
  /** Federated Grok OAuth plugin may load. */
  grokOAuthConfigured: boolean;
  /** Any real auth path is active — sessions must be verified (not the shared dev user). */
  authConfigured: boolean;
};

export function computeAuthFlags(input: AuthFlagInput): AuthFlags {
  const authDisabled = input.viteAuthEnabled === "false";
  const grokOAuthConfigured =
    !authDisabled && Boolean(input.grokClientId?.trim() && input.grokClientSecret?.trim());
  const authConfigured =
    !authDisabled && (grokOAuthConfigured || input.emailAndPasswordEnabled);
  return { authDisabled, grokOAuthConfigured, authConfigured };
}
