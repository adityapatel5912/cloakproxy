import { useCallback } from "react";
import type { Dispatch } from "react";
import type {
  CompliancePolicyConfig,
  IdentifierVerdict,
  RedTeamAuditResult,
  Vault,
} from "../../engine/types.js";
import {
  assertNoLeaks,
  buildPayloads,
  extract,
  planVault,
  rehydrate,
  sanitize,
  scoreRedTeam,
  syntaxIntegrity,
} from "../../engine/index.js";
import { reconcileVerdicts } from "../../engine/classify/verdictReconciler.js";
import {
  airGapQa,
  classifyIdentifiers,
  redTeamProbe,
  refactorInCloud,
  sessionTitle,
} from "../../services/ai/calls.js";
import { downloadLanguageModel, probeLanguageModel } from "../preflight/languageModelGate.js";
import type { GateState } from "../preflight/languageModelGate.js";
import type { BootResult } from "../bootstrap.js";
import type { Action, WorkbenchState } from "../state/workbenchMachine.js";
import { localLog, logHybridCall } from "./useTelemetry.js";

export interface WorkbenchActions {
  runPipeline: (raw: string, policy: CompliancePolicyConfig, airGap: boolean) => Promise<void>;
  runRedTeam: () => Promise<void>;
  runQa: (question: string) => Promise<void>;
  runDownload: () => Promise<void>;
}

/** Maps raw SDK/HTTP failures to actionable HUD copy. */
function friendlyCloudError(raw?: string): string {
  const text = raw ?? "";
  if (/USER_PROJECT_DENIED|does not have permission|billing|BILLING/i.test(text)) {
    return "AI Logic requires the Blaze plan. Link a billing account in Firebase Console → Usage and billing, then retry. The vault stays local.";
  }
  if (/requires the Firebase AI API|firebasevertexai\.googleapis\.com/i.test(text)) {
    return "Firebase AI Logic is not usable yet: enable the Firebase AI Logic API and link Blaze billing, then retry. The vault stays local.";
  }
  if (/ON_DEVICE_STUB|echoes prompts/i.test(text)) {
    return "This browser stubs the on-device model (Chromium). Use Google Chrome with the Prompt API flags to run Gemini Nano.";
  }
  if (/must enforce App Check|app.?check/i.test(text)) {
    return "App Check rejected the request. Register this debug token under App Check → Manage debug tokens, then retry.";
  }
  if (/API has not been used|is disabled|SERVICE_DISABLED/i.test(text)) {
    return "Firebase AI Logic API is not enabled for this project. Run `firebase init ailogic`, then retry.";
  }
  if (/RESOURCE_EXHAUSTED|\b429\b|quota/i.test(text)) {
    return "Cloud quota reached. Retry shortly, or switch to Air-Gap mode.";
  }
  if (/UNAVAILABLE|network|fetch/i.test(text)) {
    return "Cloud unreachable. The vault stays local — retry or use Air-Gap mode.";
  }
  return "Cloud refactor failed; the vault remains local. Retry or use Air-Gap mode.";
}

/**
 * Orchestrates the full 3-stage pipeline, hybrid calls, telemetry and state
 * transitions. The engine itself never touches Firebase; it is called here.
 */
