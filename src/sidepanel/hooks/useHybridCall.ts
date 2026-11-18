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
import { downloadLanguageModel } from "../preflight/languageModelGate.js";
import type { BootResult } from "../bootstrap.js";
import type { Action, WorkbenchState } from "../state/workbenchMachine.js";
import { localLog, logHybridCall } from "./useTelemetry.js";

export interface WorkbenchActions {
  runPipeline: (raw: string, policy: CompliancePolicyConfig, airGap: boolean) => Promise<void>;
  runRedTeam: () => Promise<void>;
  runQa: (question: string) => Promise<void>;
  runDownload: () => Promise<void>;
}

/**
 * Orchestrates the full 3-stage pipeline, hybrid calls, telemetry and state
 * transitions. The engine itself never touches Firebase; it is called here.
 */
export function useHybridCall(
  boot: BootResult,
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
        boot.gate.availability === "available" &&
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
          log: localLog("CLASSIFY_LOCAL", "ONLY_ON_DEVICE", detail, Math.round(performance.now() - t0)),
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
          message: "Cloud refactor failed; the vault remains local. Retry or use Air-Gap mode.",
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
    [boot, dispatch],
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
      if (!boot.aiReady || boot.gate.availability !== "available") {
        dispatch({ type: "ERROR", code: "ON_DEVICE_UNAVAILABLE", message: "Gemini Nano is unavailable — local Q&A needs on-device inference.", stage: "AIR_GAP_LOCAL_QA" });
        return;
      }
      const outcome = await airGapQa(question, state.raw);
      const log = logHybridCall(
        boot, state.policy, "AIRGAP_QA", "AIR_GAP_PURE_LOCAL", outcome.meta,
        state.raw.length + question.length, outcome.data.length,
      );
      dispatch({ type: "QA_ANSWER", answer: outcome.data, log });
    },
    [boot, dispatch, state.raw, state.policy],
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
