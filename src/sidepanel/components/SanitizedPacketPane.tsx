import type { LeakAssertionResult, Vault } from "../../engine/types.js";
import type { CallLogItem } from "../state/workbenchMachine.js";

interface Props {
  sanitized?: string;
  vault?: Vault;
  assertion?: LeakAssertionResult;
  logs: readonly CallLogItem[];
}

export function SanitizedPacketPane({ sanitized, vault, assertion, logs }: Props) {
  const verified = assertion?.pass === true;
  const entries = vault ? [...vault.reverse().values()] : [];

  return (
    <section className="pane packet-pane">
      <header className="pane-head">
        <div>
          <span className="pane-index">02</span>
          <h2>SANITIZED CLOUD PACKET</h2>
        </div>
        <span className={`pane-tag ${verified ? "verified" : "unverified"}`}>
          {verified ? "✓ 0 BYTES RAW PII" : assertion ? "✕ LEAK GATE BLOCKED" : "AWAITING CLOAK"}
        </span>
      </header>

      <div className="source-pills">
        {logs.length === 0 ? (
          <span className="pill muted">NO INFERENCE YET</span>
        ) : (
          logs.map((log) => (
            <span
              key={log.id}
              className={`pill ${log.source === "ON_DEVICE" ? "on-device" : "in-cloud"}`}
              title={`${log.stage} · ${log.mode} · ${log.model ?? "local"}`}
            >
              {log.stage} · {log.source ?? log.mode} · {log.latencyMs}ms
            </span>
          ))
        )}
      </div>

      <pre className="code-view packet-view">{sanitized ?? "// Sanitized packet appears here after Stage 1C.\n// Vault keys are atomic, syntax-safe placeholders."}</pre>

      <div className="vault-legend">
        <span className="mini-label">BIJECTIVE VAULT · {entries.length} ENTRIES</span>
        <div className="vault-scroll">
          {entries.length === 0 ? (
            <span className="muted">No tokens vaulted yet.</span>
          ) : (
            entries.map((entry) => (
              <div key={entry.vaultKey} className="vault-row">
                <code className="vault-key">{entry.vaultKey}</code>
                <span className={`class-tag ${entry.classification.toLowerCase()}`}>{entry.classification}</span>
                <span className="vault-preview">{entry.safePreview}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {assertion && !assertion.pass && (
        <div className="alert alert-bad">
          <strong>PRE-FLIGHT LEAK ASSERTION TRIGGERED</strong>
          <ul>
            {assertion.findings.map((f, i) => (
              <li key={i}>{f.kind}: {f.detail} — {f.safePreview}</li>
            ))}
          </ul>
          <p>No cloud request was constructed.</p>
        </div>
      )}
    </section>
  );
}
