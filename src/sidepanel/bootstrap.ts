/**
 * Side Panel bootstrap — STRICT ORDER (AGENTS.md + blueprint §3.7).
 * 1. App Check debug token (set inside setupAppCheck, before initializeAppCheck)
 * 2. initializeApp
 * 3. initializeAppCheck
 * 4. signInAnonymously (never popup/redirect)
 * 5. Remote Config → compliance_preset
 * 6. getAI (GoogleAIBackend + limited-use App Check tokens)
 * 7. Built-in AI pre-flight gate
 */
import type { CompliancePolicyConfig } from "../engine/types.js";
import { DEFAULT_POLICY } from "../engine/policy.js";
import { getFirebaseApp } from "../services/firebase.js";
import { setupAppCheck } from "../services/appCheck.js";
import { initializeAnonymousAuth } from "../services/auth.js";
import { initializeRemoteConfig, cloudKillSwitch } from "../services/remoteConfig.js";
import { initializeAISession } from "../services/ai/aiSession.js";
import { hashUid, TelemetryService } from "../services/telemetry.js";
import { probeLanguageModel, type GateState } from "./preflight/languageModelGate.js";

export interface BootResult {
  readonly policy: CompliancePolicyConfig;
  readonly localOnly: boolean; // cloud stages disabled (auth/Firebase/AI init failure)
  readonly aiReady: boolean;
  readonly authNote: string;
  readonly appCheckNote: string;
  readonly gate: GateState;
  readonly warnings: string[];
  readonly uidHash: string;
  readonly sessionId: string;
  readonly cloudKillSwitch: boolean;
  readonly telemetry: TelemetryService;
}

export async function bootstrap(): Promise<BootResult> {
  const warnings: string[] = [];
  const app = getFirebaseApp(); // step 2 (debug token set in step 3 helper first)
  if (!app) warnings.push("Firebase config missing — local-only cloaking + air-gap review available.");

  // SetupAppCheck sets self.FIREBASE_APPCHECK_DEBUG_TOKEN BEFORE initializeAppCheck.
  const appCheck = app ? setupAppCheck(app) : null;
  if (appCheck && !appCheck.debugTokenRegistered) warnings.push(appCheck.note);

  const authState = await initializeAnonymousAuth(app); // step 4
  if (authState.localOnly) warnings.push(authState.note);

  const policy = await initializeRemoteConfig(app); // step 5
  let aiReady = false;
  if (app && !authState.localOnly) {
    try {
      initializeAISession(app); // step 6
      aiReady = true;
    } catch (err) {
      warnings.push(`AI session init failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const uidHash = authState.user ? await hashUid(authState.user.uid) : "local-only";
  const telemetry = new TelemetryService();
  if (app && authState.user) telemetry.attach(app, authState.user.uid);

  const gate = await probeLanguageModel(); // step 7 (non-blocking)
  if (!gate.supported || gate.availability === "unavailable") {
    warnings.push(gate.note);
  }

  return {
    policy,
    localOnly: !aiReady || authState.localOnly || !app,
    aiReady,
    authNote: authState.note,
    appCheckNote: appCheck?.note ?? "App Check not initialized (local-only mode).",
    gate,
    warnings,
    uidHash,
    sessionId: crypto.randomUUID(),
    cloudKillSwitch: cloudKillSwitch(),
    telemetry,
  };
}

export { DEFAULT_POLICY };
