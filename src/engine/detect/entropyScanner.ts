import type { CompliancePolicyConfig, SpanMatch } from "../types.js";
import { redactPreview, shannonEntropy } from "../util.js";
import { nextMatchId } from "./regexScanner.js";

/**
 * Stage 1A — Shannon entropy scanner.
 * Tokenizes the input into "secret-compatible" runs and flags high-entropy
 * mixed-charset tokens. The mixed-charset requirement (at least one letter AND
 * one digit) keeps English prose and identifier-only words out of the hit list,
 * so the low CODE_BALANCED threshold (3.8) stays false-positive-free.
 */

const SECRET_RUN = /[A-Za-z0-9_+=/\-.]{6,}/g;

export function scanEntropy(
  raw: string,
  policy: CompliancePolicyConfig,
): SpanMatch[] {
  const out: SpanMatch[] = [];
  if (policy.entropyThreshold <= 0) return out;
  const minLen = policy.minEntropySpanLength;
  let m: RegExpExecArray | null;
  const re = new RegExp(SECRET_RUN.source, SECRET_RUN.flags);
  while ((m = re.exec(raw)) !== null) {
    const token = m[0];
    if (token.length < minLen) continue;
    // Mixed-charset requirement: pure alphabetic (prose/words) and pure numeric
    // (ports, quantities) runs are not secret-like.
    if (!/[0-9]/.test(token) || !/[A-Za-z]/.test(token)) continue;
    const h = shannonEntropy(token);
    if (h >= policy.entropyThreshold) {
      out.push({
        id: nextMatchId(),
        span: { start: m.index, end: m.index + token.length, language: "text" },
        kind: "HIGH_ENTROPY_STRING",
        ruleId: "entropy.window",
        original: token,
        entropy: h,
        origin: "entropy",
        precedence: 1,
        safePreview: redactPreview(token),
      });
    }
  }
  return out;
}
