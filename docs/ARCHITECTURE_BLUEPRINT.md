# CloakProxy v2.0 — Architectural Specification & Engineering Blueprint

> **Status:** PLANNING MODE — implementation-ready specification. No application source has been generated.
> **Target:** Chrome Manifest V3 Side Panel extension · TypeScript + Vite + React · Firebase AI Logic Web SDK (`firebase/ai` v13+)
> **Event:** #BuildHybridAI 2026
> **Binding constraints:** `AGENTS.md` (all rules enforced verbatim below)

---

## 0. System Overview

CloakProxy is a **Zero-Trust AI Dev Workbench** that lives entirely inside a Chrome Side Panel. It lets a developer take sensitive code (leaked Stripe keys, proprietary pricing algorithms, production `.env` files) and safely use **cloud Gemini** for refactoring/debugging — without ever sending raw secrets or proprietary logic to the cloud.

The trust model has three pillars:

1. **Deterministic-First Cloaking** — a pure-TypeScript extraction/vault/re-hydration engine guarantees *zero syntax corruption*. An LLM never rewrites raw source. Cloud models only ever see a fully sanitized packet, and re-hydration is a deterministic string-map operation.
2. **Split-Brain Hybrid Inference** — all three `InferenceMode` values from `firebase/ai` v13+ are used meaningfully:
   - `ONLY_ON_DEVICE` (Gemini Nano 4): local semantic classification + air-gap offline review.
   - `ONLY_IN_CLOUD` (`inCloudParams: { model: "gemini-3.5-flash" }`): heavy refactor on sanitized code + adversarial Red-Team Probe.
   - `PREFER_ON_DEVICE` (auto-fallback to `gemini-3.5-flash-lite`): session titling, diff explanations, telemetry summaries.
3. **Glassbox Control Plane** — every byte that leaves the device is rendered in a "Wire X-Ray" HUD; Remote Config drives live compliance presets; Firestore stores zero-knowledge audit telemetry (never raw code or PII).

**Hard invariants (asserted at runtime, tested in CI):**

- `INV-1` — No raw PII/secret bytes cross the `chrome-extension://` boundary to any Google endpoint. Enforced by a pre-flight zero-leak assertion (§3.4, §6).
- `INV-2` — Re-hydration is bijective: `sanitize(rehydrate(sanitize(x))) === sanitize(x)` and the AST/parse validity of the raw input is preserved character-for-character outside swapped spans.
- `INV-3` — All Firebase modules initialize **only** inside `src/sidepanel/`. `background.ts` is a stateless router with zero Firebase imports.
- `INV-4` — Every model call surfaces `inferenceSource` (`ON_DEVICE` | `IN_CLOUD`) + latency `ms` in the HUD and in telemetry.

---

## 1. Repository & Module Tree

```text
CloakProxy/
├── AGENTS.md                        # Binding engineering constraints (existing)
├── package.json                     # NODE_OPTIONS=--max-old-space-size=2048 guardrail (§4.4)
├── tsconfig.json                    # Strict; two project refs (app + node scripts)
├── vite.config.ts                   # Side Panel HTML build (entry: sidepanel/index.html)
├── vite.background.config.ts        # Service worker single-file ES build (entry: background.ts)
├── .env.example                     # VITE_FIREBASE_*, VITE_APPCHECK_DEBUG_TOKEN, VITE_RECAPTCHA_SITE_KEY
├── .env.local                       # GITIGNORED — never commit (AGENTS.md)
├── extension_public_key.txt         # GITIGNORED — base64 DER public key for manifest "key" (existing)
├── key.pem                          # GITIGNORED — never commit (existing)
├── firebase.json                    # Firestore rules + Remote Config template + emulators config
├── remoteconfig.template.json       # compliance_preset + model params template
├── firestore.rules                 # Zero-knowledge audit docs; user-owns-doc rules
├── public/
│   ├── manifest.template.json       # Copied to dist/manifest.json with "key" injected
│   ├── icons/
│   │   ├── icon16.png icon32.png icon48.png icon128.png
│   └── _locales/                    # (optional) en only for hackathon
├── scripts/
│   ├── build.mjs                    # Orchestrates: key injection → 2 vite builds → tsc gate
│   └── inject-manifest-key.mjs      # Reads extension_public_key.txt → manifest "key"
├── src/
│   ├── engine/                      # ⚙️ PURE TypeScript. ZERO firebase/* imports. Tree-shakeable, unit-testable.
│   │   ├── types.ts                 # All §2 interfaces (SpanMatch, VaultEntry, telemetry types…)
│   │   ├── policy.ts                # CompliancePolicyConfig defaults + threshold math (pure)
│   │   ├── detect/
│   │   │   ├── regexScanner.ts      # API keys (sk_live_, AKIA…, ghp_, xoxb-), JWTs, emails, internal URLs, .env assignments
│   │   │   ├── entropyScanner.ts    # Shannon entropy over sliding windows; H(s) ≥ threshold → span
│   │   │   ├── tokenWindow.ts       # Non-JS/TS fallback: line/token-window pseudo-spans for Python, JSON, .env, prose
│   │   │   └── mergeSpans.ts        # Dedupe/overlap resolution (regex wins > entropy > token-window)
│   │   ├── ast/
│   │   │   ├── astExtractor.ts      # acorn parse → Identifier/MemberExpression/StringLiteral spans [start,end]
│   │   │   └── astGuard.ts          # TryParse<T> result envelope, "unsupported syntax" classification
│   │   ├── classify/
│   │   │   ├── classifierTypes.ts   # IdentifierClass, IdentifierVerdict, prompt envelope types
│   │   │   └── verdictReconciler.ts # Fuzzy-matches Nano-4 output back to extractor identifiers (§5.2)
│   │   ├── vault/
│   │   │   ├── vaultMap.ts         # Bidirectional Map<string,string>; MintFn/MintStr/MintIdent; collision-safe
│   │   │   ├── swapRightToLeft.ts   # Sort spans desc by start; splice via slice(); guarantees byte-exact untouched text
│   │   │   ├── rehydrate.ts         # Global bijective reverse map; idempotent, right-to-left safe
│   │   │   └── preflightAssert.ts   # Zero-leak gate: scans sanitized packet for vault originals/regexs/entropy; CANNOT be bypassed
│   │   ├── pipeline.ts              # orchestrates 1A→1B→1C; emits stage events; never touches Firebase
│   │   ├── samples.ts               # 3 built-in payloads: Stripe leak, pricing algorithm, prod .env
│   │   └── index.ts                 # Engine public barrel
│   ├── services/                    # 🔥 ALL Firebase modules live here; imported ONLY by src/sidepanel/**
│   │   ├── firebase.ts              # initializeApp (side panel ctx only)
│   │   ├── appCheck.ts              # self.FIREBASE_APPCHECK_DEBUG_TOKEN ← import.meta.env, THEN initializeAppCheck(ReCaptchaEnterpriseProvider)
│   │   ├── auth.ts                  # signInAnonymously on Side Panel mount; never popup/redirect
│   │   ├── remoteConfig.ts          # fetchAndActivate → compliance_preset → CompliancePolicyConfig
│   │   ├── telemetry.ts             # Firestore zero-knowledge audit logging (HybridCallTelemetry, RedTeamAuditResult)
│   │   └── ai/
│   │       ├── aiSession.ts         # getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true })
│   │       ├── modelFactory.ts      # InferenceMode-bound model handles (§3.1) incl. inferenceSource extraction
│   │       ├── prompts.ts           # All prompt templates (classifier JSON schema prompt, refactor, red-team, titling)
│   │       ├── schemas.ts           # Schema.object(...) builders: IdentifierClassificationSchema, RedTeamScoreSchema, TitleSchema
│   │       └── calls.ts             # classifyIdentifiersOnDevice / refactorInCloud / redTeamProbe / hybridLite helpers
│   ├── extension/                   # 🧩 MV3 chrome.* surface — stateless, Firebase-free
│   │   ├── background.ts            # contextMenus.create onInstall; onClicked → route to side panel; zero AI/Firebase
│   │   ├── sidePanelLifecycle.ts    # setPanelBehavior({openPanelOnActionClick:true}) + pending-payload handoff
│   │   └── bridge.ts                # Message protocol encode/decode (chrome.storage.session handoff for cold starts)
│   ├── sidepanel/                   # 🖥️ PRIMARY EXECUTION HOST — the ONLY place firebase/* is ever initialized
│   │   ├── index.html               # Single Vite HTML entry; CSP-clean (no inline scripts/styles)
│   │   ├── main.tsx                 # React root; bootstrap order: AppCheck → Auth → RemoteConfig → AI → UI
│   │   ├── bootstrap.ts             # #8 bootstrap sequence (§3.6) incl. pre-flight Built-in AI gate
│   │   ├── preflight/
│   │   │   └── languageModelGate.ts # "LanguageModel" in self; availability(); create({monitor}) + progress bar state
│   │   ├── state/
│   │   │   ├── workbenchMachine.ts  # §3 state machine (useReducer store — no external state lib, low-RAM)
│   │   │   └── selectors.ts
│   │   ├── hooks/
│   │   │   ├── useHybridCall.ts     # wraps services/ai/calls with latency/inferenceSource capture
│   │   │   ├── usePendingCapture.ts # chrome.storage.session → workbench on mount (cold-start context menu capture)
│   │   │   └── useTelemetry.ts
│   │   ├── components/             # Glassbox Swiss-grid dark HUD
│   │   │   ├── Workbench.tsx        # 3-column grid: Raw | Sanitized Packet | Re-Hydrated Output
│   │   │   ├── RawInputPane.tsx     # Inline detection highlights (SpanMatch overlay)
│   │   │   ├── SanitizedPacketPane.tsx  # "0 Bytes Raw PII" badge + vault legend + live inferenceSource pills
│   │   │   ├── OutputPane.tsx       # Re-hydrated result + diff view + Red-Team Resistance Score dial
│   │   │   ├── StageRail.tsx        # Pipeline stage progress (1A → 1B → 1C → Cloud → Rehydrate)
│   │   │   ├── ComplianceSwitcher.tsx   # Remote Config preset pills (STRICT_SOC2 / CODE_BALANCED / OSS_PERMISSIVE)
│   │   │   ├── PreflightModelCard.tsx   # Downloadable/unavailable/available states + chrome://flags guidance
│   │   │   ├── AirGapToggle.tsx     # Forces ONLY_ON_DEVICE end-to-end
│   │   │   ├── RedTeamPanel.tsx     # Probe trigger, score 0–100%, vector findings
│   │   │   └── SamplesBar.tsx       # 3 one-click payloads
│   │   ├── styles/                  # Single CSS file, dark Swiss-grid tokens; zero runtime CSS-in-JS (low-RAM)
│   │   └── App.tsx
│   └── shared/                      # Types shared engine↔services↔sidepanel (NO chrome.* or firebase/* code)
│       ├── bridgeMessages.ts        # CloakBridgeMessage union (background ⇄ sidepanel)
│       └── constants.ts
├── tests/
│   ├── unit/                        # Vitest — engine only (pure, in-memory, no Chrome, no Firebase)
│   │   ├── vault.bijectivity.test.ts
│   │   ├── swap.rightToLeft.test.ts
│   │   ├── syntax.integrity.test.ts
│   │   ├── detectors.test.ts        # fixtures: stripe jwt env email entropy
│   │   ├── rehydrate.roundtrip.test.ts
│   │   └── preflight.leakgate.test.ts
│   ├── fixtures/
│   │   ├── stripe-leak.ts          # same content as samples.ts, exported for tests
│   │   ├── pricing-algo.ts
│   │   └── prod-env.ts
│   └── e2e/                         # Playwright (Chromium + --load-extension) — §7
│       ├── sidepanel.spec.ts
│       └── redteam.spec.ts
└── docs/
    └── ARCHITECTURE_BLUEPRINT.md    # This document
```

