/**
 * CloakProxy MV3 service worker — lightweight, stateless event router.
 * NO firebase/* import. NO AI streams. NO state beyond a menu id constant.
 * BINDING CONSTRAINT (AGENTS.md): all Firebase SDKs live in src/sidepanel/.
 */
import type { PendingCapture } from "../shared/bridgeMessages.js";
import {
  MAX_CAPTURE_CHARS,
  MENU_ID,
  PANEL_READY_MESSAGE,
} from "../shared/constants.js";
import { stashPendingCapture } from "./bridge.js";
import { configurePanelBehavior, openPanel } from "./sidePanelLifecycle.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Inspect & Refactor Safely in CloakProxy",
      contexts: ["selection", "editable", "page"],
    });
  });
  configurePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  configurePanelBehavior();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const text =
    info.selectionText ??
    (await chrome.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => tabs[0]?.title ?? ""));
  if (!text || text.length === 0) return;

  const capture: PendingCapture = {
    version: 1,
    text: text.slice(0, MAX_CAPTURE_CHARS),
    source: "context-menu",
    pageUrl: tab?.url,
    ts: Date.now(),
  };
  await stashPendingCapture(capture);
  await openPanel(tab?.id);
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  // Relay-only echo. No AI, no Firebase, no state mutation.
  if (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: string }).type === PANEL_READY_MESSAGE
  ) {
    return { ok: true, router: "stateless" };
  }
  return undefined;
});
