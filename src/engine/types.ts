/**
 * CloakProxy engine types — the single source of truth for the deterministic
 * cloaking pipeline. Pure types + enum-ish unions only; behavior lives elsewhere.
 */

export type InputLanguage = "ts" | "js" | "python" | "json" | "env" | "text";
export type ExtractionMode = "ast" | "fallback";

export type DetectionKind =
  | "API_KEY" // sk_live_…, AKIA…, ghp_…, xoxb-…, AIza…
  | "JWT" // eyJ….eyJ….sig
  | "ENV_ASSIGNMENT" // KEY=value in .env-ish text
  | "EMAIL"
  | "INTERNAL_URL" // staging / internal / corp endpoints
  | "HIGH_ENTROPY_STRING"
  | "IDENTIFIER" // acorn AST identifier or string literal
  | "TOKEN_WINDOW"; // fallback extraction for non-JS/TS

export interface SourceSpan {
  readonly start: number; // char offset into raw input, inclusive
  readonly end: number; // exclusive; raw.slice(start, end) === original (byte-exact contract)
  readonly language: InputLanguage;
}

export type SpanOrigin = "regex" | "entropy" | "ast" | "tokenWindow";

export interface SpanMatch {
  readonly id: string; // stable within one pipeline run, e.g. "m_001"
  readonly span: SourceSpan;
  readonly kind: DetectionKind;
  readonly ruleId: string; // e.g. "regex.stripe.live_key", "entropy.window", "ast.identifier"
  readonly original: string; // exact raw slice — device-local only, never leaves the vault
  readonly entropy?: number;
  readonly origin: SpanOrigin;
  readonly precedence: number; // regex=3 > ast=2 > entropy=1 > tokenWindow=0
  readonly safePreview: string; // redacted preview safe for HUD chrome
}

export type SymbolClass = "SECRET" | "PROPRIETARY_LOGIC" | "SAFE";
export type ClassifiedBy = "deterministic" | "on_device_llm" | "default_safe" | "heuristic";

export interface VaultPlanEntry {
  readonly id: string;
  readonly original: string;
  readonly category: DetectionKind;
  readonly ruleId: string;
  readonly classification: SymbolClass;
  readonly confidence: number; // 0..1 — deterministic hits are always 1.0
  readonly classifiedBy: ClassifiedBy;
  readonly occurrences: ReadonlyArray<SourceSpan>;
  readonly safePreview: string;
  readonly entropy?: number;
}

export type VaultPrefix = "fn_" | "str_" | "ident_";

export interface VaultEntry {
  readonly vaultKey: string; // "fn_1", "str_2", "ident_3" — minted, collision-checked
  readonly planEntryId: string;
  readonly originalToken: string; // exact raw text; device-local, in-memory only
  readonly category: DetectionKind;
  readonly classification: SymbolClass;
  readonly confidence: number;
  readonly classifiedBy: ClassifiedBy;
  readonly occurrences: ReadonlyArray<SourceSpan>;
  readonly safePreview: string;
}

export interface VaultView {
  /** forward: originalToken → vaultKey (only for vaulted — i.e. non-SAFE — entries) */
  readonly forward: ReadonlyMap<string, string>;
  /** reverse: vaultKey → VaultEntry (bijective invariant: forward.size === reverse.size) */
  readonly reverse: ReadonlyMap<string, VaultEntry>;
}

export interface SanitizeResult {
  readonly sanitized: string;
  readonly vault: Vault;
  readonly plan: ReadonlyArray<VaultPlanEntry>;
  readonly swapCount: number; // number of individual spans replaced
  readonly skippedSpans: ReadonlyArray<{ planEntryId: string; reason: string }>;
}

export interface ExtractionResult {
  readonly language: InputLanguage;
  readonly extractionMode: ExtractionMode;
  readonly matches: ReadonlyArray<SpanMatch>;
  readonly parseNote?: string; // e.g. "acorn: unsupported syntax (python)" surfaced in HUD
}

export interface ClassifierPromptPayload {
  readonly languageHint: InputLanguage;
  readonly identifiers: string[]; // deduped, risk-sorted, ≤ policy.identifierChunkSize
  readonly contextClues: string[]; // ≤24 chars each, deterministically pre-scrubbed (never secrets)
  readonly heuristicHints: ReadonlyArray<{ identifier: string; kind: DetectionKind }>;
}

export type RationaleCode =
  | "NAMING_PATTERN"
  | "ASSIGNMENT_CONTEXT"
  | "GENERIC"
  | "BUSINESS_TERM";

export interface IdentifierVerdict {
  readonly identifier: string;
  readonly symbolClass: SymbolClass;
  readonly confidence: number;
  readonly rationaleCode: RationaleCode;
}

export interface LeakFinding {
  readonly kind: "vault_original" | "detector_hit";
  readonly detail: string;
  readonly safePreview: string;
}

export interface LeakAssertionResult {
  readonly pass: boolean;
  readonly findings: ReadonlyArray<LeakFinding>;
  readonly bytesScanned: number;
}

export interface RehydrateResult {
  readonly text: string;
  readonly unresolvedKeys: string[]; // vault keys present in output but missing from vault (normalized pass failed too)
  readonly replacedCount: number;
}