**Import-boundary lint (enforced in CI, `eslint-plugin-boundaries` or a custom `dependency-cruiser` rule):**

| Module | May import | Must NOT import |
|---|---|---|
| `src/engine/**` | `acorn`, stdlib only | `firebase/*`, `chrome.*`, React |
| `src/extension/**` | `chrome.*`, `src/shared/**` | `firebase/*`, `src/services/**`, React |
| `src/services/**` | `firebase/*`, `src/engine/**(types)`, `src/shared/**` | `chrome.*`, React |
| `src/sidepanel/**` | everything | — (sole Firebase initializer) |

---

## 2. Core TypeScript Interfaces & JSON Schemas

All engine types live in `src/engine/types.ts`; service envelopes in `src/services/ai/schemas.ts`. Exact definitions:

### 2.1 `SpanMatch` — deterministic detection result (Stage 1A)

```ts
export type DetectionKind =
  | "API_KEY"          // sk_live_…, rk_live_…, AKIA…, ghp_…, xoxb-…, AIza…
  | "JWT"              // eyJ…base64url.eyJ….sig
  | "ENV_ASSIGNMENT"   // KEY=value lines in .env-ish text
  | "EMAIL"
  | "INTERNAL_URL"     // internal hostnames, staging/prod endpoints
  | "HIGH_ENTROPY_STRING"
  | "IDENTIFIER"       // acorn AST Identifier / MemberExpression / String literal
  | "TOKEN_WINDOW";    // fallback extraction for non-JS/TS

export interface SourceSpan {
  readonly start: number;          // char offset into raw input, inclusive
  readonly end: number;            // exclusive; end - start === original.length (byte-exact)
  readonly language: "ts" | "js" | "python" | "json" | "env" | "text";
}

export interface SpanMatch {
  readonly id: string;             // "m_001" — stable within one pipeline run
  readonly span: SourceSpan;
  readonly kind: DetectionKind;
  readonly ruleId: string;         // e.g. "regex.stripe.live_key", "entropy.window64", "ast.identifier"
  readonly original: string;       // exact raw source slice (never leaves the device; held in vault only)
  readonly entropy?: number;       // Shannon H over the matched span, bits/char
  readonly origin: "regex" | "entropy" | "ast" | "tokenWindow";
  readonly precedence: number;      // regex=3 > ast=2 > entropy=1 > tokenWindow=0 (used by mergeSpans)
  readonly safePreview: string;    // redacted preview for UI ("sk_live_••••4242") — UI never needs the raw
}
```

### 2.2 `VaultEntry` — bijective swap record (Stage 1C)

