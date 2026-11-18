import type { CompliancePolicyConfig, DetectionKind, SpanMatch } from "../types.js";
import { redactPreview } from "../util.js";

/**
 * Stage 1A — deterministic regex scanner.
 * Every rule here is ground truth: a regex hit is ALWAYS classified SECRET
 * (confidence 1.0) and can never be downgraded by the on-device classifier.
 */

interface RegexRule {
  readonly id: string;
  readonly kind: DetectionKind;
  readonly re: RegExp;
  readonly gate?: keyof CompliancePolicyConfig["ruleSets"];
}

const RULES: readonly RegexRule[] = [
  {
    id: "regex.stripe.secret_key",
    kind: "API_KEY",
    re: /\bsk_(?:live|test)_[0-9a-zA-Z]{16,}/g,
    gate: "apiKeys",
  },
  {
    id: "regex.aws.access_key",
    kind: "API_KEY",
    re: /\bAKIA[0-9A-Z]{16}\b/g,
    gate: "apiKeys",
  },
  {
    id: "regex.github.token",
    kind: "API_KEY",
    re: /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g,
    gate: "apiKeys",
  },
  {
    id: "regex.slack.token",
    kind: "API_KEY",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    gate: "apiKeys",
  },
  {
    id: "regex.google.api_key",
    kind: "API_KEY",
    re: /\bAIza[0-9A-Za-z_\-]{30,}\b/g,
    gate: "apiKeys",
  },
  {
    id: "regex.jwt",
    kind: "JWT",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    gate: "jwts",
  },
  {
    id: "regex.email",
    kind: "EMAIL",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    gate: "emails",
  },
  {
    id: "regex.internal_url",
    kind: "INTERNAL_URL",
    re: /\bhttps?:\/\/[^\s"'<>]*?\b(?:staging|stag|stage|internal|intranet|corp|preprod)\b[^\s"'<>]*/gi,
    gate: "internalUrls",
  },
];

let matchCounter = 0;
export function resetMatchIds(): void {
  matchCounter = 0;
}
export function nextMatchId(): string {
  matchCounter += 1;
  return `m_${String(matchCounter).padStart(3, "0")}`;
}

export function scanRegex(
  raw: string,
  policy: CompliancePolicyConfig,
): SpanMatch[] {
  const out: SpanMatch[] = [];
  const language = "text"; // callers re-tag with the detected language
  for (const rule of RULES) {
    if (rule.gate && !policy.ruleSets[rule.gate]) continue;
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      out.push({
        id: nextMatchId(),
        span: { start: m.index, end: m.index + m[0].length, language },
        kind: rule.kind,
        ruleId: rule.id,
        original: m[0],
        origin: "regex",
        precedence: 3,
        safePreview: redactPreview(m[0]),
      });
    }
  }
  return out;
}
