import type {
  CompliancePolicyConfig,
  ExtractionResult,
  HybridCallTelemetry,
  InputLanguage,
  LeakAssertionResult,
  RedTeamProbeResponse,
  RedTeamScoreBreakdown,
  RehydrateResult,
  SpanMatch,
  Vault,
  VaultPlanEntry,
} from "../../engine/types.js";

export type Phase =
  | "IDLE"
  | "EXTRACTING_1A"
  | "CLASSIFYING_1B"
  | "SWAPPING_1C"
  | "LEAK_ASSERT"
  | "AWAIT_CLOUD"
  | "REHYDRATING"
  | "COMPLETE"
  | "RED_TEAM_RUNNING"
  | "AIR_GAP_LOCAL_QA"
  | "MODEL_DOWNLOADING"
  | "ERROR";

export interface CallLogItem {
  readonly id: string;
  readonly stage: string;
  readonly mode: string;
  readonly source?: string;
  readonly model?: string;
  readonly latencyMs: number;
  readonly status: string;
}

export interface WorkbenchState {
  readonly phase: Phase;
  readonly raw: string;
  readonly language?: InputLanguage;
  readonly extractionMode?: "ast" | "fallback";
  readonly parseNote?: string;
  readonly matches: readonly SpanMatch[];
  readonly plan: readonly VaultPlanEntry[];
  readonly sanitized?: string;
  readonly vault?: Vault;
  readonly assertion?: LeakAssertionResult;
  readonly swapCount: number;
  readonly cloudOutput?: string;
  readonly rehydrated?: RehydrateResult;
  readonly syntaxNote?: string;
  readonly syntaxPassed?: boolean;
  readonly redTeam: {
    readonly running: boolean;
    readonly score?: RedTeamScoreBreakdown;
    readonly probes: readonly RedTeamProbeResponse[];
  };
  readonly logs: readonly CallLogItem[];
  readonly error?: { readonly code: string; readonly message: string; readonly stage: string };
  readonly airGap: boolean;
  readonly policy: CompliancePolicyConfig;
  readonly sessionTitle?: string;
  readonly qaAnswer?: string;
  readonly unresolvedVerdicts: readonly string[];
  readonly downloadProgress: number;
}

export function initialState(policy: CompliancePolicyConfig): WorkbenchState {
  return {
    phase: "IDLE",
    raw: "",
    matches: [],
    plan: [],
    swapCount: 0,
    redTeam: { running: false, probes: [] },
    logs: [],
    airGap: false,
    policy,
    unresolvedVerdicts: [],
    downloadProgress: 0,
  };
}

export type Action =
  | { type: "SET_RAW"; raw: string }
  | { type: "SET_POLICY"; policy: CompliancePolicyConfig }
  | { type: "TOGGLE_AIRGAP" }
  | { type: "BEGIN_PIPELINE" }
  | { type: "EXTRACTED"; extraction: ExtractionResult }
  | { type: "CLASSIFIED"; unresolved: readonly string[]; log: CallLogItem }
  | { type: "SANITIZED"; plan: readonly VaultPlanEntry[]; sanitized: string; vault: Vault; assertion: LeakAssertionResult; swapCount: number; log?: CallLogItem }
  | { type: "LEAK_BLOCKED"; assertion: LeakAssertionResult }
  | { type: "CLOUD_CHUNK"; text: string }
  | { type: "CLOUD_DONE"; text: string; log: CallLogItem }
  | { type: "REHYDRATED"; result: RehydrateResult; syntaxNote: string; syntaxPassed: boolean }
  | { type: "RED_TEAM_START" }
  | { type: "RED_TEAM_DONE"; probes: readonly RedTeamProbeResponse[]; score: RedTeamScoreBreakdown; log: CallLogItem }
  | { type: "RED_TEAM_FAILED" }
  | { type: "TITLE"; title: string; log: CallLogItem }
  | { type: "LOG"; log: CallLogItem }
  | { type: "QA_ANSWER"; answer: string; log: CallLogItem }
  | { type: "DOWNLOAD_PROGRESS"; fraction: number }
  | { type: "MODEL_DOWNLOAD_DONE" }
  | { type: "ERROR"; code: string; message: string; stage: string }
  | { type: "RESET" };

