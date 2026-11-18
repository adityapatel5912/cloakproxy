import type { RehydrateResult, Vault } from "../types.js";
import { normalizeToken } from "../util.js";

/**
 * Stage 1C — deterministic re-hydration.
 * Cloud output never contains originals; it contains vault keys. We restore them
 * via the reverse map. A normalized best-effort second pass repairs mild model
 * drift (fn_domain_1 → fn_domain1) — but NEVER guesses a secret value.
 */
const VAULT_KEY_RE = /(\b(?:fn|str|ident)_\d+\b)/g;

export function rehydrate(text: string, vault: Vault): RehydrateResult {
  const normalized = new Map<string, string>();
  for (const [key, entry] of vault.reverse()) {
    const n = normalizeToken(key);
    if (!normalized.has(n)) normalized.set(n, entry.originalToken);
  }

  const unresolved = new Set<string>();
  let replacedCount = 0;
  const out = text.replace(VAULT_KEY_RE, (token) => {
    const direct = vault.rehydrateToken(token);
    if (direct !== undefined) {
      replacedCount += 1;
      return direct;
    }
    const near = normalized.get(normalizeToken(token));
    if (near !== undefined) {
      replacedCount += 1;
      return near;
    }
    unresolved.add(token);
    return token; // emit as-is; caller surfaces a warning chip
  });

  return {
    text: out,
    unresolvedKeys: [...unresolved],
    replacedCount,
  };
}