```ts
export type SymbolClass = "SECRET" | "PROPRIETARY_LOGIC" | "SAFE";
export type VaultPrefix = "fn_" | "str_" | "ident_";

export interface VaultEntry {
  readonly vaultKey: string;                 // "fn_domain_1", "str_secret_1", "ident_3" — minted, collision-checked
  readonly originalToken: string;            // exact raw text; lives ONLY here (in-memory, device-local)
  readonly category: DetectionKind;          // provenance from Stage 1A
  readonly classification: SymbolClass;      // verdict from Stage 1B (reconciled)
  readonly confidence: number;               // 0..1 from Nano 4; regex/entropy hits are 1.0 (deterministic)
  readonly classifiedBy: "deterministic" | "on_device_llm";
  readonly occurrences: ReadonlyArray<SourceSpan>;  // every span this token occupies
  readonly safePreview: string;              // mirrors SpanMatch.safePreview
}

export interface Vault {
  /** forward: originalToken → vaultKey */
  forward: ReadonlyMap<string, string>;
  /** reverse: vaultKey → originalToken (bijective invariant: forward.size === reverse.size) */
  reverse: ReadonlyMap<string, VaultEntry>;
  mint(original: string, category: DetectionKind, classification: SymbolClass): VaultEntry;
  rehydrateToken(vaultKey: string): string | undefined;
}
```

**Minting rule (deterministic, never LLM-decided):** prefix from category (`fn_` for AST identifiers in call/definition position, `str_` for string literals & all regex/entropy hits, `ident_` for other identifiers), then a monotonic per-prefix counter; the vault asserts `!reverse.has(candidate)` before insert. Keys are ASCII `[a-z_0-9]+` so they can never collide with raw code identifiers that contain mixed case/`.`,`$`,`-`.

### 2.3 `IdentifierClassificationSchema` — Stage 1B structured output (Nano 4)

The wire `responseSchema` sent with `responseMimeType: "application/json"` via `Schema.object(...)` from `firebase/ai`:

```ts
export const IdentifierClassificationSchema = Schema.object({
  properties: {
    classifications: Schema.array({
      items: Schema.object({
        properties: {
          identifier: Schema.string({ description: "The identifier exactly as it appeared in the input list" }),
          symbolClass: Schema.enum({ enum: ["SECRET", "PROPRIETARY_LOGIC", "SAFE"] }),
          confidence: Schema.number({ minimum: 0, maximum: 1 }),
          rationaleCode: Schema.enum({ enum: ["NAMING_PATTERN", "ASSIGNMENT_CONTEXT", "GENERIC", "BUSINESS_TERM"] }),
        }),
        required: ["identifier", "symbolClass", "confidence", "rationaleCode"],
      }),
      minItems: 1,
    }),
  },
  required: ["classifications"],
}) as const;

// Local types derived from the schema:
export interface IdentifierVerdict {
  identifier: string;
  symbolClass: SymbolClass;
  confidence: number;
  rationaleCode: "NAMING_PATTERN" | "ASSIGNMENT_CONTEXT" | "GENERIC" | "BUSINESS_TERM";
}
export interface ClassificationEnvelope {
  classifications: IdentifierVerdict[];
}
```

**Classifier input contract (what Nano 4 actually receives — and nothing more):**

```ts
export interface ClassifierPromptPayload {
  languageHint: "ts" | "js" | "python" | "json" | "env" | "text";
  identifiers: string[];             // deduped, sorted; max 200 per call (chunked otherwise, §5.5)
  contextClues: string[];            // ≤ 24 chars each, pre-scrubbed deterministically:
                                    //   assignment LHS only, or surrounding keyword tokens
                                    //   (e.g. "Bearer", "Authorization", "process.env", "stripe")
                                    //   High-entropy strings NEVER enter contextClues.
  heuristicHints: Array<{ identifier: string; kind: DetectionKind }>; // Stage-1A regex/entropy pre-verdicts
}
```

### 2.4 `HybridCallTelemetry` — per-call control-plane record (Firestore-safe)

```ts
export type PipelineStage =
  | "CLASSIFY_LOCAL" | "REFACTOR_CLOUD" | "RED_TEAM_CLOUD"
  | "SESSION_TITLE" | "DIFF_EXPLAIN" | "AIRGAP_QA";

export type InferenceModeLiteral =
  | "ONLY_ON_DEVICE" | "PREFER_ON_DEVICE" | "ONLY_IN_CLOUD" | "AIR_GAP_PURE_LOCAL";

export interface HybridCallTelemetry {
  readonly callId: string;              // crypto.randomUUID()
  readonly sessionId: string;           // per workbench session (React ref, not persisted)
  readonly uidHash: string;             // SHA-256(uid).slice(0,16) — no raw UIDs in telemetry docs
  readonly stage: PipelineStage;
  readonly mode: InferenceModeLiteral;
  readonly inferenceSource?: "ON_DEVICE" | "IN_CLOUD";   // from result.response.inferenceSource
  readonly model?: string;              // e.g. "gemini-3.5-flash" when in-cloud
  readonly fallbackUsed: boolean;       // PREFER_ON_DEVICE degraded to cloud?
  readonly latencyMs: number;          // performance.now() delta around the awaited call
  readonly promptTokenEstimate: number; // chars/4 heuristic — counts SANITIZED packet only
  readonly completionTokenEstimate: number;
  readonly status: "OK" | "FALLBACK" | "ERROR" | "BLOCKED_BY_LEAK_ASSERT" | "RATE_LIMITED" | "ABORTED_OFFLINE";
  readonly errorCode?: string;          // e.g. "resource-exhausted", "unavailable-domain"
  readonly preset: CompliancePresetId; // policy active during the call
  readonly clientTs: number;             // Date.now() at completion
}
```

### 2.5 `RedTeamAuditResult` — Zero-Knowledge Resistance Score (ONLY_IN_CLOUD)

```ts
export interface RedTeamVectorFinding {
  readonly vector: string;                       // "prompt_injection_extract_vault_key"
                                               // "semantic_reconstruction_pricing_model"
                                               // "correlation_attack_identifier_density"
                                               // "vault_key_pattern_abuse"
  readonly outcome: "BLOCKED" | "PARTIAL" | "COMPROMISED";
  readonly modelGuess?: string;                 // what Cloud Gemini claimed the hidden token was (redacted)
  readonly evidenceHash: string;                 // SHA-256 of the probe exchange — NEVER the transcript itself
}

export interface RedTeamAuditResult {
  readonly auditId: string;
  readonly sessionId: string;
  readonly score: ZeroKnowledgeResistanceScore;  // 0..100 (see scoring below)
  readonly attackVectorsTried: number;           // = policy.redTeamIterations (Remote Config driven)
  readonly leaksDetected: number;                // count of vault originals reconstructible by the adversary
  readonly findings: RedTeamVectorFinding[];
  readonly probeLatencyMs: number;
  readonly cloudModel: string;                   // "gemini-3.5-flash"
  readonly completedAt: number;
}

export interface ZeroKnowledgeResistanceScore {
  readonly value: number;                        // 0..100, integer
  readonly grade: "FORTIFIED" | "RESILIENT" | "LEAKY";  // ≥90 / ≥70 / <70
  readonly formula: string;                      // persisted for auditability:
                                                 // "100 - 40*compromised - 20*partial - 10*(leaks>0)"
}
```

**Scoring (deterministic, computed locally, never LLM-graded):** the cloud model's structured responses to each adversarial probe (`RedTeamProbeSchema` — `guess`, `confidence`, `attackName`) are compared against the vault. A vector is `COMPROMISED` if any `guess` matches a vault original (exact or ≥0.8 normalized similarity — computed **locally**, on the response only); `PARTIAL` if the guess semantically names the category without reconstructing the token. The final number is engine math, not model opinion.

