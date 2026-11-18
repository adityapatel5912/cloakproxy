import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../src/engine/policy.js";
import { buildPayloads, extract, planVault, sanitize } from "../../src/engine/pipeline.js";
import { VaultMap } from "../../src/engine/vault/vaultMap.js";
import { PROD_ENV_SAMPLE, PRICING_ALGORITHM_SAMPLE, STRIPE_LEAK_SAMPLE } from "../../src/engine/samples.js";
import type { IdentifierVerdict } from "../../src/engine/types.js";

const policy = DEFAULT_POLICY.STRICT_SOC2;

describe("Stage 1C vault bijectivity", () => {
  for (const sample of [STRIPE_LEAK_SAMPLE, PRICING_ALGORITHM_SAMPLE, PROD_ENV_SAMPLE]) {
    it(`maintains forward/reverse bijection for ${sample.id}`, () => {
      const raw = sample.text;
      const extraction = extract(raw, policy);
      const bundle = buildPayloads(extraction, raw, policy);
      // Synthetic Nano verdicts: flag every identifier as proprietary for a
      // worst-case maximum-swap stress test.
      const verdicts: IdentifierVerdict[] = bundle.identifierUniverse.map((id) => ({
        identifier: id,
        symbolClass: "PROPRIETARY_LOGIC",
        confidence: 0.9,
        rationaleCode: "BUSINESS_TERM",
      }));
      const plan = planVault(extraction, bundle, verdicts).plan;
      const result = sanitize(raw, plan);
      const vault = result.vault;

      expect(vault.forward().size).toBe(vault.reverse().size);
      expect(vault.size).toBeGreaterThan(0);
      for (const [original, key] of vault.forward()) {
        const entry = vault.reverse().get(key);
        expect(entry).toBeDefined();
        expect(entry!.originalToken).toBe(original);
        expect(entry!.classification).not.toBe("SAFE");
      }
      for (const key of vault.keys()) {
        expect(key).toMatch(/^(fn|str|ident)_\d+$/);
      }
    });
  }

  it("mints 10,000 tokens without collisions or counter aliasing", () => {
    const vault = new VaultMap("const fn_1 = 1;");
    const minted = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const entry = vault.mint(`secret_${i}`, "API_KEY", "SECRET", `p_${i}`, 1, "deterministic", [], "••••");
      expect(minted.has(entry.vaultKey)).toBe(false);
      minted.add(entry.vaultKey);
    }
    expect(minted.size).toBe(10_000);
    // A source token named fn_1 must not be rehydrated by our minted keys.
    expect([...minted].some((k) => k === "fn_1")).toBe(false);
  });
});
