import { describe, expect, it } from "vitest";
import { swapRightToLeft } from "../../src/engine/vault/swapRightToLeft.js";
import type { VaultPlanEntry } from "../../src/engine/types.js";

function entry(id: string, original: string, starts: number[]): VaultPlanEntry {
  return {
    id,
    original,
    category: "API_KEY",
    ruleId: "regex.stripe.secret_key",
    classification: "SECRET",
    confidence: 1,
    classifiedBy: "deterministic",
    occurrences: starts.map((start) => ({ start, end: start + original.length, language: "js" })),
    safePreview: "••••",
  };
}

describe("right-to-left swap", () => {
  it("preserves every untouched byte when replacing multiple occurrences", () => {
    const raw = 'const a = "sk_live_SECRETVALUE000000"; const b = "sk_live_SECRETVALUE000000";';
    const first = raw.indexOf("sk_live_SECRETVALUE000000");
    const second = raw.lastIndexOf("sk_live_SECRETVALUE000000");
    const plan = [entry("p_1", "sk_live_SECRETVALUE000000", [first, second])];
    const result = swapRightToLeft(raw, plan, []);
    expect(result.swapCount).toBe(2);
    expect(result.sanitized).not.toContain("sk_live_SECRETVALUE000000");
    expect(result.vault.size).toBe(1); // one key reused for both occurrences
    // Every prefix/suffix region is untouched.
    expect(result.sanitized.startsWith('const a = "')).toBe(true);
    expect(result.sanitized.endsWith('";')).toBe(true);
  });

  it("swaps right-to-left so earlier offsets never shift", () => {
    const raw = "AAA_mid_1__BBB_mid_2__CCC";
    const a = raw.indexOf("AAA");
    const b = raw.indexOf("BBB");
    const plan = [
      entry("p_1", "AAA", [a]),
      entry("p_2", "BBB", [b]),
    ];
    const result = swapRightToLeft(raw, plan, []);
    expect(result.sanitized).toBe("str_1_mid_1__str_2_mid_2__CCC");
  });

  it("skips mismatched spans instead of splicing at a wrong offset", () => {
    const raw = "const value = 12345;";
    const plan = [entry("p_1", "DIFFERENT", [10])];
    const result = swapRightToLeft(raw, plan, []);
    expect(result.sanitized).toBe(raw);
    expect(result.skippedSpans).toHaveLength(1);
  });
});
