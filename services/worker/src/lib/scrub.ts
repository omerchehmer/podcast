/**
 * Removes sensitive personal data from the listener profile before it is stored.
 * This is the fast, rule-based pass. An LLM pass (see pipeline/scrubLlm) catches what rules miss
 * (for example health details written in plain words).
 *
 * We return only the TYPES of data removed, never the data itself, so it is safe to store and show.
 */
export type RemovedKind =
  | "card_number"
  | "iban"
  | "bank_account"
  | "government_id"
  | "email"
  | "phone"
  | "password"
  | "api_key";

interface Rule {
  kind: RemovedKind;
  re: RegExp;
  /** Optional extra check to cut false positives. */
  valid?: (match: string) => boolean;
}

/** Luhn check for card numbers. */
function luhn(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const RULES: Rule[] = [
  { kind: "password", re: /\b(pass(word)?|pwd|pin)\s*[:=]\s*\S+/gi },
  { kind: "api_key", re: /\b(sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,})\b/g },
  { kind: "card_number", re: /\b(?:\d[ -]?){13,19}\b/g, valid: luhn },
  { kind: "iban", re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g },
  { kind: "bank_account", re: /\b(account|acct)\s*(no\.?|number|#)?\s*[:#]?\s*\d{6,}\b/gi },
  { kind: "government_id", re: /\b(\d{3}-\d{2}-\d{4}|passport\s*(no\.?|number|#)?\s*[:#]?\s*[A-Z0-9]{6,9}|(id|teudat zehut|national id)\s*(no\.?|number|#)?\s*[:#]?\s*\d{8,9})\b/gi },
  { kind: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: "phone", re: /(?<![\w-])\+?\d{1,3}[ .-]?\(?\d{2,4}\)?[ .-]?\d{3,4}[ .-]?\d{3,4}(?![\w-])/g },
];

export interface ScrubResult {
  text: string;
  removed: RemovedKind[];
}

export function scrubSensitive(input: string): ScrubResult {
  let text = input;
  const removed = new Set<RemovedKind>();
  for (const rule of RULES) {
    text = text.replace(rule.re, (m) => {
      if (rule.valid && !rule.valid(m)) return m;
      removed.add(rule.kind);
      return "[removed]";
    });
  }
  return { text, removed: [...removed] };
}

/** Plain-language labels for the "what we removed" note in the app. */
export const REMOVED_LABELS: Record<RemovedKind, string> = {
  card_number: "a card number",
  iban: "a bank account (IBAN)",
  bank_account: "a bank account number",
  government_id: "an ID or passport number",
  email: "an email address",
  phone: "a phone number",
  password: "a password",
  api_key: "a secret key",
};
