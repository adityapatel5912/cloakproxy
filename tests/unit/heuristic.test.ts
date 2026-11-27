import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../src/engine/policy.js";
import { buildPayloads, extract, planVault, sanitize } from "../../src/engine/pipeline.js";
import { PRICING_ALGORITHM_SAMPLE } from "../../src/engine/samples.js";

describe("heuristic business-logic vaulting when on-device model is unavailable", () => {
  const policy = DEFAULT_POLICY.CODE_BALANCED;
  const raw = PRICING_ALGORITHM_SAMPLE.text;
  const extraction = extract(raw, policy);
  const bundle = buildPayloads(extraction, raw, policy);
  const { plan } = planVault(extraction, bundle, null);

  it("flags proprietary naming patterns even with no Nano verdicts", () => {
    const flagged = plan.filter((e) => e.classification !== "SAFE");
    expect(flagged.length).toBeGreaterThanOrEqual(4);
    expect(flagged.every((e) => e.classifiedBy === "heuristic")).toBe(true);
    const names = flagged.map((e) => e.original);
    expect(names).toContain("BASE_MARGIN_FLOOR");
    expect(names).toContain("VOLUME_DISCOUNT_TABLE");
    expect(names).toContain("calculateDynamicMargin");
  });

  it("leaves generic identifiers intact", () => {
    const generic = plan.find((e) => e.original === "units");
    expect(generic?.classification).toBe("SAFE");
  });

  it("sanitized packet no longer contains the proprietary names", () => {
    const result = sanitize(raw, plan);
    expect(result.sanitized).not.toContain("BASE_MARGIN_FLOOR");
    expect(result.sanitized).not.toContain("calculateDynamicMargin");
    expect(result.swapCount).toBeGreaterThanOrEqual(8); // multiple occurrences
  });
});
