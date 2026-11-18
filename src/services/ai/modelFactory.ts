import {
  getGenerativeModel,
  InferenceMode,
  type GenerativeModel,
} from "firebase/ai";
import type { CompliancePolicyConfig } from "../../engine/types.js";
import { getAISession } from "./aiSession.js";
import {
  IdentifierClassificationSchema,
  RedTeamProbeSchema,
} from "./schemas.js";

/**
 * All three InferenceMode values are used meaningfully:
 *  - ONLY_ON_DEVICE  → Gemini Nano 4: Stage 1B semantic classification
 *  - ONLY_IN_CLOUD   → gemini-3.5-flash: sanitized refactor + red-team probes
 *  - PREFER_ON_DEVICE → Nano-first with gemini-3.5-flash-lite cloud fallback
 */
export type ModelKind = "classifier" | "refactor" | "probe" | "lite" | "qa";

export function getModel(
  kind: ModelKind,
  policy?: CompliancePolicyConfig,
): GenerativeModel {
  const ai = getAISession();
  if (!ai) throw new Error("AI session not initialized");
  switch (kind) {
    case "classifier":
      return getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_ON_DEVICE,
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: IdentifierClassificationSchema,
        },
      });
    case "refactor":
      return getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: { model: policy?.cloudModel ?? "gemini-3.5-flash" },
      });
    case "probe":
      return getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: { model: policy?.cloudModel ?? "gemini-3.5-flash" },
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: RedTeamProbeSchema,
        },
      });
    case "lite":
      return getGenerativeModel(ai, {
        mode: InferenceMode.PREFER_ON_DEVICE,
        inCloudParams: { model: policy?.liteModel ?? "gemini-3.5-flash-lite" },
      });
    case "qa":
      // Air-gap mode must NEVER fall back to cloud: hard-pinned on-device.
      return getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE });
  }
}

export function isOnDeviceOnly(mode: ModelKind): boolean {
  return mode === "classifier" || mode === "qa";
}
