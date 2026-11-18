import type { IdentifierVerdict } from "../types.js";
import { levenshtein, normalizeToken } from "../util.js";

/**
 * Stage 1B hardening — reconcile possibly-drifting Nano 4 output back to the
 * exact identifier list produced by Stage 1A.
 *
 * Match order: exact → normalized (case/underscore/punctuation-insensitive) →
 * Levenshtein ≤ 2 (only for tokens ≥ 6 chars). Anything unmatched is DISCARDED,
 * never trusted. Ground truth from regex/entropy can never be downgraded by an
 * LLM verdict (enforced in pipeline.planVault, not here).
 */

export interface ReconcileResult {
  readonly verdicts: Map<string, IdentifierVerdict>; // keyed by engine identifier
  readonly discarded: string[]; // LLM identifiers that matched nothing
  readonly missing: string[]; // engine identifiers with no usable verdict
}

function normalizedLookup(identifiers: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const id of identifiers) {
    const n = normalizeToken(id);
    if (n && !m.has(n)) m.set(n, id);
  }
  return m;
}

export function reconcileVerdicts(
  expected: readonly string[],
  reported: readonly IdentifierVerdict[],
): ReconcileResult {
  const exact = new Set(expected);
  const byNormal = normalizedLookup(expected);
  const verdicts = new Map<string, IdentifierVerdict>();
  const discarded: string[] = [];

  for (const verdict of reported) {
    const name = verdict.identifier;
    if (exact.has(name)) {
      verdicts.set(name, verdict);
      continue;
    }
    const norm = normalizeToken(name);
    const found = byNormal.get(norm);
    if (found && !verdicts.has(found)) {
      verdicts.set(found, { ...verdict, identifier: found });
      continue;
    }
    // Levenshtein fallback for genuine spelling drift (never short tokens).
    let best: string | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    if (name.length >= 6) {
      for (const id of expected) {
        if (verdicts.has(id)) continue;
        if (id.length < 6) continue;
        const d = levenshtein(normalizeToken(name), normalizeToken(id));
        if (d <= 2 && d < bestDist) {
          best = id;
          bestDist = d;
        }
      }
    }
    if (best) {
      verdicts.set(best, { ...verdict, identifier: best });
    } else {
      discarded.push(name); // silently ignored; engine falls back to heuristic verdict
    }
  }

  const missing = expected.filter((id) => !verdicts.has(id));
  return { verdicts, discarded, missing };
}