export function useHybridCall(
  boot: BootResult,
  gate: GateState,
  state: WorkbenchState,
  dispatch: Dispatch<Action>,
): WorkbenchActions {
  const runPipeline = useCallback(
    async (raw: string, policy: CompliancePolicyConfig, airGap: boolean) => {
      if (raw.trim().length === 0) {
        dispatch({ type: "ERROR", code: "EMPTY_INPUT", message: "Paste, sample or select some code first.", stage: "IDLE" });
        return;
      }
      const t0 = performance.now();
      dispatch({ type: "BEGIN_PIPELINE" });

      // Stage 1A — deterministic extraction
      const extraction = extract(raw, policy);
      dispatch({ type: "EXTRACTED", extraction });

      // Stage 1B — ONLY_ON_DEVICE semantic classification (enhancer only)
      const bundle = buildPayloads(extraction, raw, policy);
      let verdicts: IdentifierVerdict[] | null = null;
      let discarded: string[] = [];
      const canClassify =
        boot.aiReady &&
        !boot.localOnly &&
        gate.availability === "available" &&
        bundle.payloads.length > 0 &&
        bundle.identifierUniverse.length > 0;

      if (canClassify) {
        const outcome = await classifyIdentifiers(bundle.payloads);
        const log = logHybridCall(
          boot, policy, "CLASSIFY_LOCAL", "ONLY_ON_DEVICE", outcome.meta,
          bundle.payloads.reduce((n, p) => n + p.identifiers.join(",").length, 0),
          JSON.stringify(outcome.data).length,
        );
        discarded = reconcileVerdicts(bundle.identifierUniverse, outcome.data).discarded;
        if (outcome.meta.status === "OK" || outcome.data.length > 0) {
          verdicts = outcome.data;
        }
        dispatch({ type: "CLASSIFIED", unresolved: discarded, log });
      } else {
        verdicts = null;
        const detail =
          bundle.identifierUniverse.length === 0
            ? "no identifiers required local classification"
            : "Nano unavailable — deterministic verdicts only";
        dispatch({
          type: "CLASSIFIED",
          unresolved: [],
          log: localLog("CLASSIFY_LOCAL", "HEURISTIC", detail, Math.round(performance.now() - t0)),
        });
      }

      // Stage 1C — bijective vault swap (pure engine)
      const planned = planVault(extraction, bundle, verdicts);
      const sanitizedResult = sanitize(raw, planned.plan);

      // HARD PRE-FLIGHT GATE — nothing goes to the cloud until this passes.
      const assertion = assertNoLeaks(sanitizedResult.sanitized, sanitizedResult.vault, policy);
      dispatch({
        type: "SANITIZED",
        plan: planned.plan,
        sanitized: sanitizedResult.sanitized,
        vault: sanitizedResult.vault,
        assertion,
        swapCount: sanitizedResult.swapCount,
      });

      if (!assertion.pass) {
        dispatch({ type: "LEAK_BLOCKED", assertion });
        return;
      }

      const cloudBlocked = airGap || !policy.allowCloud || boot.localOnly || boot.cloudKillSwitch;
      if (cloudBlocked) {
        // Air-gap / local-only: no cloud handle is ever constructed.
        const result = rehydrate("", sanitizedResult.vault);
        dispatch({
          type: "REHYDRATED",
          result,
          syntaxNote: airGap
            ? "AIR-GAP: sanitized locally, no cloud request made"
            : "LOCAL-ONLY: sanitized and verified; cloud stage disabled (auth/credentials)",
          syntaxPassed: true,
        });
        return;
      }

      // ONLY_IN_CLOUD streaming refactor on the sanitized packet only.
      const outcome = await refactorInCloud(
        policy,
        sanitizedResult.sanitized,
        "safe code review and refactor pass",
        (partial) => dispatch({ type: "CLOUD_CHUNK", text: partial }),
      );
      const log = logHybridCall(
        boot, policy, "REFACTOR_CLOUD", "ONLY_IN_CLOUD", outcome.meta,
        sanitizedResult.sanitized.length, outcome.data.length,
      );
      if (outcome.meta.status !== "OK" && outcome.data.length === 0) {
        dispatch({
          type: "ERROR",
          code: outcome.meta.errorCode ?? "CLOUD_CALL_FAILED",
          message: friendlyCloudError(outcome.meta.errorCode),
          stage: "AWAIT_CLOUD",
        });
        // The log row is still emitted so the failure is visible in telemetry.
        dispatch({ type: "LOG", log });
        return;
      }
      dispatch({ type: "CLOUD_DONE", text: outcome.data, log });

      // Deterministic re-hydration + syntax integrity verification.
      const result = rehydrate(outcome.data, sanitizedResult.vault);
      const integrity = syntaxIntegrity(raw, sanitizedResult.sanitized, extraction);
      dispatch({
        type: "REHYDRATED",
        result,
        syntaxNote: integrity.detail,
        syntaxPassed: integrity.passed,
      });

      // PREFER_ON_DEVICE low-latency session title on already-sanitized text.
      if (boot.aiReady && !boot.localOnly) {
        const titleOutcome = await sessionTitle(policy, sanitizedResult.sanitized);
        const titleLog = logHybridCall(
          boot, policy, "SESSION_TITLE", "PREFER_ON_DEVICE", titleOutcome.meta,
          Math.min(600, sanitizedResult.sanitized.length), titleOutcome.data.length,
        );
        dispatch({ type: "TITLE", title: titleOutcome.data.slice(0, 80), log: titleLog });
      }
    },
    [boot, gate, dispatch],
  );

  const runRedTeam = useCallback(async () => {
    if (!state.sanitized || !state.vault || state.airGap || boot.localOnly || boot.cloudKillSwitch) {
      dispatch({
        type: "ERROR",
        code: "RED_TEAM_UNAVAILABLE",
        message: "Red-Team Probe requires a completed sanitized packet and an enabled cloud stage.",
        stage: "RED_TEAM_RUNNING",
      });
      return;
    }
    const start = performance.now();
    dispatch({ type: "RED_TEAM_START" });
    const outcome = await redTeamProbe(state.policy, state.sanitized);
    const score = scoreRedTeam(outcome.data, state.vault, state.policy.redTeamIterations);
    const log = logHybridCall(
      boot, state.policy, "RED_TEAM_CLOUD", "ONLY_IN_CLOUD", outcome.meta,
      state.sanitized.length, JSON.stringify(outcome.data).length,
    );

    const audit: RedTeamAuditResult = {
      auditId: crypto.randomUUID(),
      sessionId: boot.sessionId,
      score: { ...score, formula: "100 - 40*compromised - 20*partial - 10*(leaks>0)" },
      attackVectorsTried: score.attackVectorsTried,
      leaksDetected: score.leaksDetected,
      findings: score.findings,
      probeLatencyMs: Math.round(performance.now() - start),
      cloudModel: state.policy.cloudModel,
      completedAt: Date.now(),
    };
    boot.telemetry.logRedTeamAudit(audit);
    dispatch({ type: "RED_TEAM_DONE", probes: outcome.data, score, log });
  }, [boot, dispatch, state.sanitized, state.vault, state.airGap, state.policy, state.policy.redTeamIterations, boot.localOnly, boot.cloudKillSwitch]);

  const runQa = useCallback(
    async (question: string) => {
      if (!boot.aiReady || gate.availability !== "available") {
        dispatch({ type: "ERROR", code: "ON_DEVICE_UNAVAILABLE", message: "Gemini Nano is unavailable — local Q&A needs on-device inference.", stage: "AIR_GAP_LOCAL_QA" });
        return;
      }
      const outcome = await airGapQa(question, state.raw);
      if (outcome.data.length === 0 && outcome.meta.status !== "OK") {
        dispatch({
          type: "ERROR",
          code: outcome.meta.errorCode ?? "ON_DEVICE_UNAVAILABLE",
          message: /ON_DEVICE_STUB/i.test(outcome.meta.errorCode ?? "")
            ? "This browser stubs the on-device model (Chromium). Use Google Chrome with the Prompt API flags for Air-Gap Q&A."
            : "On-device answer failed. Gemini Nano may still be loading — try again.",
          stage: "AIR_GAP_LOCAL_QA",
        });
        return;
      }
      const log = logHybridCall(
        boot, state.policy, "AIRGAP_QA", "AIR_GAP_PURE_LOCAL", outcome.meta,
        state.raw.length + question.length, outcome.data.length,
      );
      dispatch({ type: "QA_ANSWER", answer: outcome.data, log });
    },
    [boot, gate, dispatch, state.raw, state.policy],
  );

  const runDownload = useCallback(async () => {
    const result = await downloadLanguageModel((fraction) =>
      dispatch({ type: "DOWNLOAD_PROGRESS", fraction }),
    );
    if (result.ok) dispatch({ type: "MODEL_DOWNLOAD_DONE" });
    else dispatch({ type: "ERROR", code: "MODEL_DOWNLOAD_FAILED", message: result.note, stage: "MODEL_DOWNLOADING" });
  }, [dispatch]);

  return { runPipeline, runRedTeam, runQa, runDownload };
}

/**
 * Wraps the pipeline so an unexpected exception (telemetry write, SDK edge case)
 * surfaces as a HUD error instead of a silent stall.
 */
export function withPipelineSafety(
  actions: WorkbenchActions,
  dispatch: Dispatch<Action>,
): WorkbenchActions {
  return {
    ...actions,
    runPipeline: async (raw, policy, airGap) => {
      try {
        await actions.runPipeline(raw, policy, airGap);
      } catch (err) {
        dispatch({
          type: "ERROR",
          code: "UNEXPECTED_PIPELINE_ERROR",
          message: err instanceof Error ? err.message : String(err),
          stage: "PIPELINE",
        });
      }
    },
    runRedTeam: async () => {
      try {
        await actions.runRedTeam();
      } catch (err) {
        dispatch({
          type: "ERROR",
          code: "UNEXPECTED_REDTEAM_ERROR",
          message: err instanceof Error ? err.message : String(err),
          stage: "RED_TEAM_RUNNING",
        });
      }
    },
  };
}
