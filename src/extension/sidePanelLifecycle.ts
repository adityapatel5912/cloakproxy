/** Panel lifecycle wiring — called from the service worker on install/startup. */
export function configurePanelBehavior(): void {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

/** Best-effort: opens the side panel if a tab id is available (user gesture context). */
export async function openPanel(tabId?: number): Promise<void> {
  try {
    if (tabId !== undefined) {
      await chrome.sidePanel.open({ tabId });
    }
  } catch {
    // The panel may already be open — the pending-capture storage handoff
    // (storage.onChanged in the side panel) still delivers the payload.
  }
}
