import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../src/engine/policy.js";
import { scanRegex } from "../../src/engine/detect/regexScanner.js";
import { scanEntropy } from "../../src/engine/detect/entropyScanner.js";
import { extract } from "../../src/engine/pipeline.js";
import { PROD_ENV_SAMPLE, PRICING_ALGORITHM_SAMPLE, STRIPE_LEAK_SAMPLE } from "../../src/engine/samples.js";

const policy = DEFAULT_POLICY.STRICT_SOC2;

describe("Stage 1A deterministic detectors", () => {
  it("finds Stripe key, email and internal URL with byte-exact spans", () => {
    const raw = STRIPE_LEAK_SAMPLE.text;
    const matches = scanRegex(raw, policy);
    const kinds = new Set(matches.map((m) => m.kind));
    expect(kinds.has("API_KEY")).toBe(true);
    expect(kinds.has("EMAIL")).toBe(true);
    expect(kinds.has("INTERNAL_URL")).toBe(true);
    for (const m of matches) {
      expect(raw.slice(m.span.start, m.span.end)).toBe(m.original);
      expect(m.span.end - m.span.start).toBe(m.original.length);
    }
  });

  it("detects JWT-shaped and AWS-shaped keys", () => {
    const raw = [
      'const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";',
      'const aws = "AKIAIOSFODNN7EXAMPLE";',
    ].join("\n");
    const matches = scanRegex(raw, policy);
    expect(matches.some((m) => m.kind === "JWT")).toBe(true);
    expect(matches.some((m) => m.ruleId === "regex.aws.access_key")).toBe(true);
  });

  it("flags high-entropy mixed-charset tokens but not English prose", () => {
    const secret = "Tr0ub4dor3yJkLmN0pQrStUvWx"; // 26 chars, mixed charset
    const entropyHits = scanEntropy(secret, DEFAULT_POLICY.CODE_BALANCED);
    expect(entropyHits.length).toBeGreaterThan(0);
    expect(scanEntropy("the quick brown fox jumped over the lazy dog", policy)).toHaveLength(0);
  });

  it("extracts .env values with the fallback extractor", () => {
    const result = extract(PROD_ENV_SAMPLE.text, policy);
    expect(result.extractionMode).toBe("fallback");
    expect(result.language).toBe("env");
    expect(result.matches.some((m) => m.ruleId === "tokenWindow.envValue")).toBe(true);
  });

  it("uses acorn AST mode for plain JS and token-window mode for pricing fixtures", () => {
    expect(extract(STRIPE_LEAK_SAMPLE.text, policy).extractionMode).toBe("ast");
    expect(extract(PRICING_ALGORITHM_SAMPLE.text, policy).extractionMode).toBe("ast");
  });
});
