import type { CompliancePolicyConfig, LeakAssertionResult, LeakFinding, Vault } from "../types.js";
import { redactPreview } from "../util.js";
import { scanEntropy } from "../detect/entropyScanner.js";
import { scanRegex } from "../detect/regexScanner.js";
import { scanEnvAssignments } from "../detect/tokenWindow.js";

/**
 * STAGE 1C — PRE-FLIGHT ZERO-LEAK ASSERTION (hard gate, INV-1).
 * Called immediately after swapRightToLeft and BEFORE any cloud request is
 * constructed. If pass=false the caller MUST transition to ERROR{PRE_FLIGHT_LEAK}.
 * There is intentionally no bypass flag.
 *
 * Two independent checks:
 *  1. No vault original (classification !== SAFE, length ≥ 5) may be a substring
 *     of the sanitized packet.
 *  2. Re-running the full deterministic detector suite on the sanitized packet
 *     must yield zero new sensitive spans (catches a secret that escaped the
 *     vault due to an offset bug or a missed overlap).
 */
export function assertNoLeaks(
  sanitized: string,
  vault: Vault,
  policy: CompliancePolicyConfig,
): LeakAssertionResult {
  const findings: LeakFinding[] = [];

  for (const original of vault.secretOriginals()) {
    if (original.length < 5) continue; // tiny tokens cannot carry meaningful PII
    if (sanitized.includes(original)) {
      findings.push({
        kind: "vault_original",
        detail: "vault original still present in sanitized packet",
        safePreview: redactPreview(original),
      });
    }
  }

  const rescanned = [
    ...scanRegex(sanitized, policy),
    ...scanEntropy(sanitized, policy),
    ...scanEnvAssignments(sanitized, policy),
  ];
  for (const m of rescanned) {
    findings.push({
      kind: "detector_hit",
      detail: `rescan hit: ${m.ruleId}`,
      safePreview: m.safePreview,
    });
  }

  return {
    pass: findings.length === 0,
    findings,
    bytesScanned: sanitized.length,
  };
}
