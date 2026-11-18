/**
 * Hybrid call wrappers.
 * Every wrapper captures result.response.inferenceSource ("ON_DEVICE" vs
 * "IN_CLOUD") and per-stage latency, surfaced in the HUD and Firestore telemetry.
 */
import type {
  ClassifierPromptPayload,
  CompliancePolicyConfig,
  IdentifierVerdict,
  RedTeamProbeResponse,
} from "../../engine/types.js";
import { getModel } from "./modelFactory.js";
import {
  airGapQaPrompt,
  classifierPrompt,
  diffExplainPrompt,
  RED_TEAM_VECTORS,
  refactorPrompt,
  titlePrompt,
} from "./prompts.js";

export type Source = "ON_DEVICE" | "IN_CLOUD";

export interface CallMeta {
  readonly inferenceSource?: Source;
  readonly latencyMs: number;
  readonly model?: string;
  readonly status: "OK" | "FALLBACK" | "ERROR" | "RATE_LIMITED";
  readonly errorCode?: string;
}

export interface CallOutcome<T> {
  readonly data: T;
  readonly meta: CallMeta;
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

function isRateLimit(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /\b429\b/i.test(message) ||
    /resource[-_ ]?exhausted/i.test(message) ||
    /too many requests/i.test(message) ||
    /quota/i.test(message)
  );
}

function readSource(response: unknown): Source | undefined {
  const source = (response as { inferenceSource?: unknown } | null)?.inferenceSource;
  if (typeof source !== "string") return undefined;
  if (/ON_DEVICE/i.test(source)) return "ON_DEVICE";
  if (/IN_CLOUD/i.test(source)) return "IN_CLOUD";
  return undefined;
}

