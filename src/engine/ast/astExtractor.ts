import type { Node } from "acorn";
import type { SpanMatch } from "../types.js";
import { redactPreview } from "../util.js";
import { nextMatchId } from "../detect/regexScanner.js";

/**
 * Stage 1A — acorn AST extraction.
 * Collects byte-exact [start, end] spans for:
 *   - Identifier nodes (kind IDENTIFIER, ruleId ast.identifier)
 *       (non-computed property / object-key positions are skipped to avoid noise)
 *   - String literals ≥ 12 chars (kind IDENTIFIER, ruleId ast.stringLiteral —
 *       they are treated as classifiable symbols, minted with the str_ prefix)
 * All spans keep precedence 2: regex wins over them, they win over entropy.
 */

interface NodeLike {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  [key: string]: unknown;
}

function isNode(v: unknown): v is NodeLike {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as NodeLike).type === "string" &&
    typeof (v as NodeLike).start === "number" &&
    typeof (v as NodeLike).end === "number"
  );
}

function* walk(node: NodeLike, parent: NodeLike | null): Generator<[NodeLike, NodeLike | null]> {
  yield [node, parent];
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
    const value = (node as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) yield* walk(item, node);
      }
    } else if (isNode(value)) {
      yield* walk(value, node);
    }
  }
}

function isPropertyPosition(node: NodeLike, parent: NodeLike | null): boolean {
  if (parent === null) return false;
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) {
    return true; // obj.prop — the property is part of the accessed API surface
  }
  if (parent.type === "Property" && parent.key === node && !parent.computed) {
    return true; // { prop: value } — structural key, not a symbol
  }
  return false;
}

export function extractAstMatches(raw: string, ast: Node): SpanMatch[] {
  const out: SpanMatch[] = [];
  for (const [node, parent] of walk(ast as unknown as NodeLike, null)) {
    if (node.type === "Identifier" && !isPropertyPosition(node, parent)) {
      out.push({
        id: nextMatchId(),
        span: { start: node.start, end: node.end, language: "js" },
        kind: "IDENTIFIER",
        ruleId: "ast.identifier",
        original: raw.slice(node.start, node.end),
        origin: "ast",
        precedence: 2,
        safePreview: raw.slice(node.start, node.end), // identifiers are not secrets per se
      });
    } else if (node.type === "Literal" && typeof (node as { value?: unknown }).value === "string") {
      const value = (node as unknown as { value: string }).value;
      if (value.length >= 12) {
        out.push({
          id: nextMatchId(),
          span: { start: node.start, end: node.end, language: "js" },
          kind: "IDENTIFIER",
          ruleId: "ast.stringLiteral",
          original: raw.slice(node.start, node.end),
          origin: "ast",
          precedence: 2,
          safePreview: redactPreview(value),
        });
      }
    }
  }
  return out;
}
