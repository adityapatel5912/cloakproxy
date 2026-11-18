import { describe, expect, it } from "vitest";
import { reconcileVerdicts } from "../../src/engine/classify/verdictReconciler.js";
import { scoreRedTeam } from "../../src/engine/redTeamScore.js";
import { VaultMap } from "../../src/engine/vault/vaultMap.js";

describe("Stage 1B verdict reconciliation", () => {
  const expected = ["calculateDynamicMargin", "opsEmail", "index"];

  it("accepts exact identifiers", () => {
    const result = reconcileVerdicts(expected, [
      { identifier: "opsEmail", symbolClass: "SECRET", confidence: 0.9, rationaleCode: "NAMING_PATTERN" },
    ]);
    expect(result.verdicts.get("opsEmail")?.symbolClass).toBe("SECRET");
    expect(result.missing).toContain("calculateDynamicMargin");
  });

  it("repairs case/underscore drift and Levenshtein ≤ 2 spelling drift", () => {
    const result = reconcileVerdicts(expected, [
      { identifier: "Calculate_Dynamic_Margin", symbolClass: "PROPRIETARY_LOGIC", confidence: 0.8, rationaleCode: "BUSINESS_TERM" },
      { identifier: "calculateDynamicMargn", symbolClass: "PROPRIETARY_LOGIC", confidence: 0.7, rationaleCode: "BUSINESS_TERM" },
    ]);
    // First verdict claims calculateDynamicMargin; second is a duplicate-ish drift
    // for the same token and must NOT be applied a second time.
    expect(result.verdicts.size).toBe(1);
    expect(result.verdicts.has("calculateDynamicMargin")).toBe(true);
  });

  it("discards invented identifiers rather than trusting them", () => {
    const result = reconcileVerdicts(expected, [
      { identifier: "totallyInventedToken", symbolClass: "SECRET", confidence: 1, rationaleCode: "NAMING_PATTERN" },
    ]);
    expect(result.discarded).toContain("totallyInventedToken");
    expect(result.verdicts.size).toBe(0);
  });
});

describe("red-team score (deterministic, local)", () => {
  it("grades a fortress grade when the adversary reconstructs nothing", () => {
    const vault = new VaultMap("");
    vault.mint("sk_live_ABCDEFGHIJKLMNOP", "API_KEY", "SECRET", "p_1", 1, "deterministic", [], "••••");
    const score = scoreRedTeam(
      [
        { attackName: "a", guess: "", confidence: 0.2 },
        { attackName: "b", guess: "some unrelated string", confidence: 0.1 },
      ],
      vault,
      2,
    );
    expect(score.value).toBe(100);
    expect(score.grade).toBe("FORTIFIED");
  });

  it("penalizes a successful reconstruction and redacts the guess", () => {
    const secret = "sk_live_ABCDEFGHIJKLMNOP";
    const vault = new VaultMap("");
    vault.mint(secret, "API_KEY", "SECRET", "p_1", 1, "deterministic", [], "••••");
    const score = scoreRedTeam([{ attackName: "a", guess: secret, confidence: 1 }], vault, 1);
    expect(score.value).toBe(50); // 100 - 40 - 10
    expect(score.grade).toBe("LEAKY");
    expect(score.findings[0].guessSafePreview).not.toContain(secret);
  });
});
