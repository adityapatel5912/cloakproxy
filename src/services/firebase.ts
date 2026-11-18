/**
 * Firebase app initialization.
 * BINDING CONSTRAINT (AGENTS.md): this module and every other firebase/* import
 * must execute ONLY in the Chrome Side Panel page context (src/sidepanel/).
 * The MV3 service worker must never import this file.
 */
import { initializeApp, type FirebaseApp } from "firebase/app";

export interface FirebaseEnv {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly appId: string;
  readonly messagingSenderId?: string;
  readonly storageBucket?: string;
}

export function readFirebaseEnv(): FirebaseEnv | null {
  const env = import.meta.env;
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
  };
  if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    return null; // local-only mode: engine + on-device flows remain usable
  }
  return config;
}

let cachedApp: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  if (cachedApp) return cachedApp;
  const config = readFirebaseEnv();
  if (!config) return null;
  cachedApp = initializeApp(config);
  return cachedApp;
}
