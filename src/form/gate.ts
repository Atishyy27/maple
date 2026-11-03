/**
 * Is this page a sign-in or sign-up wall rather than an application form?
 *
 * Fynd, 2 Nov 2026: the posting redirected to /candidate/login, and the only
 * box, "Email or phone number", matched the phone alias, so the tool typed the
 * phone number into a login form. Creating or using an account is the person's
 * job, never the tool's, so a gate must be filled with nothing.
 */
const GATE_URL = /\/(login|log-in|signin|sign-in|sign_in|signup|sign-up|register|auth)(\/|\?|#|$)/i;
const GATE_LABEL = /password|one[- ]time|\botp\b|verification code|email or (phone|mobile)|phone or email|username/i;

export function isAuthGate(labels: string[], url: string): boolean {
  if (GATE_URL.test(new URL(url, "http://x").pathname)) return true;
  return labels.length <= 3 && labels.some((l) => GATE_LABEL.test(l));
}
