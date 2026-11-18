/**
 * Single Firebase AI Logic session for ALL hybrid calls.
 * useLimitedUseAppCheckTokens:true is REQUIRED for generative/preview models:
 * without it requests fail with HTTP 403 "To access this model, you must
 * enforce Firebase App Check" (replay protection via 5-minute tokens).
 */
import { getAI, GoogleAIBackend, type AI } from "firebase/ai";
import type { FirebaseApp } from "firebase/app";

let cachedAI: AI | null = null;

export function initializeAISession(app: FirebaseApp): AI {
  if (cachedAI) return cachedAI;
  cachedAI = getAI(app, {
    backend: new GoogleAIBackend(),
    useLimitedUseAppCheckTokens: true,
  });
  return cachedAI;
}

export function getAISession(): AI | null {
  return cachedAI;
}
