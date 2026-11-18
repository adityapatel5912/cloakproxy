import type { RehydrateResult } from "../../engine/types.js";

interface Props {
  output?: string;
  rehydrated?: RehydrateResult;
  syntaxNote?: string;
  syntaxPassed?: boolean;
  title?: string;
  airGap: boolean;
  cloudOutput?: string;
}

export function OutputPane({ output, rehydrated, syntaxNote, syntaxPassed, title, airGap, cloudOutput }: Props) {
  const hasOutput = typeof output === "string" && output.length > 0;
  return (
    <section className="pane output-pane">
      <header className="pane-head">
        <div>
          <span className="pane-index">03</span>
          <h2>RE-HYDRATED OUTPUT</h2>
        </div>
        {syntaxPassed !== undefined && (
          <span className={`pane-tag ${syntaxPassed ? "verified" : "unverified"}`}>
            {syntaxPassed ? "✓ SYNTAX INTACT" : "✕ SYNTAX CHECK FAILED"}
          </span>
        )}
      </header>

      {title && <p className="session-title">“{title}” <span className="mini-label">PREFER_ON_DEVICE</span></p>}

      <pre className="code-view output-view">
        {hasOutput ? output : airGap ? "// AIR-GAP MODE — no cloud request made.\n// Use local Q&A below to review the raw code entirely on-device." : "// Re-hydrated result appears here after the cloud response returns."}
      </pre>

      {cloudOutput && cloudOutput !== output && (
        <details className="wire-details">
          <summary>RAW CLOUD WIRE (sanitized tokens only)</summary>
          <pre className="code-view wire-view">{cloudOutput.slice(0, 4000)}</pre>
        </details>
      )}

      {rehydrated && (
        <div className="output-meta">
          <span>{rehydrated.replacedCount} tokens restored deterministically</span>
          {rehydrated.unresolvedKeys.length > 0 && (
            <span className="warn">⚠ {rehydrated.unresolvedKeys.length} unmapped token(s): {rehydrated.unresolvedKeys.join(", ")}</span>
          )}
          {syntaxNote && <span className="muted">{syntaxNote}</span>}
        </div>
      )}
    </section>
  );
}
