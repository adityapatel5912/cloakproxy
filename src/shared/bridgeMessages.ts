import type { InputLanguage } from "../engine/types.js";
import type { CompliancePresetId } from "../engine/types.js";

/** chrome.* message protocol — pure types, safe for background + side panel. */

export interface PendingCapture {
  readonly version: 1;
  readonly text: string;
  readonly source: "context-menu" | "paste" | "sample";
  readonly pageUrl?: string;
  readonly ts: number;
}

export type BridgeMessage =
  | { readonly type: "panel-ready"; readonly ts: number }
  | { readonly type: "capture-ingested"; readonly key: string; readonly ts: number }
  | { readonly type: "policy-changed"; readonly preset: CompliancePresetId; readonly ts: number }
  | { readonly type: "ping"; readonly ts: number };

export interface LanguageHintMessage {
  readonly language: InputLanguage;
}
