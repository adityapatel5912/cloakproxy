import * as acorn from "acorn";
import type { InputLanguage } from "../types.js";

/**
 * Stage 1A — acorn parse guard.
 * acorn is a JS parser; TypeScript with type annotations falls back to the
 * token-window path by design (lightweight guardrail: no babel, no WASM,
 * no typescript compiler in the bundle).
 */

export interface ParseOk {
  readonly ok: true;
  readonly ast: acorn.Node;
}
export interface ParseFail {
  readonly ok: false;
  readonly reason: string;
}
export type TryParseResult = ParseOk | ParseFail;

export function tryParse(raw: string): TryParseResult {
  try {
    const ast = acorn.parse(raw, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
    }) as acorn.Node;
    return { ok: true, ast };
  } catch (err) {
    const reason = err instanceof SyntaxError ? err.message : String(err);
    return { ok: false, reason: `acorn: ${reason}` };
  }
}

/**
 * Cheap language hint used to order the detection strategy.
 * JSON and .env are detected structurally before acorn is ever attempted.
 */
export function detectLanguage(raw: string): InputLanguage {
  const text = raw.trim();
  if (text.length === 0) return "text";
  const envish = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (envish.length >= 2) {
    const hit = envish.filter((l) => /^(?:export[ \t]+)?[A-Z][A-Z0-9_]{2,}[ \t]*=/.test(l)).length;
    if (hit >= Math.max(2, Math.ceil(envish.length * 0.5))) return "env";
  }
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      JSON.parse(text);
      return "json";
    } catch {
      /* fall through */
    }
  }
  if (/^[ \t]*(?:def |class |from \S+ import |import \S+)/m.test(text)) return "python";
  if (/(?:\binterface\s+\w+|:\s*(?:string|number|boolean)\b|<T\b|\bas\s+\w+\b\s*$)/m.test(text)) {
    return "ts";
  }
  return "js"; // attempt acorn; failure promotes to fallback/token-window
}