### 2.6 `CompliancePolicyConfig` — Remote Config contract (`compliance_preset`)

```ts
export type CompliancePresetId = "STRICT_SOC2" | "CODE_BALANCED" | "OSS_PERMISSIVE";

export interface CompliancePolicyConfig {
  readonly presetId: CompliancePresetId;

  // Stage 1A thresholds
  readonly entropyThreshold: number;         // bits/char: 4.5 | 3.8 | 3.2
  readonly minEntropySpanLength: number;      // 24 | 20 | 16 chars
  readonly ruleSets: Readonly<{
    apiKeys: boolean; jwts: boolean; emails: boolean;
    internalUrls: boolean; envAssignments: boolean;     // STRICT flags all
  }>;
  readonly astEnabled: boolean;              // true everywhere; false only breaks fallback ordering
  readonly classifyGenericIdentifiers: boolean;       // STRICT: send even index/items to Nano (still default SAFE)

  // Stage 1B
  readonly identifierChunkSize: number;      // 200 — max identifiers per ONLY_ON_DEVICE call
  readonly localContextClues: number;       // 8 | 12 | 16

  // Cloud calls
  readonly allowCloud: boolean;             // STRICT_SOC2 honors the Air-Gap toggle; OSS_PERMISSIVE defaults true
  readonly cloudModel: string;              // "gemini-3.5-flash"
  readonly liteModel: string;               // "gemini-3.5-flash-lite" (PREFER_ON_DEVICE fallback)

  // Red-Team
  readonly redTeamIterations: number;       // 6 | 4 | 2
  readonly redTeamEnabled: boolean;

  // Telemetry
  readonly telemetryVerbosity: "FULL" | "STAGES_ONLY" | "OFF";
}

export const DEFAULT_POLICY: Record<CompliancePresetId, CompliancePolicyConfig> = { /* §4.5 table */ };
```

**Remote Config template key:** `"compliance_preset"` (JSON string) → `JSON.parse` → validated against a zod-lite validator in `src/services/remoteConfig.ts` → falls back to `CODE_BALANCED` defaults on any parse failure (never trust remote JSON into the engine without shape-checking).

---

## 3. End-to-End Execution & Fallback State Machine

### 3.1 Model handle topology (`src/services/ai/modelFactory.ts`)

All handles come from a single `getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true })` session (replay protection — generative models 403 without it):

| Handle | InferenceMode | Params | Purpose |
|---|---|---|---|
| `classifierModel` | `ONLY_ON_DEVICE` | `onDeviceParams` (Nano 4 default) + `responseMimeType/json` + `responseSchema` | Stage 1B symbol classification |
| `refactorModel` | `ONLY_IN_CLOUD` | `inCloudParams: { model: "gemini-3.5-flash" }` (Remote-Config-overridable) | Heavy refactor/debug on sanitized packet; Red-Team Probe |
| `liteModel` | `PREFER_ON_DEVICE` | `onDeviceParams` + `inCloudParams: { model: "gemini-3.5-flash-lite" }` | Titling, diff explain, telemetry summary |

Every wrapper in `calls.ts` returns `{ text, inferenceSource, latencyMs, model }` where `inferenceSource` is read from `result.response.inferenceSource` and surfaced to HUD + telemetry (`INV-4`).

### 3.2 State machine (`workbenchMachine.ts`, `useReducer` — no state library)

```ts
export type WorkbenchState =
  | "IDLE"
  | "PREFLIGHT_GATE"          // Built-in AI diagnostic on mount
  | "CAPTURED"                // payload present (paste / context-menu / sample)
  | "EXTRACTING_1A"
  | "CLASSIFYING_1B"          // ONLY_ON_DEVICE (or heuristic-only in air-gap)
  | "SWAPPING_1C"
  | "LEAK_ASSERT"             // pre-flight gate — hard block on failure
  | "AWAIT_CLOUD"             // ONLY_IN_CLOUD streaming refactor
  | "REHYDRATING"
  | "COMPLETE"
  | "RED_TEAM_RUNNING"        // post-complete branch
  | "AIR_GAP_LOCAL_QA"        // offline chat on sanitized/raw text, fully on-device
  | "MODEL_DOWNLOADING"       // LanguageModel.create({monitor}) in flight
  | "ERROR";                  // terminal-ish; carries {code, recoverable, stage}
```

Transitions (all side effects through `useHybridCall` so latency + `inferenceSource` are captured at every hop):

```text
IDLE ──mount──▶ PREFLIGHT_GATE ──"available"/"downloadable"/"unavailable"──▶ IDLE(gate rendered)
IDLE ──sample/paste/contextMenu──▶ CAPTURED ──▶ EXTRACTING_1A ──ok──▶ CLASSIFYING_1B
EXTRACTING_1A ──acorn fail──▶ EXTRACTING_1A(fallback=tokenWindow) ──▶ CLASSIFYING_1B
CLASSIFYING_1B ──nano unavailable──▶ SWAPPING_1C(with heuristic verdicts only, confidence=1.0 deterministic)
CLASSIFYING_1B ──ok──▶ SWAPPING_1C ──▶ LEAK_ASSERT ──pass──▶ AWAIT_CLOUD
LEAK_ASSERT ──FAIL──▶ ERROR{code:"PRE_FLIGHT_LEAK"}   // INV-1: no network call is ever attempted
AWAIT_CLOUD ──stream done──▶ REHYDRATING ──▶ COMPLETE ──probe──▶ RED_TEAM_RUNNING ──▶ COMPLETE(score)
AWAIT_CLOUD ──429/rate limit──▶ backoff ×2 ──persist──▶ ERROR{RATE_LIMITED, recoverable}
AWAIT_CLOUD ──mid-stream drop──▶ retry ONCE non-streaming ──▶ REHYDRATING | ERROR{ABORTED}
AirGapToggle ON ──▶ CAPTURED+ policy.allowCloud=false: CLASSIFYING_1B ─▶ SWAPPING_1C ─▶ AIR_GAP_LOCAL_QA (no AWAIT_CLOUD ever)
AirGapToggle ON while AWAIT_CLOUD ──▶ AbortController.abort() ─▶ ERROR{ABORTED_OFFLINE} (partial stream discarded, never re-hydrated)
PREFLIGHT_GATE ──"downloadable" + user click──▶ MODEL_DOWNLOADING ──progress/monitor──▶ IDLE(available) | ERROR{DL_FAILED, non-blocking}
```

### 3.3 Flow A — Online Hybrid Refactor (happy path)