function parseJsonLoose<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("model returned no JSON object");
  return JSON.parse(text.slice(start, end + 1)) as T;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRateLimit(err) || i === attempts) throw err;
      const delay = (i === 0 ? 1000 : 4000) + Math.floor(Math.random() * 250);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function metaFor(start: number, response: unknown, model: string, err?: unknown): CallMeta {
  return {
    inferenceSource: readSource(response),
    latencyMs: Math.round(performance.now() - start),
    model,
    status: err ? (isRateLimit(err) ? "RATE_LIMITED" : "ERROR") : "OK",
    errorCode: err ? (err instanceof Error ? err.message.slice(0, 120) : String(err)) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Stage 1B — ONLY_ON_DEVICE identifier classification                 */
/* ------------------------------------------------------------------ */

export async function classifyIdentifiers(
  payloads: readonly ClassifierPromptPayload[],
): Promise<CallOutcome<IdentifierVerdict[]>> {
  const start = performance.now();
  const verdicts: IdentifierVerdict[] = [];
  let lastResponse: unknown;
  try {
    for (const payload of payloads) {
      if (payload.identifiers.length === 0) continue;
      const model = getModel("classifier");
      const result = await model.generateContent(classifierPrompt(payload));
      lastResponse = result.response;
      const parsed = parseJsonLoose<{ classifications?: unknown }>(result.response.text());
      const rows = Array.isArray(parsed.classifications) ? parsed.classifications : [];
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        const symbolClass =
          r.symbolClass === "SECRET" || r.symbolClass === "PROPRIETARY_LOGIC" || r.symbolClass === "SAFE"
            ? r.symbolClass
            : "SAFE";
        if (typeof r.identifier !== "string") continue;
        verdicts.push({
          identifier: r.identifier,
          symbolClass,
          confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0.5,
          rationaleCode:
            r.rationaleCode === "NAMING_PATTERN" ||
            r.rationaleCode === "ASSIGNMENT_CONTEXT" ||
            r.rationaleCode === "GENERIC" ||
            r.rationaleCode === "BUSINESS_TERM"
              ? r.rationaleCode
              : "NAMING_PATTERN",
        });
      }
    }
    return { data: verdicts, meta: metaFor(start, lastResponse, "gemini-nano-4") };
  } catch (err) {
    return { data: verdicts, meta: metaFor(start, lastResponse, "gemini-nano-4", err) };
  }
}

/* ------------------------------------------------------------------ */
/* ONLY_IN_CLOUD sanitized refactor (streaming)                       */
/* ------------------------------------------------------------------ */

export async function refactorInCloud(
  policy: CompliancePolicyConfig,
  sanitized: string,
  instruction: string,
  onChunk: (partial: string) => void,
): Promise<CallOutcome<string>> {
  const start = performance.now();
  let response: unknown;
  try {
    const model = getModel("refactor", policy);
    const result = await withRetry(() =>
      model.generateContentStream(`${refactorPrompt(instruction)}\n\n${sanitized}`),
    );
    let text = "";
    for await (const chunk of result.stream) {
      text += chunk.text();
      onChunk(text);
    }
    response = await result.response;
    return { data: text, meta: metaFor(start, response, policy.cloudModel) };
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    return { data: "", meta: metaFor(start, response, policy.cloudModel, err) };
  }
}

/* ------------------------------------------------------------------ */
/* ONLY_IN_CLOUD red-team adversarial audit                           */
/* ------------------------------------------------------------------ */

export async function redTeamProbe(
  policy: CompliancePolicyConfig,
  sanitized: string,
  iterations = policy.redTeamIterations,
): Promise<CallOutcome<RedTeamProbeResponse[]>> {
  const start = performance.now();
  const probes: RedTeamProbeResponse[] = [];
  let response: unknown;
  try {
    const model = getModel("probe", policy);
    const vectors = RED_TEAM_VECTORS.slice(0, Math.min(iterations, RED_TEAM_VECTORS.length));
    for (const vector of vectors) {
      const result = await withRetry(() =>
        model.generateContent(`${vector.prompt}\n\nSanitized code:\n${sanitized}`),
      );
      response = result.response;
      const parsed = parseJsonLoose<RedTeamProbeResponse>(result.response.text());
      probes.push({
        attackName: typeof parsed.attackName === "string" ? parsed.attackName : vector.name,
        guess: typeof parsed.guess === "string" ? parsed.guess : "",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      });
    }
    return { data: probes, meta: metaFor(start, response, policy.cloudModel) };
  } catch (err) {
    return { data: probes, meta: metaFor(start, response, policy.cloudModel, err) };
  }
}

/* ------------------------------------------------------------------ */
/* PREFER_ON_DEVICE low-latency helpers                               */
/* ------------------------------------------------------------------ */

async function liteText(policy: CompliancePolicyConfig, prompt: string): Promise<CallOutcome<string>> {
  const start = performance.now();
  let response: unknown;
  try {
    const model = getModel("lite", policy);
    const result = await withRetry(() => model.generateContent(prompt));
    response = result.response;
    const raw = result.response.text();
    try {
      const parsed = parseJsonLoose<{ text?: string }>(raw);
      return {
        data: typeof parsed.text === "string" ? parsed.text : raw,
        meta: metaFor(start, response, policy.liteModel),
      };
    } catch {
      return { data: raw, meta: metaFor(start, response, policy.liteModel) };
    }
  } catch (err) {
    return { data: "", meta: metaFor(start, response, policy.liteModel, err) };
  }
}

export function sessionTitle(policy: CompliancePolicyConfig, sanitized: string): Promise<CallOutcome<string>> {
  return liteText(policy, titlePrompt(sanitized));
}

export function diffExplain(policy: CompliancePolicyConfig, diff: string): Promise<CallOutcome<string>> {
  return liteText(policy, diffExplainPrompt(diff));
}

/* ------------------------------------------------------------------ */
/* ONLY_ON_DEVICE air-gap Q&A (never falls back to cloud)             */
/* ------------------------------------------------------------------ */

export async function airGapQa(
  question: string,
  localContext: string,
): Promise<CallOutcome<string>> {
  const start = performance.now();
  let response: unknown;
  try {
    const model = getModel("qa");
    const result = await model.generateContent(airGapQaPrompt(question, localContext));
    response = result.response;
    return { data: result.response.text(), meta: metaFor(start, response, "gemini-nano-4") };
  } catch (err) {
    return { data: "", meta: metaFor(start, response, "gemini-nano-4", err) };
  }
}
