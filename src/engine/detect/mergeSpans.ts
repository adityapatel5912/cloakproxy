import type { SourceSpan, SpanMatch } from "../types.js";

/**
 * Stage 1A — overlap resolution.
 * Precedence: structural env/json value (4) > regex (3) > ast (2) > entropy (1)
 * > tokenWindow (0). Structural whole-value spans sit at the top so a nested
 * email/URL/entropy hit can never fragment an .env value (partial-secret leak).
 * When spans overlap, the higher-precedence detection wins; equal precedence
 * prefers the longer span. Output is sorted by start offset ascending.
 */

function overlaps(a: SourceSpan, b: SourceSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

export function mergeSpans(matches: readonly SpanMatch[]): SpanMatch[] {
  const sorted = [...matches].sort((a, b) => {
    if (b.precedence !== a.precedence) return b.precedence - a.precedence;
    if (a.span.start !== b.span.start) return a.span.start - b.span.start;
    return b.span.end - b.span.end;
  });

  const kept: SpanMatch[] = [];
  for (const m of sorted) {
    if (kept.some((k) => overlaps(k.span, m.span))) continue;
    kept.push(m);
  }
  kept.sort((a, b) => a.span.start - b.span.start);
  return kept;
}

/** Re-tag spans with the detected language (detectors run language-agnostic). */
export function tagLanguage(matches: readonly SpanMatch[], language: SpanMatch["span"]["language"]): SpanMatch[] {
  return matches.map((m) => ({
    ...m,
    span: { ...m.span, language },
  }));
}
