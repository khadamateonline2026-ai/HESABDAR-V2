/** Default company row when onboarding only asks for the person name. */
export const DEFAULT_COMPANY_NAME = "شرکت من";

export type OnboardingIdentityInput = {
  /** Person who creates/manages roles (preferred). */
  displayName?: string;
  /** Legacy field — treated as displayName when displayName is empty. */
  companyName?: string;
};

export type OnboardingIdentity = {
  displayName: string;
  companyName: string;
};

/**
 * Onboarding first field is a person name (profile / owner display name).
 * Company name stays optional with a stable default so existing company screens work.
 */
export function resolveOnboardingIdentity(input: OnboardingIdentityInput): OnboardingIdentity {
  const displayName = (input.displayName ?? input.companyName ?? "").trim();
  if (!displayName) throw new Error("نام لازم است");
  return { displayName, companyName: DEFAULT_COMPANY_NAME };
}
