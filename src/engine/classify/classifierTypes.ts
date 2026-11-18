import type {
  ClassifierPromptPayload,
  DetectionKind,
  IdentifierVerdict,
  InputLanguage,
  SpanMatch,
} from "../types.js";

/** Chunking + prompt-payload construction for Stage 1B (ONLY_ON_DEVICE). */

const GENERIC_TOKENS = new Set([
  "index", "items", "item", "value", "key", "result", "data", "temp", "tmp",
  "count", "i", "j", "k", "n", "x", "y", "id", "map", "list", "array", "obj",
  "error", "err", "name", "type", "args", "options", "config", "callback",
]);

/**
 * Deterministically pre-scrub a context clue: truncate, strip any high-entropy
 * or secret-looking content, and never include more than localContextClues chars.
 * Only assignment-LHS words and structural keywords reach the on-device model.
 */
export function makeContextClue(match: SpanMatch, raw: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  const lineStart = raw.lastIndexOf("\n", Math.max(0, match.span.start - 1)) + 1;
  const lineEndRaw = raw.indexOf("\n", match.span.end);
  const lineEnd = lineEndRaw === -1 ? raw.length : lineEndRaw;
  const line = raw.slice(lineStart, lineEnd);
  const before = line.slice(0, Math.max(0, match.span.start - lineStart));
  // Assignment LHS only — e.g. "process.env.", "const ", "Bearer ".
  const structural = before.match(/(?:process\.env\.|Bearer\s+|Authorization\s*[:=]\s*|const\s+|let\s+|var\s+|export\s+)?$/);
  let clue = (structural?.[0] ?? "").trim();
  if (!clue) {
    const keyword = before.match(/\b(?:secret|token|password|api[_-]?key|credential|private|pricing|margin|revenue)\b/i);
    clue = keyword?.[0] ?? "";
  }
  // Defense: if anything secret-like slipped in, drop it entirely.
  if (/[A-Za-z0-9]{20,}/.test(clue) || clue.includes("=")) return "";
  return clue.slice(0, maxChars);
}

/** Uniqueness + risk sort: tokens that look sensitive are classified first. */
function riskScore(s: string): number {
  let score = 0;
  if (/secret|token|password|key|credential|private|pricing|margin|revenue/i.test(s)) score += 100;
  if (/[A-Z]/.test(s) && /[0-9]/.test(s)) score += 10;
  if (s.length >= 20) score += 5;
  score += s.length;
  return score;
}

export interface ClassifierPayloadBundle {
  readonly payloads: ClassifierPromptPayload[];
  readonly identifierUniverse: string[];
  readonly hiddenGenericTokens: string[]; // SAFE-defaulted generic tokens kept intact for cloud context
}

/**
 * Build 1..N bounded classifier payloads from the extraction result.
 * Only deduplicated symbol strings (plus tiny pre-scrubbed context clues) leave
 * the device. High-entropy/regex secrets never enter the identifier list — they
 * are already deterministic SECRET hits.
 */
export function buildClassifierPayloads(
  matches: readonly SpanMatch[],
  raw: string,
  language: InputLanguage,
  maxChunkSize: number,
  maxClues: number,
  classifyGeneric: boolean,
): ClassifierPayloadBundle {
  const hints = new Map<string, DetectionKind>();
  const candidates = new Set<string>();

  for (const m of matches) {
    if (m.origin === "ast" || m.kind === "IDENTIFIER" || m.kind === "TOKEN_WINDOW") {
      candidates.add(m.original); // deterministic regex/entropy hits never enter the LLM payload
    }
  }

  const hiddenGenericTokens: string[] = [];
  const all = [...candidates];
  if (!classifyGeneric) {
    for (const token of [...all]) {
      if (GENERIC_TOKENS.has(token.toLowerCase())) {
        all.splice(all.indexOf(token), 1);
        hiddenGenericTokens.push(token); // stay SAFE, left intact in the sanitized packet
      }
    }
  }
  all.sort((a, b) => riskScore(b) - riskScore(a) || a.localeCompare(b));

  const chunkSize = Math.max(20, Math.min(500, maxChunkSize));
  const payloads: ClassifierPromptPayload[] = [];
  for (let i = 0; i < all.length; i += chunkSize) {
    const identifiers = all.slice(i, i + chunkSize);
    const clueSet = new Set<string>();
    for (const id of identifiers) {
      const m = matches.find((x) => x.original === id);
      if (m) {
        const clue = makeContextClue(m, raw, 24);
        if (clue) clueSet.add(clue);
      }
      if (clueSet.size >= maxClues) break;
    }
    payloads.push({
      languageHint: language,
      identifiers,
      contextClues: [...clueSet].slice(0, maxClues),
      heuristicHints: identifiers
        .filter((id) => hints.has(id))
        .map((id) => ({ identifier: id, kind: hints.get(id)! })),
    });
  }

  return {
    payloads,
    identifierUniverse: all,
    hiddenGenericTokens,
  };
}
