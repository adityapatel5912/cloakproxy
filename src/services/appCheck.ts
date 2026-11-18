/**
 * Firebase App Check — MUST be initialized before getAI() and before anonymous
 * auth in the bootstrap sequence.
 *
 * BINDING CONSTRAINT (AGENTS.md): self.FIREBASE_APPCHECK_DEBUG_TOKEN is set
 * from import.meta.env.VITE_APPCHECK_DEBUG_TOKEN BEFORE initializeAppCheck so
 * reCAPTCHA domain checks do not fail on chrome-extension:// origins.
 *
 * Debug tokens are always injected via env (never hardcoded). Never commit one.
 */
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from "firebase/app-check";
import type { FirebaseApp } from "firebase/app";

declare global {
  interface Window {
    FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean;
  }
}

export interface AppCheckSetup {
  readonly appCheck: AppCheck | null;
  readonly debugTokenRegistered: boolean;
  readonly note: string;
}

export function setupAppCheck(app: FirebaseApp): AppCheckSetup {
  const env = import.meta.env;
  const token = env.VITE_APPCHECK_DEBUG_TOKEN;
  const debugTokenRegistered = typeof token === "string" && token.trim().length > 0;

  // ORDER IS CRITICAL — do not move this after initializeAppCheck.
  if (typeof self !== "undefined") {
    (self as unknown as Window).FIREBASE_APPCHECK_DEBUG_TOKEN =
      token && token.trim().length > 0
        ? token.trim()
        : env.DEV
          ? true // auto-generate a token in dev; register it in the Firebase console
          : undefined;
  }

  const siteKey = env.VITE_RECAPTCHA_SITE_KEY;
  if (!siteKey) {
    return {
      appCheck: null,
      debugTokenRegistered,
      note: "No reCAPTCHA site key configured — AI calls will be blocked until App Check is set up.",
    };
  }

  const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });

  return {
    appCheck,
    debugTokenRegistered,
    note: debugTokenRegistered
      ? "Debug token loaded from VITE_APPCHECK_DEBUG_TOKEN (gitignored)."
      : "No debug token — dev builds auto-generate one; register it in Firebase Console → App Check.",
  };
}
