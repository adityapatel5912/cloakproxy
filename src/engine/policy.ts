import type {
  CompliancePolicyConfig,
  CompliancePresetId,
} from "./types.js";

/**
 * Compliance policy defaults + shape validation.
 * Remote Config serves `compliance_preset` as a JSON string; services/remoteConfig.ts
 * parses it and runs it through validatePolicy() — remote JSON never enters the
 * engine unvalidated. Any validation failure falls back to CODE_BALANCED.
 */

export const PRESET_IDS: readonly CompliancePresetId[] = [
  "STRICT_SOC2",
  "CODE_BALANCED",
  "OSS_PERMISSIVE",
];

export const DEFAULT_POLICY: Record<CompliancePresetId, CompliancePolicyConfig> = {
  STRICT_SOC2: {
    presetId: "STRICT_SOC2",
    entropyThreshold: 4.5,
    minEntropySpanLength: 24,
    ruleSets: {
      apiKeys: true,
      jwts: true,
      emails: true,
      internalUrls: true,
      envAssignments: true,
    },
    astEnabled: true,
    classifyGenericIdentifiers: true,
    identifierChunkSize: 200,
    localContextClues: 8,
    allowCloud: true, // air-gap toggle can force this off at runtime
    cloudModel: "gemini-3.5-flash",
    liteModel: "gemini-3.5-flash-lite",
    redTeamIterations: 6,
    redTeamEnabled: true,
    telemetryVerbosity: "FULL",
  },
  CODE_BALANCED: {
    presetId: "CODE_BALANCED",
    entropyThreshold: 3.8,
    minEntropySpanLength: 20,
    ruleSets: {
      apiKeys: true,
      jwts: true,
      emails: true,
      internalUrls: false,
      envAssignments: true,
    },
    astEnabled: true,
    classifyGenericIdentifiers: false,
    identifierChunkSize: 200,
    localContextClues: 12,
    allowCloud: true,
    cloudModel: "gemini-3.5-flash",
    liteModel: "gemini-3.5-flash-lite",
    redTeamIterations: 4,
    redTeamEnabled: true,
    telemetryVerbosity: "STAGES_ONLY",
  },
  OSS_PERMISSIVE: {
    presetId: "OSS_PERMISSIVE",
    entropyThreshold: 3.2,
    minEntropySpanLength: 16,
    ruleSets: {
      apiKeys: true,
      jwts: true,
      emails: false,
      internalUrls: false,
      envAssignments: true,
    },
    astEnabled: true,
    classifyGenericIdentifiers: false,
    identifierChunkSize: 200,
    localContextClues: 16,
    allowCloud: true,
    cloudModel: "gemini-3.5-flash",
    liteModel: "gemini-3.5-flash-lite",
    redTeamIterations: 2,
    redTeamEnabled: true,
    telemetryVerbosity: "STAGES_ONLY",
  },
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function coercePreset(raw: unknown): CompliancePolicyConfig {
  const fallback = DEFAULT_POLICY.CODE_BALANCED;
  if (typeof raw !== "object" || raw === null) return fallback;
  const r = raw as Record<string, unknown>;
  const presetId = PRESET_IDS.includes(r.presetId as CompliancePresetId)
    ? (r.presetId as CompliancePresetId)
    : fallback.presetId;
  const base = DEFAULT_POLICY[presetId];
  const rs = (typeof r.ruleSets === "object" && r.ruleSets !== null
    ? (r.ruleSets as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  return {
    presetId,
    entropyThreshold: isFiniteNumber(r.entropyThreshold)
      ? Math.min(8, Math.max(2, r.entropyThreshold))
      : base.entropyThreshold,
    minEntropySpanLength: isFiniteNumber(r.minEntropySpanLength)
      ? Math.min(64, Math.max(8, Math.min(64, Math.round(r.minEntropySpanLength))))
      : base.minEntropySpanLength,
    ruleSets: {
      apiKeys: typeof rs.apiKeys === "boolean" ? rs.apiKeys : base.ruleSets.apiKeys,
      jwts: typeof rs.jwts === "boolean" ? rs.jwts : base.ruleSets.jwts,
      emails: typeof rs.emails === "boolean" ? rs.emails : base.ruleSets.emails,
      internalUrls:
        typeof rs.internalUrls === "boolean" ? rs.internalUrls : base.ruleSets.internalUrls,
      envAssignments:
        typeof rs.envAssignments === "boolean"
          ? rs.envAssignments
          : base.ruleSets.envAssignments,
    },
    astEnabled: typeof r.astEnabled === "boolean" ? r.astEnabled : true,
    classifyGenericIdentifiers:
      typeof r.classifyGenericIdentifiers === "boolean"
        ? r.classifyGenericIdentifiers
        : base.classifyGenericIdentifiers,
    identifierChunkSize: isFiniteNumber(r.identifierChunkSize)
      ? Math.min(500, Math.max(20, Math.round(r.identifierChunkSize)))
      : base.identifierChunkSize,
    localContextClues: isFiniteNumber(r.localContextClues)
      ? Math.min(32, Math.max(0, Math.round(r.localContextClues)))
      : base.localContextClues,
    allowCloud: typeof r.allowCloud === "boolean" ? r.allowCloud : true,
    cloudModel: typeof r.cloudModel === "string" && r.cloudModel.length > 0 ? r.cloudModel : base.cloudModel,
    liteModel: typeof r.liteModel === "string" && r.liteModel.length > 0 ? r.liteModel : base.liteModel,
    redTeamIterations: isFiniteNumber(r.redTeamIterations)
      ? Math.min(6, Math.max(0, Math.round(r.redTeamIterations)))
      : base.redTeamIterations,
    redTeamEnabled: typeof r.redTeamEnabled === "boolean" ? r.redTeamEnabled : base.redTeamEnabled,
    telemetryVerbosity:
      r.telemetryVerbosity === "FULL" || r.telemetryVerbosity === "OFF"
        ? r.telemetryVerbosity
        : "STAGES_ONLY",
  };
}

/**
 * Validate an untrusted preset object (e.g. parsed Remote Config JSON).
 * Always returns a usable policy — never throws.
 */
export function validatePolicy(raw: unknown): CompliancePolicyConfig {
  return coercePreset(raw);
}

/** Validate a preset delivered as a JSON string (the Remote Config wire shape). */
export function validatePolicyJson(rawJson: string | undefined | null): CompliancePolicyConfig {
  if (typeof rawJson !== "string" || rawJson.length === 0) {
    return DEFAULT_POLICY.CODE_BALANCED;
  }
  try {
    return coercePreset(JSON.parse(rawJson));
  } catch {
    return DEFAULT_POLICY.CODE_BALANCED;
  }
}
