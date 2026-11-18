import type {
  CompliancePolicyConfig,
  HybridCallTelemetry,
  PipelineStage,
  InferenceModeLiteral,
} from "../../engine/types.js";
import type { CallMeta } from "../../services/ai/calls.js";
import type { BootResult } from "../bootstrap.js";
import { telemetryToLogItem, type CallLogItem } from "../state/workbenchMachine.js";

/**
 * Builds a Firestore-safe telemetry record (no code, no PII) and mirrors it
 * into the HUD call log. Every hybrid call goes through this helper so the
 * inferenceSource pill and the latency meter are never missed (INV-4).
 */
export function logHybridCall(
  boot: BootResult,
  policy: CompliancePolicyConfig,
  stage: PipelineStage,
  mode: InferenceModeLiteral,
  meta: CallMeta,
  promptChars: number,
  completionChars: number,
): CallLogItem {
  const telemetry: HybridCallTelemetry = {
    callId: crypto.randomUUID(),
    sessionId: boot.sessionId,
    uidHash: boot.uidHash,
    stage,
    mode,
    inferenceSource: meta.inferenceSource,
    model: meta.model,
    fallbackUsed:
      meta.status === "FALLBACK" ||
      (mode === "PREFER_ON_DEVICE" && meta.inferenceSource === "IN_CLOUD"),
    latencyMs: meta.latencyMs,
    promptTokenEstimate: Math.ceil(promptChars / 4),
    completionTokenEstimate: Math.ceil(completionChars / 4),
    status: mapStatus(meta.status),
    errorCode: meta.errorCode,
    preset: policy.presetId,
    clientTs: Date.now(),
  };
  boot.telemetry.logCall(telemetry);
  return telemetryToLogItem(telemetry);
}

function mapStatus(s: CallMeta["status"]): HybridCallTelemetry["status"] {
  switch (s) {
    case "OK":
      return "OK";
    case "FALLBACK":
      return "FALLBACK";
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "ERROR":
    default:
      return "ERROR";
  }
}

/**
 * Synthetic local log row for stages where NO model call was made
 * (deterministic heuristics only). Must not claim ON_DEVICE inference —
 * there is no inferenceSource to report in that case (INV-4).
 */
export function localLog(
  stage: string,
  mode: string,
  detail: string,
  latencyMs: number,
): CallLogItem {
  return {
    id: crypto.randomUUID(),
    stage,
    mode,
    source: "HEURISTIC",
    latencyMs,
    status: detail.length > 0 ? "FALLBACK" : "OK",
  };
}
