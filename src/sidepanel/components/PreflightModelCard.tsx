import type { GateState } from "../preflight/languageModelGate.js";

interface Props {
  gate: GateState;
  progress: number;
  onDownload: () => void;
}

export function PreflightModelCard({ gate, progress, onDownload }: Props) {
  const availability = gate.availability;
  const tone =
    availability === "available"
      ? "ok"
      : availability === "downloadable" || availability === "downloading"
        ? "warn"
        : "bad";

  return (
    <section className={`preflight-card ${tone}`} aria-label="Built-in AI diagnostic">
      <div className="preflight-head">
        <span className={`status-dot ${tone}`} />
        <strong>NANO 4 · {availability.toUpperCase()}</strong>
        {availability === "available" && <span className="pill on-device">ON_DEVICE READY</span>}
      </div>
      <p className="preflight-note">{gate.note}</p>
      {(availability === "downloadable" || availability === "downloading") && (
        <div className="download-block">
          <button type="button" className="download-button" onClick={onDownload}>
            1-CLICK DOWNLOAD · GEMINI NANO 4
          </button>
          <div className="progress-track" aria-label="Model download progress">
            <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className="progress-text">{Math.round(progress * 100)}%</span>
        </div>
      )}
      {!gate.supported && (
        <ul className="flags-list">
          <li><code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code></li>
          <li><code>chrome://flags/#optimization-guide-on-device-model</code></li>
          <li>Relaunch Chrome · ~2 GB free disk · Chrome 138+ x64</li>
        </ul>
      )}
      <p className="preflight-foot">Cloud + heuristic fallback flows stay testable in every state.</p>
    </section>
  );
}