1. **Capture.** Payload enters via: right-click `contextMenus` → `chrome.storage.session` handoff (works even when the panel cold-opens); paste/edit in the workbench; or `SamplesBar` (Stripe key leak / pricing algorithm / prod `.env`).
2. **Stage 1A — Deterministic Extractor (engine, ~ms).** `regexScanner` + `entropyScanner` run first (precedence 3/1); `astExtractor` (acorn) runs for ts/js and adds `IDENTIFIER` spans (precedence 2). `mergeSpans` resolves overlaps (regex ⊃ entropy ⊃ ast ⊃ tokenWindow). Output: `SpanMatch[]` with byte-exact `[start,end]`.
3. **Stage 1B — Local Semantic Classifier (ONLY_ON_DEVICE).** Deduped identifier list + pre-scrubbed context clues + heuristic hints go to Nano 4 with `IdentifierClassificationSchema`. Generic tokens (`index`, `items`, `i`) are classified `SAFE` so cloud reasoning keeps full semantic context. Output is reconciled (§5.2) and merged: deterministic regex/entropy hits **always** stay flagged regardless of LLM verdict (defense-in-depth).
4. **Stage 1C — Bijective Vault Swap (engine).** Vault mints keys; `swapRightToLeft` replaces spans sorted by descending `start` so earlier offsets never shift. Untouched bytes are sliced verbatim (`INV-2`).
5. **Pre-flight zero-leak assertion (engine, hard gate).** `preflightAssert` re-runs the full Stage-1A detector suite **plus** a substring scan for every `originalToken` in the vault against the sanitized packet. Any hit → `ERROR{PRE_FLIGHT_LEAK}` and the cloud call is never constructed (INV-1). Pass → HUD badge **"0 Bytes Raw PII"** with byte count of the verified packet.
6. **Cloud refactor (ONLY_IN_CLOUD).** `refactorModel.generateContentStream` on the sanitized packet. HUD renders the raw stream into the Sanitized Packet pane with a live `inferenceSource: IN_CLOUD` pill + latency meter.
7. **Deterministic re-hydration (engine).** Cloud output is re-hydrated via the reverse vault map. The LLM never sees originals; the user always does. A final `astGuard.tryParse` compares raw-vs-output parse validity when input was JS/TS (`INV-2` check, surfaced in HUD as "Syntax Integrity ✓").
8. **COMPLETE.** Telemetry doc written to Firestore (sanitized metrics only).

### 3.4 Flow B — Red-Team Adversarial Audit (post-complete)

1. User clicks **"Red-Team Probe"**. Input: the sanitized packet (already leak-asserted) + vault metadata (keys + categories, never originals).
2. `refactorModel` is prompted as an **adversary** for `policy.redTeamIterations` rounds, each round a distinct attack vector from a fixed local library (prompt injection to extract vault keys, semantic reconstruction of the pricing model, correlation via identifier density, vault-key pattern abuse). Responses use a `RedTeamProbeSchema` (`{attackName, guess, confidence}`).
3. **Local scoring** (engine `redTeamScore.ts`): guesses are compared against the vault on-device. Formula: `100 − 40·compromised − 20·partial − 10·[leaks>0]`, clamped. Rendered as a 0–100% dial with per-vector findings.
4. `RedTeamAuditResult` logged to Firestore (findings + score + hashes; no transcripts, no guesses that matched raw secrets — matched originals are re-redacted before persistence).

### 3.5 Flow C — Air-Gap Offline Mode

- Toggle sets `policy.allowCloud = false` **and** pins the classifier model to `ONLY_ON_DEVICE` end-to-end.
- If Nano is unavailable offline: Stage 1B degrades to **deterministic-only verdicts** (regex + entropy, confidence 1.0) — the pipeline still completes because Stage 1B is an enhancer, never a dependency.
- Q&A runs entirely on-device against the raw or sanitized text (raw is permitted here: nothing leaves the device). HUD badge: **"AIR-GAPPED · 0 network calls"** — enforced by simply never constructing cloud handles; also asserted by the network capture test (§7).
- Offline Remote Config: last-activated `compliance_preset` is cached by the RC SDK and reused; Firestore telemetry writes queue in memory and are flushed on reconnect (bounded queue, max 50, oldest dropped with `status:"DROPPED_OFFLINE"` — never raw data).

### 3.6 Flow D — Pre-Flight Built-in AI Diagnostic Gate (on mount)

1. `languageModelGate.ts` checks `"LanguageModel" in self` → else render **unavailable card** (cloud flows remain fully testable).
2. `await LanguageModel.availability()`:
   - `"available"` → green pill "Gemini Nano 4 Ready" → classifier handle usable.
   - `"downloadable"` → render 1-click **"Download Nano (on-device)"**; click → `LanguageModel.create({ monitor })` with a `monitor.addEventListener("downloadprogress")` progress bar (state `MODEL_DOWNLOADING`). On `monitor` success → `available`; on failure → non-blocking error card, heuristics-only mode.
   - `"unavailable"` → non-blocking setup card listing exact flags: `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and `chrome://flags/#optimization-guide-on-device-model` (+ guidance: relaunch, ~2 GB disk, x64 Chrome 138+). Cloud/fallback flows stay testable per mandate.

### 3.7 Side Panel bootstrap order (never reorder — auth must precede AI, App Check token before AI call)

```text
main.tsx:
  1. self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true   // BEFORE initializeAppCheck
  2. initializeApp(config)                       // firebase/app
  3. initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(VITE_RECAPTCHA_SITE_KEY),
                               isTokenAutoRefreshEnabled: true })               // firebase/app-check
  4. getAuth(app) → await signInAnonymously(auth)                                // firebase/auth — zero-friction
  5. getRemoteConfig(app) → fetchAndActivate() → compliance_preset               // firebase/remote-config
  6. getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true })  // firebase/ai
  7. LanguageModel pre-flight gate (§3.6) → render React HUD
```

`signInWithPopup` / `signInWithRedirect` are **banned** (`auth/unauthorized-domain` on `chrome-extension://`). Anonymous UID keys the Firestore audit docs.

---

## 4. Manifest V3 & Vite Bundling Spec

### 4.1 `public/manifest.template.json` (exact)

```json
{
  "manifest_version": 3,
  "name": "CloakProxy — Zero-Trust AI Dev Workbench",
  "short_name": "CloakProxy",
  "version": "2.0.0",
  "description": "Inspect, sanitize, refactor and audit sensitive code with split-brain hybrid AI. Zero raw PII leaves your device.",
  "minimum_chrome_version": "138",
  "key": "__EXTENSION_PUBLIC_KEY__",
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "action": {
    "default_title": "Open CloakProxy Workbench"
  },
  "permissions": [
    "sidePanel",
    "contextMenus",
    "storage"
  ],
  "host_permissions": [
    "https://firebaseinstallations.googleapis.com/*",
    "https://firebaseappcheck.googleapis.com/*",
    "https://identitytoolkit.googleapis.com/*",
    "https://firebaseremoteconfig.googleapis.com/*",
    "https://firestore.googleapis.com/*",
    "https://firebaselogging-pa.googleapis.com/*",
    "https://generativelanguage.googleapis.com/*",
    "https://*.googleusercontent.com/*"
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' https://*.googleapis.com https://*.google.com https://*.googleusercontent.com https://*.firebaseio.com"
  },
  "commands": {
    "_execute_action": { "suggested_key": { "default": "Ctrl+Shift+K" } }
  }
}
```

Notes:
- **No `content_scripts`** and no web-UI injection — capture is context menu + paste + samples only (mandate 1).
- **`key`** is injected from `extension_public_key.txt` (base64 DER SPKI of `key.pem`) by `scripts/inject-manifest-key.mjs` at build; the extension ID is then permanent across unpacked reloads (verifiable: `chrome://extensions` ID stays constant after "Reload").
- `commands._execute_action` + `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` make the toolbar action open the panel (this does **not** require `"action"` permissions beyond defaults).
- No `externally_connectable`, no `web_accessible_resources` — nothing is exposed to pages.

### 4.2 Service worker (`background.ts`) — contract

