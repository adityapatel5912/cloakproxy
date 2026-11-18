import type { Phase } from "../state/workbenchMachine.js";

const STEPS = [
  { key: "EXTRACTING_1A", label: "1A · DETERMINISTIC EXTRACT" },
  { key: "CLASSIFYING_1B", label: "1B · NANO 4 CLASSIFY" },
  { key: "SWAPPING_1C", label: "1C · VAULT SWAP" },
  { key: "LEAK_ASSERT", label: "LEAK GATE" },
  { key: "AWAIT_CLOUD", label: "CLOUD INFERENCE" },
  { key: "REHYDRATING", label: "RE-HYDRATE" },
] as const;

interface Props {
  phase: Phase;
  errorCode?: string;
  swapCount: number;
  parseNote?: string;
}

export function StageRail({ phase, errorCode, swapCount, parseNote }: Props) {
  const current = STEPS.findIndex((s) => s.key === phase);
  const done = phase === "COMPLETE" || phase === "RED_TEAM_RUNNING" || phase === "AIR_GAP_LOCAL_QA";
  const failed = phase === "ERROR";

  return (
    <section className="stage-rail" aria-label="Cloaking pipeline stages">
      {STEPS.map((step, i) => {
        const state = failed && errorCode === "PRE_FLIGHT_LEAK" && step.key === "LEAK_ASSERT"
          ? "failed"
          : done || i < current
            ? "done"
            : i === current
              ? "active"
              : "pending";
        return (
          <div key={step.key} className={`stage-step ${state}`}>
            <span className="stage-index">{String(i + 1).padStart(2, "0")}</span>
            <span className="stage-label">{step.label}</span>
          </div>
        );
      })}
      <div className="stage-meta">
        <span>{swapCount} spans swapped</span>
        {parseNote && <span title={parseNote}>extractor: {parseNote.split(" ")[0]}</span>}
      </div>
    </section>
  );
}
