/**
 * MV3 service-worker helpers — chrome.* only, stateless, Firebase-free.
 * The worker may be terminated after ~30s; nothing here holds state across
 * events. Pending payloads are handed off through chrome.storage.session.
 */
import type { PendingCapture } from "../shared/bridgeMessages.js";
import { MAX_CAPTURE_CHARS, PENDING_CAPTURE_KEY } from "../shared/constants.js";

export async function stashPendingCapture(capture: PendingCapture): Promise<void> {
  const trimmed =
    capture.text.length > MAX_CAPTURE_CHARS
      ? { ...capture, text: capture.text.slice(0, MAX_CAPTURE_CHARS) }
      : capture;
  await chrome.storage.session.set({ [PENDING_CAPTURE_KEY]: trimmed });
}

export async function readPendingCapture(): Promise<PendingCapture | null> {
  const bag = await chrome.storage.session.get(PENDING_CAPTURE_KEY);
  const value = bag[PENDING_CAPTURE_KEY] as PendingCapture | undefined;
  return value && typeof value.text === "string" ? value : null;
}

export async function clearPendingCapture(): Promise<void> {
  await chrome.storage.session.remove(PENDING_CAPTURE_KEY);
}

export function isBridgeMessage(value: unknown, type: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === type
  );
}
