import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../src/engine/policy.js";
import { assertNoLeaks } from "../../src/engine/vault/preflightAssert.js";
import { VaultMap } from "../../src/engine/vault/vaultMap.js";
import { buildPayloads, extract, planVault, sanitize } from "../../src/engine/pipeline.js";
import { STRIPE_LEAK_SAMPLE } from "../../src/engine/samples.js";

const policy = DEFAULT_POLICY.STRICT_SOC2;

describe("pre-flight zero-leak assertion", () => {
  it("passes on the correctly sanitized packet", () => {
    const raw = STRIPE_LEAK_SAMPLE.text;
    const extraction = extract(raw, policy);
    const bundle = buildPayloads(extraction, raw, policy);
    const plan = planVault(extraction, bundle, null).plan;
    const { sanitized, vault } = sanitize(raw, plan);
    const result = assertNoLeaks(sanitized, vault, policy);
    expect(result.pass).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.bytesScanned).toBe(sanitized.length);
  });

  it("blocks when a vault original is re-injected into the packet", () => {
    const raw = STRIPE_LEAK_SAMPLE.text;
    const extraction = extract(raw, policy);
    const plan = planVault(extraction, buildPayloads(extraction, raw, policy), null).plan;
    const { sanitized, vault } = sanitize(raw, plan);
    const original = vault.secretOriginals().find((s) => s.startsWith("sk_live_"))!;
    const result = assertNoLeaks(`${sanitized}\n// leaked: ${original}`, vault, policy);
    expect(result.pass).toBe(false);
    expect(result.findings.some((f) => f.kind === "vault_original")).toBe(true);
    expect(result.findings.every((f) => !f.safePreview.includes("sk_live_51H8"))).toBe(true);
  });

  it("blocks when deterministic detectors find a fresh secret in the packet", () => {
    const result = assertNoLeaks(
      "const x = 'AKIAIOSFODNN7EXAMPLE';",
      new VaultMap(""),
      policy,
    );
    expect(result.pass).toBe(false);
    expect(result.findings.some((f) => f.kind === "detector_hit")).toBe(true);
  });
});
