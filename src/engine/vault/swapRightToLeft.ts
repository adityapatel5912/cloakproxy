import type { SanitizeResult, SpanMatch, VaultPlanEntry } from "../types.js";
import { VaultMap } from "./vaultMap.js";

/**
 * Stage 1C — right-to-left bijective swap.
 * Replacing spans sorted by DESCENDING start offset means earlier offsets never
 * shift, preserving byte-exactness of every untouched character (INV-2).
 * Overlapping spans are rejected defensively (mergeSpans should have removed them).
 */

export function swapRightToLeft(
  raw: string,
  plan: ReadonlyArray<VaultPlanEntry>,
  matches: readonly SpanMatch[],
): SanitizeResult {
  const vault = new VaultMap(raw);
  const work: Array<{ start: number; end: number; vaultKey: string; original: string; planEntryId: string }> = [];
  const skipped: Array<{ planEntryId: string; reason: string }> = [];

  for (const entry of plan) {
    if (entry.classification === "SAFE") continue; // SAFE tokens are intentionally left intact
    const occurrences = [...entry.occurrences].sort((a, b) => a.start - b.start);
    for (const span of occurrences) {
      const actual = raw.slice(span.start, span.end);
      if (actual !== entry.original) {
        skipped.push({ planEntryId: entry.id, reason: "span/offset mismatch — skipped to protect syntax" });
        continue; // never splice at a wrong offset
      }
      // Mint once per distinct original; reuse the key for all occurrences.
      let key = vault.forward().get(entry.original);
      if (!key) {
        const minted = vault.mint(
          entry.original,
          entry.category,
          entry.classification,
          entry.id,
          entry.confidence,
          entry.classifiedBy,
          entry.occurrences,
          entry.safePreview,
        );
        key = minted.vaultKey;
      }
      work.push({ start: span.start, end: span.end, vaultKey: key, original: entry.original, planEntryId: entry.id });
    }
  }

  work.sort((a, b) => b.start - a.start); // right → left

  // Defense: no two replacement spans may overlap.
  const finalSpans: Array<{ start: number; end: number }> = [];
  const accepted = work.filter((w) => {
    const clash = finalSpans.some((s) => w.start < s.end && s.start < w.end);
    if (clash) {
      skipped.push({ planEntryId: w.planEntryId, reason: "overlapping span — skipped" });
      return false;
    }
    finalSpans.push(w);
    return true;
  });

  let sanitized = raw;
  for (const w of accepted) {
    sanitized = sanitized.slice(0, w.start) + w.vaultKey + sanitized.slice(w.end);
  }

  return {
    sanitized,
    vault,
    plan,
    swapCount: accepted.length,
    skippedSpans: skipped,
  };
}
