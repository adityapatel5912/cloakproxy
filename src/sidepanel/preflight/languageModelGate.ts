/**
 * Pre-flight Built-in AI diagnostic gate (§3.6).
 * Chrome exposes the Prompt API as `LanguageModel` on the page global.
 * Minimal local typings are declared here to avoid pulling in heavyweight types.
 */

export type ModelAvailability = "unavailable" | "downloadable" | "downloading" | "available";

interface DownloadProgress {
  readonly loaded: number;
  readonly total: number;
}

interface ModelMonitor {
  addEventListener(type: "downloadprogress", listener: (event: DownloadProgress) => void): void;
}

interface PromptApi {
  availability(): Promise<ModelAvailability>;
  // Chrome's Prompt API takes a CALLBACK that receives the monitor, not an object.
  create(options?: { monitor?: (monitor: ModelMonitor) => void }): Promise<unknown>;
}

interface WithPromptApi {
  LanguageModel?: PromptApi;
}

export interface GateState {
  readonly supported: boolean;
  readonly availability: ModelAvailability;
  readonly note: string;
}

export async function probeLanguageModel(): Promise<GateState> {
  const api = (self as unknown as WithPromptApi).LanguageModel;
  if (!api) {
    return {
      supported: false,
      availability: "unavailable",
      note: 'Built-in AI not exposed. Enable chrome://flags/#prompt-api-for-gemini-nano-multimodal-input and chrome://flags/#optimization-guide-on-device-model, then relaunch Chrome.',
    };
  }
  try {
    const availability = await api.availability();
    const note =
      availability === "downloadable"
        ? "Gemini Nano 4 is downloadable — click to download (~2 GB)."
        : availability === "downloading"
          ? "Gemini Nano 4 is downloading in the background."
          : availability === "available"
            ? "Gemini Nano 4 is ready for on-device inference."
            : "Gemini Nano 4 is unavailable on this device. Cloud and fallback flows remain testable.";
    return { supported: true, availability, note };
  } catch (err) {
    return {
      supported: true,
      availability: "unavailable",
      note: `Built-in AI probe failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function downloadLanguageModel(
  onProgress: (fraction: number) => void,
): Promise<{ ok: boolean; note: string }> {
  const api = (self as unknown as WithPromptApi).LanguageModel;
  if (!api) return { ok: false, note: "Prompt API unavailable." };
  try {
    await api.create({
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          if (event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
        });
      },
    });
    return { ok: true, note: "Gemini Nano 4 is ready." };
  } catch (err) {
    return {
      ok: false,
      note: `Download failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
