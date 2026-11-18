import type { CompliancePolicyConfig, SpanMatch } from "../types.js";
import { redactPreview } from "../util.js";
import { nextMatchId } from "./regexScanner.js";

/**
 * Stage 1A fallback — token-window extraction for non-JS/TS input
 * (Python, JSON, .env, prose) and .env-style assignments in any language.
 * Runs when acorn cannot parse the input (§5.1 of the blueprint):
 *   - ENV_ASSIGNMENT: KEY=value values gated by policy.ruleSets.envAssignments
 *   - JSON secret keys: values whose object key looks secret-ish (deterministic)
 *   - quoted strings ≥ 12 chars (LLM-classified tokens)
 *   - word tokens ≥ 8 chars (LLM-classified symbols)
 */

const ENV_LINE = /^[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]{2,})[ \t]*=[ \t]*("[^"\n]*"|'[^'\n]*'|[^\s#]+)/gm;
const QUOTED_STRING = /"([^"\n]{12,})"|'([^'\n]{12,})'/g;
const WORD_TOKEN = /\b[A-Za-z_][A-Za-z0-9_]{7,}\b/g;
const SECRETISH_KEY = /(secret|key|token|password|passwd|pass|credential|private|api_key|signing)/i;
const IDENTIFIERISH = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function scanEnvAssignments(
  raw: string,
  policy: CompliancePolicyConfig,
): SpanMatch[] {
  if (!policy.ruleSets.envAssignments) return [];
  const out: SpanMatch[] = [];
  const re = new RegExp(ENV_LINE.source, ENV_LINE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1];
    const valueWithQuotes = m[2];
    const valueStart = m.index + m[0].indexOf(valueWithQuotes);
    const value = valueWithQuotes.replace(/^["']|["']$/g, "");
    // Only flag when the name looks secret-ish OR the value is long enough to matter.
    if (!SECRETISH_KEY.test(name) && value.length < 16) continue;
    if (value.length === 0) continue;
    out.push({
      id: nextMatchId(),
      span: { start: valueStart, end: valueStart + valueWithQuotes.length, language: "env" },
      kind: "ENV_ASSIGNMENT",
      ruleId: "tokenWindow.envValue",
      original: valueWithQuotes,
      origin: "tokenWindow",
      precedence: 0,
      safePreview: redactPreview(valueWithQuotes),
    });
  }
  return out;
}

export function scanJsonSecrets(raw: string): SpanMatch[] {
  // Only invoked after a successful JSON.parse by the pipeline orchestrator.
  const out: SpanMatch[] = [];
  let depth0: { key: string; valueStart: number; valueEnd: number }[] = [];
  try {
    // Walk with a cheap regex over "key": "value" pairs at any depth; values
    // whose key looks secret-ish become deterministic ENV_ASSIGNMENT hits.
    const pairRe = /"((?:[^"\\]|\\.)+)"\s*:\s*("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/g;
    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(raw)) !== null) {
      const key = m[1];
      const valueRaw = m[2];
      if (!SECRETISH_KEY.test(key)) continue;
      const valueStart = m.index + m[0].indexOf(valueRaw);
      out.push({
        id: nextMatchId(),
        span: { start: valueStart, end: valueStart + valueRaw.length, language: "json" },
        kind: "ENV_ASSIGNMENT",
        ruleId: "tokenWindow.jsonSecret",
        original: valueRaw,
        origin: "tokenWindow",
        precedence: 0,
        safePreview: redactPreview(valueRaw),
      });
    }
    depth0 = [];
  } catch {
    return out;
  }
  return out;
}

export function scanTokenWindows(raw: string): SpanMatch[] {
  const out: SpanMatch[] = [];

  // Quoted strings (JSON values, Python strings, prose quotes)
  const qs = new RegExp(QUOTED_STRING.source, QUOTED_STRING.flags);
  let m: RegExpExecArray | null;
  while ((m = qs.exec(raw)) !== null) {
    const whole = m[0];
    out.push({
      id: nextMatchId(),
      span: { start: m.index, end: m.index + whole.length, language: "text" },
      kind: "TOKEN_WINDOW",
      ruleId: "tokenWindow.quotedString",
      original: whole,
      origin: "tokenWindow",
      precedence: 0,
      safePreview: redactPreview(whole),
    });
  }

  // Identifier-ish word tokens (Python names, JSON keys, config section names)
  const wt = new RegExp(WORD_TOKEN.source, WORD_TOKEN.flags);
  while ((m = wt.exec(raw)) !== null) {
    const token = m[0];
    if (!IDENTIFIERISH.test(token)) continue;
    out.push({
      id: nextMatchId(),
      span: { start: m.index, end: m.index + token.length, language: "text" },
      kind: "TOKEN_WINDOW",
      ruleId: "tokenWindow.wordToken",
      original: token,
      origin: "tokenWindow",
      precedence: 0,
      safePreview: token, // word tokens are not secrets; preview need not be redacted
    });
  }
  return out;
}