export type RedTeamVector =
  | "prompt_injection_extract_vault_key"
  | "semantic_reconstruction_secret"
  | "business_logic_reconstruction"
  | "correlation_identifier_density"
  | "vault_key_pattern_abuse"
  | "context_endpoint_inference";

export interface RedTeamProbeResponse {
  readonly attackName: RedTeamVector | string;
  readonly guess: string; // the adversary's claimed reconstruction — compared LOCALLY, never persisted raw
  readonly confidence: number;
}

export interface RedTeamVectorFinding {
  readonly vector: string;
  readonly outcome: "BLOCKED" | "PARTIAL" | "COMPROMISED";
  readonly guessSafePreview: string; // redacted — a compromised guess is itself sensitive
  readonly similarity: number;
}

export interface RedTeamScoreBreakdown {
  readonly value: number; // 0..100
  readonly grade: "FORTIFIED" | "RESILIENT" | "LEAKY";
  readonly compromised: number;
  readonly partial: number;
  readonly leaksDetected: number;
  readonly attackVectorsTried: number;
  readonly findings: ReadonlyArray<RedTeamVectorFinding>;
}

/* ------------------------------------------------------------------ */
/* Compliance policy (Remote Config contract — mirrored in services/)  */
/* ------------------------------------------------------------------ */

export type CompliancePresetId = "STRICT_SOC2" | "CODE_BALANCED" | "OSS_PERMISSIVE";

export interface ComplianceRuleSets {
  readonly apiKeys: boolean;
  readonly jwts: boolean;
  readonly emails: boolean;
  readonly internalUrls: boolean;
  readonly envAssignments: boolean;
}

export interface CompliancePolicyConfig {
  readonly presetId: CompliancePresetId;
  readonly entropyThreshold: number; // bits/char
  readonly minEntropySpanLength: number;
  readonly ruleSets: ComplianceRuleSets;
  readonly astEnabled: boolean;
  readonly classifyGenericIdentifiers: boolean;
  readonly identifierChunkSize: number;
  readonly localContextClues: number;
  readonly allowCloud: boolean;
  readonly cloudModel: string; // "gemini-3.5-flash"
  readonly liteModel: string; // "gemini-3.5-flash-lite"
  readonly redTeamIterations: number;
  readonly redTeamEnabled: boolean;
  readonly telemetryVerbosity: "FULL" | "STAGES_ONLY" | "OFF";
}

/* ------------------------------------------------------------------ */
/* Control-plane telemetry envelopes (Firestore-safe, PII-free)       */
/* ------------------------------------------------------------------ */

export type PipelineStage =
  | "CLASSIFY_LOCAL"
  | "REFACTOR_CLOUD"
  | "RED_TEAM_CLOUD"
  | "SESSION_TITLE"
  | "DIFF_EXPLAIN"
  | "AIRGAP_QA";

export type InferenceModeLiteral =
  | "ONLY_ON_DEVICE"
  | "PREFER_ON_DEVICE"
  | "ONLY_IN_CLOUD"
  | "AIR_GAP_PURE_LOCAL";

export interface HybridCallTelemetry {
  readonly callId: string;
  readonly sessionId: string;
  readonly uidHash: string;
  readonly stage: PipelineStage;
  readonly mode: InferenceModeLiteral;
  readonly inferenceSource?: "ON_DEVICE" | "IN_CLOUD";
  readonly model?: string;
  readonly fallbackUsed: boolean;
  readonly latencyMs: number;
  readonly promptTokenEstimate: number;
  readonly completionTokenEstimate: number;
  readonly status:
    | "OK"
    | "FALLBACK"
    | "ERROR"
    | "BLOCKED_BY_LEAK_ASSERT"
    | "RATE_LIMITED"
    | "ABORTED_OFFLINE";
  readonly errorCode?: string;
  readonly preset: CompliancePresetId;
  readonly clientTs: number;
}

export interface ZeroKnowledgeResistanceScore {
  readonly value: number; // 0..100
  readonly grade: "FORTIFIED" | "RESILIENT" | "LEAKY";
  readonly formula: string;
}

export interface RedTeamAuditResult {
  readonly auditId: string;
  readonly sessionId: string;
  readonly score: ZeroKnowledgeResistanceScore;
  readonly attackVectorsTried: number;
  readonly leaksDetected: number;
  readonly findings: ReadonlyArray<RedTeamVectorFinding>;
  readonly probeLatencyMs: number;
  readonly cloudModel: string;
  readonly completedAt: number;
}

export interface Vault {
  forward(): ReadonlyMap<string, string>;
  reverse(): ReadonlyMap<string, VaultEntry>;
  size: number;
  /** Deterministic, collision-safe mint. Never LLM-decided. */
  mint(
    original: string,
    category: DetectionKind,
    classification: SymbolClass,
    planEntryId: string,
    confidence: number,
    classifiedBy: ClassifiedBy,
    occurrences: ReadonlyArray<SourceSpan>,
    safePreview: string,
  ): VaultEntry;
  rehydrateToken(vaultKey: string): string | undefined;
  /** All vaulted originals (classification !== SAFE) — the leak-assertion watchlist. */
  secretOriginals(): string[];
  keys(): string[];
}
