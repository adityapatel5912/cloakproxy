import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../src/engine/policy.js";
import { extractAstMatches } from "../../src/engine/ast/astExtractor.js";
import { tryParse } from "../../src/engine/ast/astGuard.js";
import { buildPayloads, extract, planVault, sanitize, syntaxIntegrity } from "../../src/engine/pipeline.js";
import { PRICING_ALGORITHM_SAMPLE, STRIPE_LEAK_SAMPLE } from "../../src/engine/samples.js";
import { seededRandom } from "../../src/engine/util.js";
import type { IdentifierVerdict } from "../../src/engine/types.js";

const policy = DEFAULT_POLICY.CODE_BALANCED;

/**
 * 500 deterministic property-based mutations: rename 3 random AST identifiers
 * in real JS fixtures, force EVERY identifier to be vaulted (maximum swap
 * pressure), then assert raw and sanitized both parse cleanly with acorn.
 * This is the "zero syntax corruption" proof (INV-2).
 */
describe("zero syntax corruption — property-based", () => {
  const rand = seededRandom(20261118);
  let checked = 0;

  for (const sample of [STRIPE_LEAK_SAMPLE, PRICING_ALGORITHM_SAMPLE]) {
    for (let iteration = 0; iteration < 250; iteration++) {
      const base = sample.text;
      const parsed = tryParse(base);
      if (!parsed.ok) continue;
      const identifiers = extractAstMatches(base, parsed.ast).filter((m) => m.ruleId === "ast.identifier");
      if (identifiers.length < 3) continue;

      // Pick 3 distinct spans and rename right-to-left with safe synthetic names.
      const picked = new Set<number>();
      while (picked.size < 3) picked.add(Math.floor(rand() * identifiers.length));
      const edits = [...picked]
        .map((i) => identifiers[i])
        .map((m, i) => ({
          start: m.span.start,
          end: m.span.end,
          replacement: `renamedSymbol${iteration}_${i}`,
        }))
        .sort((a, b) => b.start - a.start);
      let mutated = base;
      for (const edit of edits) {
        mutated = mutated.slice(0, edit.start) + edit.replacement + mutated.slice(edit.end);
      }

      const extraction = extract(mutated, policy);
      const bundle = buildPayloads(extraction, mutated, policy);
      const verdicts: IdentifierVerdict[] = bundle.identifierUniverse.map((id) => ({
        identifier: id,
        symbolClass: "PROPRIETARY_LOGIC",
        confidence: 0.95,
        rationaleCode: "BUSINESS_TERM",
      }));
      const plan = planVault(extraction, bundle, verdicts).plan;
      const { sanitized } = sanitize(mutated, plan);
      const integrity = syntaxIntegrity(mutated, sanitized, extraction);

      it(`mutation ${sample.id} #${iteration} stays parseable`, () => {
        expect(integrity.passed).toBe(true);
        expect(integrity.detail).toContain("both parse cleanly");
      });
      checked += 1;
    }
  }

  it("executed the full mutation corpus", () => {
    expect(checked).toBeGreaterThanOrEqual(400);
  });
});
