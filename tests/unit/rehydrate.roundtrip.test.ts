import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../src/engine/policy.js";
import { buildPayloads, extract, planVault, rehydrate, sanitize } from "../../src/engine/pipeline.js";
import { PROD_ENV_SAMPLE, PRICING_ALGORITHM_SAMPLE, STRIPE_LEAK_SAMPLE } from "../../src/engine/samples.js";
import type { IdentifierVerdict } from "../../src/engine/types.js";

const policy = DEFAULT_POLICY.STRICT_SOC2;

describe("bijective rehydration round-trip", () => {
  for (const sample of [STRIPE_LEAK_SAMPLE, PRICING_ALGORITHM_SAMPLE, PROD_ENV_SAMPLE]) {
    it(`rehydrate(sanitize(raw)) === raw for ${sample.id}`, () => {
      const raw = sample.text;
      const extraction = extract(raw, policy);
      const bundle = buildPayloads(extraction, raw, policy);
      const verdicts: IdentifierVerdict[] = bundle.identifierUniverse.map((id) => ({
        identifier: id,
        symbolClass: "PROPRIETARY_LOGIC",
        confidence: 0.9,
        rationaleCode: "BUSINESS_TERM",
      }));
      const plan = planVault(extraction, bundle, verdicts).plan;
      const { sanitized, vault } = sanitize(raw, plan);
      const restored = rehydrate(sanitized, vault);
      expect(restored.text).toBe(raw);
      expect(restored.unresolvedKeys).toEqual([]);
      // A distinct token can occur multiple times, so replacement count ≥ vault size.
      expect(restored.replacedCount).toBeGreaterThanOrEqual(vault.size);
      // Idempotence
      expect(rehydrate(restored.text, vault).text).toBe(raw);
    });
  }

  it("reports (never guesses) unmapped vault keys", () => {
    const raw = 'const a = "sk_live_ABCDEFGHIJKLMNOPQRST";';
    const extraction = extract(raw, policy);
    const plan = planVault(extraction, buildPayloads(extraction, raw, policy), null).plan;
    const { vault } = sanitize(raw, plan);
    const result = rehydrate("const a = str_999;", vault);
    expect(result.unresolvedKeys).toContain("str_999");
    expect(result.text).toContain("str_999");
  });
});