function pushLog(logs: readonly CallLogItem[], log: CallLogItem): CallLogItem[] {
  return [log, ...logs].slice(0, 30);
}

export function reducer(state: WorkbenchState, action: Action): WorkbenchState {
  switch (action.type) {
    case "SET_RAW":
      return { ...state, raw: action.raw, phase: "IDLE", matches: [], plan: [], sanitized: undefined, cloudOutput: undefined, rehydrated: undefined, error: undefined };
    case "SET_POLICY":
      return { ...state, policy: action.policy };
    case "TOGGLE_AIRGAP":
      return { ...state, airGap: !state.airGap };
    case "BEGIN_PIPELINE":
      return {
        ...state,
        phase: "EXTRACTING_1A",
        error: undefined,
        matches: [],
        plan: [],
        sanitized: undefined,
        cloudOutput: undefined,
        rehydrated: undefined,
        redTeam: { running: false, probes: [] },
        logs: [],
      };
    case "EXTRACTED":
      return {
        ...state,
        phase: "CLASSIFYING_1B",
        matches: action.extraction.matches,
        language: action.extraction.language,
        extractionMode: action.extraction.extractionMode,
        parseNote: action.extraction.parseNote,
      };
    case "CLASSIFIED":
      return {
        ...state,
        phase: "SWAPPING_1C",
        unresolvedVerdicts: action.unresolved,
        logs: pushLog(state.logs, action.log),
      };
    case "SANITIZED":
      return {
        ...state,
        phase: "LEAK_ASSERT",
        plan: action.plan,
        sanitized: action.sanitized,
        vault: action.vault,
        assertion: action.assertion,
        swapCount: action.swapCount,
        logs: action.log ? pushLog(state.logs, action.log) : state.logs,
      };
    case "LEAK_BLOCKED":
      return {
        ...state,
        phase: "ERROR",
        assertion: action.assertion,
        error: {
          code: "PRE_FLIGHT_LEAK",
          message: "Leak assertion failed — no cloud request was constructed.",
          stage: "LEAK_ASSERT",
        },
      };
    case "CLOUD_CHUNK":
      return { ...state, phase: "AWAIT_CLOUD", cloudOutput: action.text };
    case "CLOUD_DONE":
      return { ...state, phase: "REHYDRATING", cloudOutput: action.text, logs: pushLog(state.logs, action.log) };
    case "REHYDRATED":
      return {
        ...state,
        phase: "COMPLETE",
        rehydrated: action.result,
        syntaxNote: action.syntaxNote,
        syntaxPassed: action.syntaxPassed,
      };
    case "RED_TEAM_START":
      return { ...state, phase: "RED_TEAM_RUNNING", redTeam: { running: true, probes: [] } };
    case "RED_TEAM_DONE":
      return {
        ...state,
        phase: "COMPLETE",
        redTeam: { running: false, score: action.score, probes: action.probes },
        logs: pushLog(state.logs, action.log),
      };
    case "RED_TEAM_FAILED":
      // Never leave the probe button stuck in "PROBING..." after a failed run.
      return { ...state, phase: "COMPLETE", redTeam: { running: false, probes: [] } };
    case "TITLE":
      return { ...state, sessionTitle: action.title, logs: pushLog(state.logs, action.log) };
    case "LOG":
      return { ...state, logs: pushLog(state.logs, action.log) };
    case "QA_ANSWER":
      return { ...state, phase: "AIR_GAP_LOCAL_QA", qaAnswer: action.answer, logs: pushLog(state.logs, action.log) };
    case "DOWNLOAD_PROGRESS":
      return { ...state, phase: "MODEL_DOWNLOADING", downloadProgress: action.fraction };
    case "MODEL_DOWNLOAD_DONE":
      return { ...state, phase: "IDLE", downloadProgress: 1 };
    case "ERROR":
      return { ...state, phase: "ERROR", error: { code: action.code, message: action.message, stage: action.stage } };
    case "RESET":
      return { ...state, phase: "IDLE", error: undefined };
    default:
      return state;
  }
}

export function telemetryToLogItem(t: HybridCallTelemetry): CallLogItem {
  return {
    id: t.callId,
    stage: t.stage,
    mode: t.mode,
    source: t.inferenceSource,
    model: t.model,
    latencyMs: t.latencyMs,
    status: t.status,
  };
}
