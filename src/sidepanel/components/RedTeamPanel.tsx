import { useState } from "react";
import type { RedTeamScoreBreakdown } from "../../engine/types.js";

interface Props {
  score?: RedTeamScoreBreakdown;
  running: boolean;
  disabled: boolean;
  qaAnswer?: string;
  nanoReady: boolean;
  onProbe: () => void;
  onQa: (question: string) => void;
}

export function RedTeamPanel({ score, running, disabled, qaAnswer, nanoReady, onProbe, onQa }: Props) {
  const [question, setQuestion] = useState("");
  return (
    <section className="redteam-panel" aria-label="Red-team audit and air-gap Q&A">
      <div className="redteam-block">
        <div className="redteam-head">
          <h3>RED-TEAM PROBE</h3>
          <span className="mini-label">ONLY_IN_CLOUD · ADVERSARIAL</span>
        </div>
        <button type="button" className="probe-button" onClick={onProbe} disabled={disabled || running}>
          {running ? "PROBING…" : "1-CLICK RED-TEAM PROBE"}
        </button>
        {score && (
          <>
            <div className="score-row">
              <div className={`score-dial ${score.grade.toLowerCase()}`}>
                <strong>{score.value}%</strong>
                <span>{score.grade}</span>
              </div>
              <div className="score-detail">
                <span>{score.attackVectorsTried} vectors · {score.leaksDetected} leaks</span>
                <code>100 − 40·compromised − 20·partial − 10·leaks&gt;0</code>
              </div>
            </div>
            <ul className="findings">
              {score.findings.map((f, i) => (
                <li key={i}>
                  <span className={`finding outcome-${f.outcome.toLowerCase()}`}>{f.outcome}</span>
                  <span>{f.vector}</span>
                  <span className="muted">sim {f.similarity.toFixed(2)} · {f.guessSafePreview}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="redteam-block qa-block">
        <div className="redteam-head">
          <h3>AIR-GAP LOCAL Q&amp;A</h3>
          <span className="mini-label">ONLY_ON_DEVICE · 0 CALLS OUT</span>
        </div>
        <input
          className="qa-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={nanoReady ? "Ask about this code (stays on device)…" : "Requires Gemini Nano 4…"}
          disabled={!nanoReady}
        />
        <button type="button" className="ghost-button" onClick={() => onQa(question)} disabled={!nanoReady || question.trim().length === 0}>
          ASK ON DEVICE
        </button>
        {qaAnswer && (
          <div className="qa-answer">
            <span className="mini-label">NANO 4 ANSWER</span>
            <p>{qaAnswer}</p>
          </div>
        )}
      </div>
    </section>
  );
}