```ts
// SOLE responsibilities (stateless, <5 KB output):
chrome.runtime.onInstalled  → chrome.contextMenus.create({
  id: "cloakproxy.inspect", title: "Inspect & Refactor Safely in CloakProxy",
  contexts: ["selection", "editable", "page"] });
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.contextMenus.onClicked → chrome.storage.session.set({ pendingCapture: { text, ts } })
                              → chrome.sidePanel.open({ tabId })   // best-effort; panel may already be open
chrome.runtime.onMessage    → relay-only echo of BridgeReady / PanelOpened
// NO firebase imports. NO fetch. NO AI. NO state beyond a const menu id.
```

If the side panel is already open, `storage.session` + `storage.onChanged` in the panel picks up `pendingCapture` immediately; if it cold-opens, the same key is read on mount (`usePendingCapture`) and cleared after ingestion. This covers the MV3 constraint that the service worker cannot push data into a page that doesn't exist yet.

### 4.3 Vite multi-entry configuration

**Two separate build passes** (never one shared config) so the service worker emits as a **single, chunk-free ES module** — dynamic-import chunks in an SW are a classic MV3 footgun, and the two-entry graph would otherwise share chunks:

`vite.config.ts` (Side Panel):
```ts
export default defineConfig({
  plugins: [react(), keyInjector()],           // keyInjector: reads extension_public_key.txt → dist/manifest.json
  build: {
    outDir: "dist",
    rollupOptions: { input: { sidepanel: "src/sidepanel/index.html" } },
    target: "chrome138",
    sourcemap: false,                          // low-RAM; no source maps in dist
  },
});
```

`vite.background.config.ts`:
```ts
export default defineConfig({
  build: {
    outDir: "dist",
    rollupOptions: { input: { background: "src/extension/background.ts" } },
    output: { format: "es", entryFileNames: "[name].js", inlineDynamicImports: true }, // single file
    target: "chrome138",
    emptyOutDir: false,                         // second pass must not wipe pass 1
  },
});
```

Both passes compile from one `tsconfig` (strict, `types: ["chrome"]`, `lib: ["ES2022","DOM"]`). `scripts/build.mjs` runs: `tsc --noEmit` → vite build (panel) → vite build (background) → inject key → copy `public/`. Static NPM output satisfies MV3 CSP trivially: no inline scripts (React hydrates from `src/main.tsx`), no `eval` (Vite dev-mode `eval` sourcemaps are dev-only; production build never emits them), no remote code — Firebase SDK and acorn are bundled into `dist/` at build time.

### 4.4 `package.json` scripts (Low-RAM guardrail, AGENTS.md)

```json
{
  "scripts": {
    "dev":   "cross-env NODE_OPTIONS=\"--max-old-space-size=2048\" vite build --watch --mode development",
    "build": "cross-env NODE_OPTIONS=\"--max-old-space-size=2048\" node scripts/build.mjs",
    "test":  "cross-env NODE_OPTIONS=\"--max-old-space-size=2048\" vitest run",
    "e2e":   "cross-env NODE_OPTIONS=\"--max-old-space-size=2048\" playwright test",
    "typecheck": "tsc --noEmit"
  }
}
```

(`cross-env` is required for the `NODE_OPTIONS` prefix to work on Windows; the constraint value itself is unchanged.)

### 4.5 Remote Config preset defaults (template `remoteconfig.template.json`)

| Parameter | STRICT_SOC2 | CODE_BALANCED | OSS_PERMISSIVE |
|---|---|---|---|
| `entropyThreshold` | 4.5 | 3.8 | 3.2 |
| `minEntropySpanLength` | 24 | 20 | 16 |
| emails / internalUrls / envAssignments flagged | ✓ | emails+env | env only |
| `classifyGenericIdentifiers` | true | false | false |
| `redTeamIterations` | 6 | 4 | 2 |
| `cloudModel` / `liteModel` | gemini-3.5-flash / gemini-3.5-flash-lite (all presets; RC-overridable) |
| `allowCloud` | toggleable (air-gap honors) | true | true |
| `telemetryVerbosity` | FULL | STAGES_ONLY | STAGES_ONLY |

