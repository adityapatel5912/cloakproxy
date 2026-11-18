import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, validatePolicyJson } from "../../src/engine/policy.js";

describe("Remote Config policy validation", () => {
  it("falls back to CODE_BALANCED on invalid JSON", () => {
    expect(validatePolicyJson("{not json")).toEqual(DEFAULT_POLICY.CODE_BALANCED);
    expect(validatePolicyJson(undefined)).toEqual(DEFAULT_POLICY.CODE_BALANCED);
  });

  it("clamps hostile numeric values from Remote Config", () => {
    const policy = validatePolicyJson(JSON.stringify({
      presetId: "STRICT_SOC2", entropyThreshold: 999, minEntropySpanLength: -4, identifierChunkSize: 1e9,
    }));
    expect(policy.entropyThreshold).toBeLessThanOrEqual(8);
    expect(policy.minEntropySpanLength).toBeGreaterThanOrEqual(8);
    expect(policy.identifierChunkSize).toBeLessThanOrEqual(500);
    expect(policy.presetId).toBe("STRICT_SOC2");
  });

  it("keeps current Gemini 3+ model names", () => {
    for (const preset of Object.values(DEFAULT_POLICY)) {
      expect(preset.cloudModel).toBe("gemini-3.5-flash");
      expect(preset.liteModel).toBe("gemini-3.5-flash-lite");
    }
  });
});
