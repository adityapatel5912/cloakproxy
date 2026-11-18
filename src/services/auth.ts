/**
 * Zero-friction MV3 auth: anonymous sign-in only.
 * signInWithPopup / signInWithRedirect are BANNED (auth/unauthorized-domain on
 * chrome-extension:// origins) — see AGENTS.md.
 */
import {
  getAuth,
  signInAnonymously,
  type Auth,
  type User,
} from "firebase/auth";
import type { FirebaseApp } from "firebase/app";

export interface AuthState {
  readonly auth: Auth | null;
  readonly user: User | null;
  readonly localOnly: boolean; // true when auth failed or Firebase unavailable
  readonly note: string;
}

export async function initializeAnonymousAuth(app: FirebaseApp | null): Promise<AuthState> {
  if (!app) {
    return { auth: null, user: null, localOnly: true, note: "Firebase config missing — local-only mode." };
  }
  const auth = getAuth(app);
  try {
    const credential = await signInAnonymously(auth);
    return {
      auth,
      user: credential.user,
      localOnly: false,
      note: `Anonymous session ${credential.user.uid.slice(0, 8)}… established.`,
    };
  } catch (firstError) {
    // One retry handles transient network failures during side panel cold start.
    try {
      const credential = await signInAnonymously(auth);
      return {
        auth,
        user: credential.user,
        localOnly: false,
        note: "Anonymous sign-in succeeded after retry.",
      };
    } catch (retryError) {
      const code =
        retryError instanceof Error && "code" in retryError
          ? String((retryError as { code: unknown }).code)
          : "unknown";
      return {
        auth,
        user: null,
        localOnly: true,
        note: `Anonymous auth failed (${code}) — cloud stages disabled.`,
      };
    }
  }
}