### 4.6 Firestore security rules sketch (`firestore.rules`)

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /audit/{uid}/{doc=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid
        && validateZeroKnowledge(resource.data);   // custom function: rejects any doc whose
                                                  // values match secret regexes / high entropy
    }
  }
}
```

The server-side `validateZeroKnowledge` guard is defense-in-depth mirroring the client pre-flight assert: even a compromised client cannot persist raw secrets.

**Firebase provisioning (required before first run):** `npx -y firebase-tools@latest init ailogic` must be executed against the target project — the Web config alone does **not** enable the AI Logic service (`PERMISSION_DENIED` otherwise). Register the App Check debug token from the DevTools console under Firebase Console → App Check → Manage debug tokens.

---

## 5. Edge-Case & Failure Mode Matrix

| # | Failure / Edge case | Detection | Handling | User-visible outcome |
|---|---|---|---|---|
| 5.1 | **`acorn` parse failure** (Python, JSON, `.env`, broken JS, prose) | `astGuard.tryParse` returns `{ ok:false, reason:"unsupported-syntax" \| "syntax-error" }` | Pipeline flag `extractionMode = "fallback"`; `tokenWindow` scanner produces pseudo-spans (line-split, `KEY=` LHS, quoted strings, snake_case/CamelCase word tokens). Precedence stays regex > entropy > tokenWindow. For JSON: `JSON.parse` success enables a JSON-path-aware token walk (keys & string values) instead of acorn. | Badge "Fallback extractor (non-JS/TS)" in Stage 1A rail; pipeline continues normally |
| 5.2 | **Nano 4 returns mismatched/misspelled identifiers** (LLM drift: `fn_domain_1` → `fnDomain1`, truncation, invented names) | `verdictReconciler` (pure engine): match by exact → case/underscore-insensitive → Levenshtein ≤ 2 → token-prefix containment; unmatched LLM rows are **discarded, never trusted** | Any identifier the LLM failed to classify inherits its Stage-1A heuristic verdict: regex/entropy hit ⇒ `SECRET` (confidence 1.0, deterministic); plain identifier ⇒ `SAFE` default. Unmatched verdicts logged in telemetry as `status:"FALLBACK"`. | Silent hardening; classification is an *enhancer* and can only add flags over deterministic ground truth, never remove a regex/entropy hit |
| 5.3 | **Pre-flight leak assertion triggers** (vault original still substring-present in sanitized packet — e.g. a secret reappearing inside a longer string the vault didn't span) | `preflightAssert` re-scan of sanitized packet: every `vault.originalToken` substring check + full regex/entropy re-run | **Hard block**: state → `ERROR{PRE_FLIGHT_LEAK}`; the cloud request object is never constructed. Auto-remediation pass: extend the leaked span to the enclosing statement (`acorn` node or full line) and re-swap, then re-assert (max 2 passes). If still leaking → surface a red "Leak Gate" card with the offending `safePreview` | Red "Blocked: leak assertion failed — cloud call withheld"; zero bytes leave the device |
| 5.4 | **Nano 4 unavailable / model still downloading / user never enabled flags** | `LanguageModel.availability() !== "available"` or ONLY_ON_DEVICE call rejects (`unavailable` / timeout 10 s) | Stage 1B degrades to deterministic-only verdicts (§3.5); `classifierModel` calls are skipped until availability flips. PREFER_ON_DEVICE lite calls fall back to cloud automatically by SDK contract — HUD pill switches to `IN_CLOUD` + `fallbackUsed:true` | "Heuristics-only cloaking (Nano unavailable)" badge; refactor flows unaffected |
| 5.5 | **Identifier list > chunk size / context window** | `identifiers.length > policy.identifierChunkSize (200)` | Deterministic chunking, sorted by (entropy desc, alphabetical) so highest-risk tokens classify first; results merge; `promptTokenEstimate` aggregates across chunks | Progress "classifying 2/3 batches"; no truncation ever — chunking is total |
| 5.6 | **Cloud rate limit (HTTP 429 / `resource-exhausted`)** | SDK error code | Exponential backoff retry ×2 (1 s, 4 s + jitter) on the *sanitized packet only* (idempotent — vault still in memory); after retries → `ERROR{RATE_LIMITED, recoverable}`; telemetry `status:"RATE_LIMITED"`; Remote Config `cloud_kill_switch` (optional param) can disable cloud stage fleet-wide | Toast "Cloud quota reached — retry in a moment"; Air-Gap mode offered as alternative |
| 5.7 | **Mid-stream network drop during ONLY_IN_CLOUD refactor** | `generateContentStream` iterator throws / `AbortController` fires (user toggled air-gap mid-flight) | Retry **once** non-streaming (simpler failure surface). Partial stream is **discarded entirely** — never re-hydrate a partial response (bijectivity cannot be verified on half a packet). Persistent failure → `ERROR{ABORTED}`; vault kept in memory so user can retry without re-cloaking | Stream pane shows "connection lost — retrying as single request" |
| 5.8 | **Cloud output corrupted re-hydration** (model rewrites a vault key it mangled, e.g. `fn_domain_1` → `fn_domain1`) | `rehydrate` reports `unresolvedKeys: string[]` — reverse-map misses after a normalizing pass (case/underscore-insensitive best-effort second try) | Output still renders (user value first), with a "Re-hydration warnings: 1 unmapped token" chip listing only `safePreview`s; telemetry records `unresolvedKeyCount`. The raw output is never auto-patched with guessed secrets | Yellow warning chip; no silent secret guessing |
| 5.9 | **Anonymous auth failure (`auth/unauthorized-domain`, network)** | `signInAnonymously` rejects | Retry once; else run in "Local Only" mode: engine + on-device flows work, cloud calls gated off with an auth banner; telemetry queue in memory | Banner "Anonymous auth failed — cloud stages disabled"; workbench stays usable for cloaking + air-gap review |
| 5.10 | **App Check failure / debug token not registered** | 403 "must enforce Firebase App Check" on first AI call | HUD surfaces a dedicated App Check setup card (register debug token in console); AI calls blocked but UI/Engine/pre-flight all remain functional | Setup card with exact console path |
| 5.11 | **Duplicate / overlapping spans (secret inside a URL inside an identifier)** | `mergeSpans` | Highest-precedence match wins at overlapping ranges; identical `original` strings share one `VaultEntry` with multiple `occurrences` — swap handles all occurrences in one right-to-left pass | Single highlight per region; no double-swap corruption |
| 5.12 | **Vault key collisions with real code** (a source file that genuinely contains `str_secret_1`) | `mint()` asserts `!reverse.has(candidate)`; also pre-scans input for `^(fn\|str\|ident)_[a-z0-9]+_\d+$` tokens and bumps the counter past any collision | Deterministic, no LLM involvement | None (invisible) |
| 5.13 | **Remote Config fetch fails / bad JSON** | `fetchAndActivate` rejects or shape validation fails | `DEFAULT_POLICY.CODE_BALANCED` in-memory; banner "Using cached/default compliance preset" | Compliance switcher shows "(default)" |
| 5.14 | **Very large payload (e.g. 1 MB paste)** | Input size check (soft cap 200 KB for cloud stage; hard cap 2 MB in editor) | Stage 1A/1C are O(n) and still run; cloud refactor only sends first N complete top-level statements (acorn node boundaries) + "…truncated" marker; HUD notes truncation; air-gap Q&A unaffected | "Truncated for cloud stage" note |

---

## 6. Verification & Acceptance Checklist

### 6.1 Automated unit tests (Vitest, engine-only — no Chrome, no Firebase, fully deterministic)

| Test | Assertion |
|---|---|
| `detectors.test.ts` | Stripe key, JWT, `AKIA…`, `ghp_…`, email, internal staging URL, `.env` assignment, high-entropy blob fixtures each yield ≥1 `SpanMatch` with correct `kind` and byte-exact `[start,end]` (`raw.slice(start,end) === match.original`) |
| `vault.bijectivity.test.ts` | For all 3 sample fixtures: `forward.size === reverse.size`; every `vaultKey` maps to exactly one original and vice versa; minting 10 000 synthetic tokens yields zero collisions |
| `swap.rightToLeft.test.ts` | Swapping overlapping/multi-occurrence spans produces output where every `vaultKey` appears and no `originalToken` remains; untouched regions byte-identical (`sanitized.slice(0, span.start)` chain comparison) |
| `syntax.integrity.test.ts` | For all JS/TS fixtures: `acorn.parse(raw)` and `acorn.parse(sanitized)` **both succeed** and produce the same token count ± the expected replacement count (structural preservation). 100% of 500 property-based mutations (identifier renames injected into fixture corpus) preserve parseability — **zero syntax corruption proof** |
| `rehydrate.roundtrip.test.ts` | `rehydrate(sanitize(x)) === x` for all fixtures (including Python/JSON/env fallback-mode fixtures); idempotence: `rehydrate(rehydrate(y)) === rehydrate(y)` |
| `preflight.leakgate.test.ts` | Seeded leak (vault original re-injected into packet) **must** trip the assertion; assert function is pure and un-bypassable (engine exports it as the only path to `AWAIT_CLOUD`) |
| `verdictReconciler.test.ts` | Nano drift fixtures (`fnDomain1`, truncated, invented identifiers) are reconciled or safely discarded; heuristic ground truth never downgraded by LLM rows |
| `policy.test.ts` | All three presets parse from the RC template JSON; invalid JSON falls back to `CODE_BALANCED` |

### 6.2 Manual / harness verification (clean profile)

1. **Static extension ID:** `chrome://extensions` (Developer mode, Load unpacked `dist/`) → record ID → "Reload" ×3 → ID unchanged (manifest `key` working).
2. **Clean-profile reproducibility:** fresh Chrome profile + fresh Firebase debug token → load → panel opens via toolbar action; anonymous auth succeeds (no `auth/unauthorized-domain`); first AI call passes App Check (no 403).
3. **Context menu capture:** select secret-bearing text on any page → right-click → "Inspect & Refactor Safely in CloakProxy" → panel opens with payload staged (both cold-open and already-open cases).
4. **Zero raw PII leakage (network-level):** DevTools Network on the side panel page → run all 3 sample payloads → inspect every request body to `*.googleapis.com` → grep for `sk_live_`, fixture emails, fixture secret strings → **0 matches**; HUD shows "0 Bytes Raw PII".
5. **`inferenceSource` accuracy:** with Nano available → Stage 1B pill reads `ON_DEVICE`; cloud refactor pill reads `IN_CLOUD`; toggle air-gap mid-session → lite calls show `IN_CLOUD`→ absent (no calls at all); with Nano unavailable → lite call pill flips to `IN_CLOUD` with `fallbackUsed`.
6. **Red-Team score sanity:** STRICT preset (6 vectors) on the sanitized Stripe payload → score rendered 0–100% with per-vector findings; probe request bodies contain no vault originals.
7. **Remote Config live switch:** change `compliance_preset` in console → re-activate → detector strictness visibly changes (e.g. OSS_PERMISSIVE stops flagging the low-entropy email fixture).
8. **Firestore audit:** inspect telemetry docs → fields only (token estimates, latency, `inferenceSource`, score, hashes, `uidHash`) — no code, no PII; rules reject a hand-written doc containing `sk_live_…`.
9. **Service worker purity:** `dist/background.js` contains no `firebase` string; SW idle-recycles (wait 30 s) → panel keeps streaming (proves zero AI in SW).
10. **Air-gap proof:** toggle air-gap, go offline (DevTools "Offline") → full local review works; Network panel shows **zero** new requests.

