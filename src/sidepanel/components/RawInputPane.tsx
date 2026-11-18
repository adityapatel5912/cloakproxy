import type { ReactNode } from "react";
import type { SpanMatch, VaultPlanEntry } from "../../engine/types.js";
import type { Phase } from "../state/workbenchMachine.js";

interface Props {
  raw: string;
  matches: readonly SpanMatch[];
  plan: readonly VaultPlanEntry[];
  phase: Phase;
  parseNote?: string;
  onRawChange: (raw: string) => void;
  onRun: () => void;
  onEdit: () => void;
}

interface Segment {
  start: number;
  end: number;
  className: string;
  title: string;
}

/** Inline detection highlights, rendered from byte-exact spans only. */
function highlight(raw: string, plan: readonly VaultPlanEntry[]): ReactNode[] {
  const segments: Segment[] = [];
  for (const entry of plan) {
    if (entry.classification === "SAFE") continue;
    for (const span of entry.occurrences) {
      segments.push({
        start: span.start,
        end: span.end,
        className: `hl-${entry.classification.toLowerCase().replace("_", "-")}`,
        title: `${entry.classification} · ${entry.ruleId} · ${entry.safePreview}`,
      });
    }
  }
  segments.sort((a, b) => a.start - b.start);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  segments.forEach((seg, i) => {
    if (seg.start < cursor) return; // overlap guard
    if (seg.start > cursor) nodes.push(<span key={`t${i}`}>{raw.slice(cursor, seg.start)}</span>);
    nodes.push(
      <mark key={`m${i}`} className={seg.className} title={seg.title}>
        {raw.slice(seg.start, seg.end)}
      </mark>,
    );
    cursor = seg.end;
  });
  if (cursor < raw.length) nodes.push(<span key="tail">{raw.slice(cursor)}</span>);
  return nodes;
}

export function RawInputPane({ raw, matches, plan, phase, parseNote, onRawChange, onRun, onEdit }: Props) {
  const editable = phase === "IDLE" || phase === "ERROR";
  return (
    <section className="pane raw-pane">
      <header className="pane-head">
        <div>
          <span className="pane-index">01</span>
          <h2>RAW LOCAL INPUT</h2>
        </div>
        <span className="pane-tag">{matches.length} detections</span>
      </header>
      {editable ? (
        <>
          <textarea
            className="code-editor"
            value={raw}
            spellCheck={false}
            placeholder="Paste sensitive code, a prompt, or a .env file here — nothing leaves this device until the leak gate passes."
            onChange={(e) => onRawChange(e.target.value)}
          />
          <button type="button" className="primary-button" onClick={onRun} disabled={raw.trim().length === 0}>
            CLOAK &amp; REFACTOR →
          </button>
        </>
      ) : (
        <>
          <pre className="code-view">{highlight(raw, plan)}</pre>
          {parseNote && <p className="pane-foot">↳ {parseNote}</p>}
          <button type="button" className="ghost-button" onClick={onEdit}>EDIT RAW INPUT</button>
        </>
      )}
      <div className="detection-legend">
        <span><i className="swatch secret" /> SECRET</span>
        <span><i className="swatch prop" /> PROPRIETARY</span>
        <span><i className="swatch safe" /> SAFE (left intact)</span>
      </div>
    </section>
  );
}
