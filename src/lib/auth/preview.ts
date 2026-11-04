/**
 * Shared LIVE-PREVIEW OAuth client defaults (server-only — NEVER import from the client).
 *
 * Secrets MUST come from environment variables. Never commit a real client secret.
 * Set GROK_AUTH_CLIENT_ID / GROK_AUTH_CLIENT_SECRET (or GROK_PREVIEW_CLIENT_*) in
 * the sandbox / Vercel env. Without a secret, federated preview OAuth stays off.
 */
export const PREVIEW_CLIENT_ID =
  process.env.GROK_AUTH_CLIENT_ID?.trim() ||
  process.env.GROK_PREVIEW_CLIENT_ID?.trim() ||
  "grok_preview";

/** Empty unless env provides it — no hardcoded secret in the repo. */
export const PREVIEW_CLIENT_SECRET =
  process.env.GROK_AUTH_CLIENT_SECRET?.trim() ||
  process.env.GROK_PREVIEW_CLIENT_SECRET?.trim() ||
  "";

/** The shared auth broker issuer (OIDC discovery lives under it). */
export const GROK_ISSUER_DEFAULT = "https://auth.grok.me";

/**
 * Host patterns whose callbacks the preview client accepts.
 */
export const PREVIEW_ALLOWED_HOSTS = ["*.grok-sandbox.com"] as const;
