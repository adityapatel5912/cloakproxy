import { useEffect } from "react";
import { clearPendingCapture, readPendingCapture } from "../../extension/bridge.js";

/**
 * Handles the cold-start context-menu handoff:
 * background service worker writes chrome.storage.session["pendingCapture"],
 * then opens (or focuses) the side panel. This hook drains it on mount and
 * subscribes to later writes while the panel stays open.
 */
export function usePendingCapture(onCapture: (text: string, source: string) => void): void {
  useEffect(() => {
    // In a normal browser tab (used for web-based demos/verification) there is
    // no chrome.* API — capture then happens via paste / built-in samples only.
    if (typeof chrome === "undefined" || !chrome.storage?.session) return;
    let disposed = false;
    void readPendingCapture().then((capture) => {
      if (disposed || !capture) return;
      onCapture(capture.text, capture.source);
      void clearPendingCapture();
    });

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (disposed || areaName !== "session") return;
      const change = changes.pendingCapture;
      const value = change?.newValue as { text?: string; source?: string } | undefined;
      if (typeof value?.text === "string") {
        onCapture(value.text, value.source ?? "context-menu");
        void clearPendingCapture();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [onCapture]);
}
