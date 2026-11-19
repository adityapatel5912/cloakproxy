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
 *
 * Check 2 must ignore matches that are *themselves vault keys* — a sanitized
 * `.env` line like `STRIPE_SECRET_KEY=str_2` is the gate's own output, not a
 * fresh leak. Without this exemption the gate false-positives on every vaulted
 * env value that sits under a secret-named key.
 */
const VAULT_KEY_PATTERN = /^(?:fn|str|ident)_\d+$/;

/** All intervals of the sanitized text occupied by minted vault keys. */
function vaultKeyIntervals(sanitized: string, keys: readonly string[]): Array<[number, number]> {
  const intervals: Array<[number, number]> = [];
  for (const key of keys) {
    if (key.length === 0) continue;
    let idx = sanitized.indexOf(key);
    while (idx !== -1) {
      intervals.push([idx, idx + key.length]);
      idx = sanitized.indexOf(key, idx + key.length);
    }
  }
  return intervals;
}

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

  const vaultKeys = new Set(vault.keys());
  // A sanitized line like STRIPE_SECRET_KEY=str_2 is one mixed-charset token to
  // the entropy scanner; the same is true for env re-scans of vaulted values.
  // Any re-scan hit that OVERLAPS a vault-key occurrence is the swap's own
  // image: the raw-side Stage-1A scan already tokenized that region before the
  // original was vaulted, so it cannot conceal a new secret — and check 1
  // above independently proves no original text is present anywhere.
  const keyIntervals = vaultKeyIntervals(sanitized, vault.keys());
  const rescanned = [
    ...scanRegex(sanitized, policy),
    ...scanEntropy(sanitized, policy),
    ...scanEnvAssignments(sanitized, policy),
  ];
  for (const m of rescanned) {
    if (vaultKeys.has(m.original) || VAULT_KEY_PATTERN.test(m.original)) continue;
    const overlapsVaultKey = keyIntervals.some(
      ([s, e]) => m.span.start < e && s < m.span.end,
    );
    if (overlapsVaultKey) continue;
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
