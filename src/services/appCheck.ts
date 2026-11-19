/**
 * Firebase App Check — MUST be initialized before getAI() and before anonymous
 * auth in the bootstrap sequence.
 *
 * BINDING CONSTRAINT (AGENTS.md): self.FIREBASE_APPCHECK_DEBUG_TOKEN is set
 * from import.meta.env.VITE_APPCHECK_DEBUG_TOKEN BEFORE initializeAppCheck so
 * reCAPTCHA domain checks do not fail on chrome-extension:// origins.
 *
 * MV3 NOTE: extension pages may NOT load remote scripts, so reCAPTCHA
 * Enterprise (which fetches https://www.google.com/recaptcha/enterprise.js)
 * cannot be used inside the Side Panel. In debug-token mode the App Check SDK
 * bypasses the provider entirely (verified in @firebase/app-check: the
 * `isDebugMode()` exchange path runs before provider.getToken()), so token
 * issuance works with the registered debug token and no remote script.
 * For production distribution beyond the hackathon, use a custom App Check
 * provider backed by your own attestation endpoint instead of reCAPTCHA.
 *
 * Debug tokens are always injected via env (never hardcoded). Never commit one.
 */
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from "firebase/app-check";
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
  const isExtensionPage =
    typeof location !== "undefined" && location.protocol === "chrome-extension:";

  if (isExtensionPage && !debugTokenRegistered) {
    // MV3 extension pages cannot load the reCAPTCHA script, and without a
    // debug token the SDK would have to call the (blocked) provider.
    return {
      appCheck: null,
      debugTokenRegistered,
      note:
        "No App Check debug token. MV3 extension pages cannot load reCAPTCHA — " +
        "register a debug token (App Check → Manage debug tokens) or ship a custom provider.",
    };
  }

  if (!siteKey && !debugTokenRegistered) {
    return {
      appCheck: null,
      debugTokenRegistered,
      note: "No reCAPTCHA site key configured — AI calls will be blocked until App Check is set up.",
    };
  }

  try {
    // Debug-token mode bypasses the provider entirely; when no site key exists
    // (extension demo builds) a throwing custom provider is a safe placeholder.
    const provider = siteKey
      ? new ReCaptchaEnterpriseProvider(siteKey)
      : new CustomProvider({
          getToken: async () => {
            throw new Error("App Check provider unused: debug-token mode is active.");
          },
        });

    const appCheck = initializeAppCheck(app, {
      provider,
      isTokenAutoRefreshEnabled: true,
    });

    return {
      appCheck,
      debugTokenRegistered,
      note: debugTokenRegistered
        ? "Debug token loaded from VITE_APPCHECK_DEBUG_TOKEN (gitignored)."
        : "No debug token — dev builds auto-generate one; register it in Firebase Console → App Check.",
    };
  } catch (err) {
    return {
      appCheck: null,
      debugTokenRegistered,
      note: `App Check init failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
