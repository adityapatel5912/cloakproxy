/**
 * Zero-knowledge audit telemetry.
 * ONLY aggregate metadata is persisted: token counts, latency splits,
 * inference sources, Red-Team scores, hashes. NEVER raw code, identifiers,
 * vault originals, model guesses or PII.
 *
 * Firestore rules (firestore.rules) enforce this server-side as well.
 */
import {
  collection,
  doc,
  setDoc,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import type { FirebaseApp } from "firebase/app";
import type {
  CompliancePolicyConfig,
  HybridCallTelemetry,
  RedTeamAuditResult,
} from "../engine/types.js";

export interface TelemetryContext {
  readonly uidHash: string;
  readonly preset: CompliancePresetIdLike;
}

type CompliancePresetIdLike = CompliancePolicyConfig["presetId"];

export class TelemetryService {
  private db: Firestore | null = null;
  private uid: string | null = null;
  private readonly offlineQueue: Array<() => Promise<void>> = [];
  private flushing = false;

  attach(app: FirebaseApp | null, uid: string): void {
    if (!app) return;
    try {
      this.db = getFirestore(app);
      this.uid = uid;
      window.addEventListener("online", () => void this.flush());
    } catch {
      this.db = null;
    }
  }

  private docRef(kind: "calls" | "redteam", id: string) {
    if (!this.db || !this.uid) return null;
    return doc(collection(this.db, "audit", this.uid, kind), id);
  }

  logCall(t: HybridCallTelemetry): void {
    const ref = this.docRef("calls", t.callId);
    if (!ref) return;
    const write = () => setDoc(ref, { ...t, clientTs: Date.now() });
    if (navigator.onLine) {
      void write().catch(() => this.enqueue(write));
    } else {
      this.enqueue(write);
    }
  }

  logRedTeamAudit(result: RedTeamAuditResult): void {
    const ref = this.docRef("redteam", result.auditId);
    if (!ref) return;
    // Findings carry only vector names, outcomes, redacted previews and scores.
    const write = () => setDoc(ref, { ...result });
    if (navigator.onLine) {
      void write().catch(() => this.enqueue(write));
    } else {
      this.enqueue(write);
    }
  }

  private enqueue(write: () => Promise<void>): void {
    if (this.offlineQueue.length >= 50) this.offlineQueue.shift(); // bounded queue
    this.offlineQueue.push(write);
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    while (this.offlineQueue.length > 0 && navigator.onLine) {
      const write = this.offlineQueue.shift();
      if (!write) break;
      try {
        await write();
      } catch {
        break; // retry on next online event
      }
    }
    this.flushing = false;
  }
}

/** SHA-256 UID hash — never persist raw UIDs in telemetry documents. */
export async function hashUid(uid: string): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    // Fallback for insecure contexts; extension pages are secure contexts so
    // this path should never execute in production.
    let h = 0;
    for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0;
    return `fnv_${(h >>> 0).toString(16).padStart(8, "0")}`;
  }
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(uid));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