### 6.3 Definition of Done (hackathon demo gate)

- [ ] All unit tests green; syntax-integrity corpus at 100%
- [ ] Clean-profile load reproducible on a second machine in < 2 min (README steps only)
- [ ] All 3 sample payloads complete Flow A end-to-end with visible HUD X-Ray at every stage
- [ ] Red-Team Probe produces a rendered score on the pricing-algorithm payload
- [ ] Air-gap toggle demonstrates a full offline Q&A
- [ ] Extension ID stable; `.env.local`, `key.pem`, `extension_public_key.txt` gitignored (verify `git status` clean of all three)

---

## 7. Testing Plan — Automated Suite + Browse MCP Verification

Three layers, each covering the other's blind spots:

### 7.1 Layer 1 — Vitest unit suite (§6.1)

Pure engine tests, run in CI and locally on every commit; ~40 cases, < 5 s total. These prove the cryptographic core (bijectivity, zero syntax corruption, leak gate) without any browser or Firebase dependency, so they're stable in CI regardless of network or App Check state.

### 7.2 Layer 2 — Playwright E2E (automated, headless Chromium)

`tests/e2e/` boots a dedicated Chromium with the built extension:

```ts
const ctx = await chromium.launchPersistentContext("", {
  headless: false,                       // MV3 side panel + Prompt API need headed mode
  args: [
    `--disable-extensions-except=${distPath}`,
    `--load-extension=${distPath}`,
    "--disable-features=OptimizationGuideModelDownloading" // keep CI light: skip Nano download
  ],
});
```

Because `chrome.sidePanel` can't be automated directly, the suite opens the panel **page** directly at `chrome-extension://<fixed-id>/sidepanel.html` in a tab (valid: it's just an extension page) and drives the React workbench as a normal DOM app:

- `sidepanel.spec.ts`: loads each sample via `SamplesBar` → asserts the three HUD panes render, the "0 Bytes Raw PII" badge appears, Stage Rail reaches COMPLETE, and re-hydrated output text equals the expected golden output (snapshot fixtures).
- `redteam.spec.ts`: runs the probe on sample 2 → asserts a `0–100` score element with findings list; intercepts `**generativelanguage.googleapis.com**` request bodies and asserts no fixture secret substrings (network-level INV-1 proof, automated).
- **Mock layer:** Playwright `page.route` stubs Google endpoints with fixture JSON (Auth, RC, AI responses) so E2E is hermetic and CI-friendly; a separate smoke spec runs unmocked against real Firebase only on demand.
- App Check in E2E/CI: `VITE_APPCHECK_DEBUG_TOKEN` is passed as a pre-provisioned CI secret (never committed).

### 7.3 Layer 3 — Browse MCP manual verification (the human-demo rehearsal)

The browse MCP drives the **user's real Chrome** (loaded unpacked extension with the permanent ID, real Firebase project, real Nano 4 if the flags are enabled) — exactly the configuration a judge will see. Because this is the developer's actual browser profile, extensions and flags are already in place; the harness can't launch a fresh browser with `--load-extension`, so Layer 2 covers automation and this layer covers **real-stack** verification:

1. **Open workbench:** navigate to `chrome-extension://<ID>/sidepanel.html` in a browse session tab; snapshot the HUD; assert the Swiss-grid three-pane layout and pre-flight model card state render without console errors (`pageConsole` capture + `browser.console` check for errors).
2. **Sample payload drill:** click each of the 3 samples (`SamplesBar` refs) → per sample: verify inline highlights in Raw pane, the "0 Bytes Raw PII" badge, the `inferenceSource` pills (`ON_DEVICE` for Stage 1B when Nano ready; `IN_CLOUD` for refactor), and latency chips > 0.
3. **Network capture proof:** start network capture (`network.start`) around the cloud refactor; export the HAR; offline-grep all captured request bodies for `sk_live_`, the fixture email, and `.env` values → must be **0 hits**; stop capture.
4. **Red-Team rehearsal:** click "Red-Team Probe" → verify the score dial renders (numeric element 0–100) and findings list count matches the active preset's iterations; screenshot for the demo script.
5. **Air-gap drill:** toggle Air-Gap → run a local Q&A → network capture shows zero new Google requests.
6. **Context-menu drill (manual step):** requires a real right-click on a page's selection — the browse harness performs the selection+right-click via the page's context menu if automatable; otherwise hand off to the developer for the single right-click, then verify `pendingCapture` ingestion and highlighting in the panel.
7. **Screenshot pack:** `screenshotWithLabels` / `screenshotDiff` at each Stage Rail transition for the hackathon demo script; a before/after `screenshotDiff` of the Raw vs Re-Hydrated panes makes the "surgical swap" visually obvious.

### 7.4 Firebase Emulator track (optional CI determinism)

`firebase.json` emulators (`auth`, `firestore`) + `FIREBASE_AUTH_EMULATOR_HOST`/`FIRESTORE_EMULATOR_HOST` in a `.env.test` give deterministic Auth/Firestore for repeated runs; AI calls remain stubbed via Layer 2's route mocks. Remote Config is served from `remoteconfig.template.json` directly in tests (bypassing network).

---

## Appendix A — Binding-constraint compliance map

| AGENTS.md rule | Enforced by |
|---|---|
| `firebase/ai` v13+ imports only; `GoogleAIBackend`, `InferenceMode.*` | §3.1; `@firebase/vertexai` banned via CI grep gate (`grep -r "vertexai" src/` fails build) |
| All Firebase SDKs in Side Panel only | §1 import-boundary lint + background SW purity test (§6.2 #9) |
| Never `signInWithPopup`/`Redirect`; `signInAnonymously` on mount | §3.7 step 4; CI grep gate |
| `FIREBASE_APPCHECK_DEBUG_TOKEN` before `initializeAppCheck` | §3.7 step 1 (strict ordering, comment-locked) |
| `acorn` + regex/entropy only; no babel/WASM tree-sitter | §1 engine tree; dependency allowlist in `scripts/build.mjs` (fails on forbidden deps) |
| LLM never rewrites raw source | §3.3 steps 5–7: cloud sees only post-assertion sanitized packet; re-hydration is pure engine |
| `NODE_OPTIONS="--max-old-space-size=2048"` on dev/build | §4.4 scripts |
| `.env.local`, `key.pem`, `extension_public_key.txt` never committed | `.gitignore` + §6.3 DoD check; debug token always via `import.meta.env` |
