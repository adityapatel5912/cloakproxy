import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../src/engine/policy.js";
import { assertNoLeaks } from "../../src/engine/vault/preflightAssert.js";
import { VaultMap } from "../../src/engine/vault/vaultMap.js";
import { buildPayloads, extract, planVault, sanitize } from "../../src/engine/pipeline.js";
import { STRIPE_LEAK_SAMPLE, PROD_ENV_SAMPLE } from "../../src/engine/samples.js";

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

  it("passes on the .env sample — vault keys must not trip the re-scan (regression)", () => {
    // Regression: sanitized lines like STRIPE_SECRET_KEY=str_2 were re-flagged
    // by the env detector because the vault key itself sat under a secret-named
    // key, bricking the gate with a false positive.
    const balanced = DEFAULT_POLICY.CODE_BALANCED;
    const raw = PROD_ENV_SAMPLE.text;
    const extraction = extract(raw, balanced);
    const bundle = buildPayloads(extraction, raw, balanced);
    const plan = planVault(extraction, bundle, null).plan;
    const { sanitized, vault } = sanitize(raw, plan);
    const result = assertNoLeaks(sanitized, vault, balanced);
    expect(result.pass).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("vaults whole .env values — no partial-secret residue at span boundaries (regression)", () => {
    // Regression: a nested entropy span used to beat the whole-value ENV span,
    // leaving fragments like '&3yJkLmN0pQrStUvWx' (half a password) in the packet.
    const balanced = DEFAULT_POLICY.CODE_BALANCED;
    const raw = PROD_ENV_SAMPLE.text;
    const extraction = extract(raw, balanced);
    const bundle = buildPayloads(extraction, raw, balanced);
    const plan = planVault(extraction, bundle, null).plan;
    const { sanitized } = sanitize(raw, plan);
    expect(sanitized).not.toContain("Tr0ub4dor");
    expect(sanitized).not.toContain("3yJkLmN0pQrStUvWx");
    expect(sanitized).not.toContain("cache-pass");
    expect(sanitized).not.toContain("api.acme-corp.internal");
    // Structural names and non-secret values stay intact for cloud context.
    expect(sanitized).toContain("REDIS_URL=str_");
    expect(sanitized).toContain("NODE_ENV=production");
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
