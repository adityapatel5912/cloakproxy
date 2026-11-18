import type {
  CompliancePolicyConfig,
  ExtractionResult,
  IdentifierVerdict,
  SourceSpan,
  SpanMatch,
  VaultPlanEntry,
} from "./types.js";
import type { ClassifierPayloadBundle } from "./classify/classifierTypes.js";
import { detectLanguage, tryParse } from "./ast/astGuard.js";
import { extractAstMatches } from "./ast/astExtractor.js";
import { buildClassifierPayloads } from "./classify/classifierTypes.js";
import { reconcileVerdicts } from "./classify/verdictReconciler.js";
import { scanEntropy } from "./detect/entropyScanner.js";
import { mergeSpans, tagLanguage } from "./detect/mergeSpans.js";
import { resetMatchIds, scanRegex } from "./detect/regexScanner.js";
import { scanEnvAssignments, scanJsonSecrets, scanTokenWindows } from "./detect/tokenWindow.js";
import { scanEntropy as entropyScan } from "./detect/entropyScanner.js";
import { assertNoLeaks } from "./vault/preflightAssert.js";
import { rehydrate } from "./vault/rehydrate.js";
import { swapRightToLeft } from "./vault/swapRightToLeft.js";
import { redactPreview } from "./util.js";

/**
 * Deterministic pipeline orchestrator (STAGES 1A → 1C).
 * This module NEVER imports firebase or chrome. The on-device classifier call
 * lives in services/ai; the side panel passes its verdicts back into planVault().
 */
export function extract(raw: string, policy: CompliancePolicyConfig): ExtractionResult {
  resetMatchIds();
  const language = detectLanguage(raw);
  const detected: SpanMatch[] = [];

  detected.push(...scanRegex(raw, policy));
  detected.push(...scanEntropy(raw, policy));

  if (policy.astEnabled && (language === "js" || language === "ts")) {
    const parsed = tryParse(raw);
    if (parsed.ok) {
      detected.push(...extractAstMatches(raw, parsed.ast));
      return {
        language,
        extractionMode: "ast",
        matches: tagLanguage(mergeSpans(detected), language),
      };
    }
    detected.push(...scanTokenWindows(raw));
    return {
      language,
      extractionMode: "fallback",
      matches: tagLanguage(mergeSpans(detected), language),
      parseNote: parsed.reason,
    };
  }

  if (language === "json") detected.push(...scanJsonSecrets(raw));
  detected.push(...scanEnvAssignments(raw, policy));
  detected.push(...scanTokenWindows(raw));

  return {
    language,
    extractionMode: "fallback",
    matches: tagLanguage(mergeSpans(detected), language),
    parseNote:
      language === "env"
        ? ".env input — token-window extractor (acorn not applicable)"
        : language === "python"
          ? "Python input — token-window extractor (acorn not applicable)"
          : language === "json"
            ? "JSON input — token-window + JSON-secret extractor"
            : "non-JS/TS input — token-window extractor",
  };
}

export function buildPayloads(
  extraction: ExtractionResult,
  raw: string,
  policy: CompliancePolicyConfig,
): ClassifierPayloadBundle {
  return buildClassifierPayloads(
    extraction.matches,
    raw,
    extraction.language,
    policy.identifierChunkSize,
    policy.localContextClues,
    policy.classifyGenericIdentifiers,
  );
}

interface Group {
  matches: SpanMatch[];
  top: SpanMatch;
}

function isDeterministicSecret(m: SpanMatch): boolean {
  return (
    m.origin === "regex" ||
    m.origin === "entropy" ||
    m.ruleId === "tokenWindow.envValue" ||
    m.ruleId === "tokenWindow.jsonSecret"
  );
}

/**
 * Merge deterministic ground truth + reconciled on-device verdicts into the
 * final vault plan. Deterministic hits can only ADD flags; LLM verdicts can
 * never downgrade them. Unmatched/missing verdicts default to SAFE (tokens are
 * left intact, preserving cloud-side semantic context).
 */
export function planVault(
  extraction: ExtractionResult,
  bundle: ClassifierPayloadBundle,
  verdicts: readonly IdentifierVerdict[] | null,
): { plan: VaultPlanEntry[]; unresolvedVerdicts: string[]; missingVerdicts: string[] } {
  const reconciled = reconcileVerdicts(
    bundle.identifierUniverse,
    verdicts ?? [],
  );
  const groups = new Map<string, Group>();
  for (const m of extraction.matches) {
    const group = groups.get(m.original);
    if (!group) {
      groups.set(m.original, { matches: [m], top: m });
    } else {
      group.matches.push(m);
      if (m.precedence > group.top.precedence) group.top = m;
    }
  }

  const generic = new Set(bundle.hiddenGenericTokens.map((t) => t.toLowerCase()));
  const plan: VaultPlanEntry[] = [];
  let idx = 0;
  for (const [original, group] of groups) {
    idx += 1;
    const forced = group.matches.some(isDeterministicSecret);
    const verdict = reconciled.verdicts.get(original);
    let classification: VaultPlanEntry["classification"] = "SAFE";
    let confidence = 0;
    let classifiedBy: VaultPlanEntry["classifiedBy"] = "default_safe";

    if (forced) {
      classification = "SECRET";
      confidence = 1;
      classifiedBy = "deterministic";
    } else if (verdict && generic.has(original.toLowerCase()) === false) {
      classification = verdict.symbolClass;
      confidence = Math.max(0, Math.min(1, verdict.confidence));
      classifiedBy = "on_device_llm";
    }

    const occurrences: SourceSpan[] = group.matches.map((m) => m.span);
    plan.push({
      id: `p_${String(idx).padStart(3, "0")}`,
      original,
      category: group.top.kind,
      ruleId: group.top.ruleId,
      classification,
      confidence,
      classifiedBy,
      occurrences,
      safePreview: group.top.safePreview ?? redactPreview(original),
      entropy: group.top.entropy,
    });
  }

  return {
    plan,
    unresolvedVerdicts: reconciled.discarded,
    missingVerdicts: reconciled.missing,
  };
}

export function sanitize(raw: string, plan: readonly VaultPlanEntry[]) {
  return swapRightToLeft(raw, plan, []);
}

export { assertNoLeaks, rehydrate };

/** Syntax integrity check for JS/TS fixtures (INV-2). */
export function syntaxIntegrity(
  raw: string,
  sanitized: string,
  extraction: ExtractionResult,
): { applicable: boolean; passed: boolean; detail: string } {
  if (extraction.extractionMode !== "ast") {
    return { applicable: false, passed: true, detail: "non-AST input — parse check not applicable" };
  }
  const before = tryParse(raw);
  const after = tryParse(sanitized);
  if (!before.ok) {
    return { applicable: true, passed: false, detail: `raw parse failed: ${before.reason}` };
  }
  if (!after.ok) {
    return { applicable: true, passed: false, detail: `sanitized parse failed: ${after.reason}` };
  }
  return { applicable: true, passed: true, detail: "raw and sanitized both parse cleanly (acorn)" };
}
