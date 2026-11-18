import { useCallback, useMemo, useReducer } from "react";
import type { BootResult } from "../bootstrap.js";
import { useHybridCall } from "../hooks/useHybridCall.js";
import { usePendingCapture } from "../hooks/usePendingCapture.js";
import { initialState, reducer } from "../state/workbenchMachine.js";
import { AirGapToggle } from "./AirGapToggle.js";
import { ComplianceSwitcher } from "./ComplianceSwitcher.js";
import { OutputPane } from "./OutputPane.js";
import { PreflightModelCard } from "./PreflightModelCard.js";
import { RawInputPane } from "./RawInputPane.js";
import { RedTeamPanel } from "./RedTeamPanel.js";
import { SamplesBar } from "./SamplesBar.js";
import { SanitizedPacketPane } from "./SanitizedPacketPane.js";
import { StageRail } from "./StageRail.js";

interface Props {
  boot: BootResult;
}

export function Workbench({ boot }: Props) {
  const [state, dispatch] = useReducer(reducer, boot.policy, initialState);
  const actions = useHybridCall(boot, state, dispatch);

  const capture = useCallback(
    (text: string, source: string) => {
      dispatch({ type: "SET_RAW", raw: text });
      void actions.runPipeline(text, state.policy, state.airGap);
    },
    [actions, state.policy, state.airGap],
  );
  usePendingCapture(capture);

  const onSample = useCallback(
    (text: string, label: string) => {
      dispatch({ type: "SET_RAW", raw: text });
      void actions.runPipeline(text, state.policy, state.airGap);
      void label; // title is shown via the sample button itself
    },
    [actions, state.policy, state.airGap],
  );

  const onRun = useCallback(() => {
    void actions.runPipeline(state.raw, state.policy, state.airGap);
  }, [actions, state.raw, state.policy, state.airGap]);

  const nanoReady = useMemo(
    () => boot.aiReady && boot.gate.availability === "available",
    [boot.aiReady, boot.gate.availability],
  );

  return (
    <div className="workbench">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <div>
            <h1>CloakProxy</h1>
            <p>Zero-Trust AI Dev Workbench · #BuildHybridAI 2026</p>
          </div>
        </div>
        <div className="topbar-controls">
          <ComplianceSwitcher
            policy={state.policy}
            onChange={(policy) => dispatch({ type: "SET_POLICY", policy })}
          />
          <AirGapToggle
            enabled={state.airGap}
            onToggle={() => dispatch({ type: "TOGGLE_AIRGAP" })}
          />
        </div>
      </header>

      {boot.localOnly && (
        <div className="notice" role="status">
          <strong>Cloud stages disabled</strong>
          <span>{boot.authNote.replace(/ ?[—-] ?cloud stages disabled\.?$/i, "")}</span>
          {/admin-restricted|admin-only|operation-not-allowed|operation_not_allowed/i.test(boot.authNote) && (
            <span>
              Enable <b>Anonymous</b> in Firebase Console → Authentication → Sign-in method,
              then reload the panel.
            </span>
          )}
        </div>
      )}

      <div className="diagnostic-row">
        <PreflightModelCard
          gate={boot.gate}
          progress={state.downloadProgress}
          onDownload={() => void actions.runDownload()}
        />
        <StageRail
          phase={state.phase}
          errorCode={state.error?.code}
          swapCount={state.swapCount}
          parseNote={state.parseNote}
        />
      </div>

      <SamplesBar onSelect={onSample} />

      <main className="grid-three">
        <RawInputPane
          raw={state.raw}
          matches={state.matches}
          plan={state.plan}
          phase={state.phase}
          parseNote={state.parseNote}
          onRawChange={(raw) => dispatch({ type: "SET_RAW", raw })}
          onRun={onRun}
          onEdit={() => dispatch({ type: "RESET" })}
        />
        <SanitizedPacketPane
          sanitized={state.sanitized}
          vault={state.vault}
          assertion={state.assertion}
          logs={state.logs}
        />
        <OutputPane
          output={state.rehydrated?.text}
          rehydrated={state.rehydrated}
          syntaxNote={state.syntaxNote}
          syntaxPassed={state.syntaxPassed}
          title={state.sessionTitle}
          airGap={state.airGap}
          cloudOutput={state.cloudOutput}
        />
      </main>

      <RedTeamPanel
        score={state.redTeam.score}
        running={state.redTeam.running}
        disabled={!state.sanitized || boot.localOnly || state.airGap || boot.cloudKillSwitch}
        qaAnswer={state.qaAnswer}
        nanoReady={nanoReady}
        onProbe={() => void actions.runRedTeam()}
        onQa={(question) => void actions.runQa(question)}
      />

      {state.error && (
        <div className="alert alert-bad global-error">
          <strong>{state.error.code}</strong> · {state.error.message} <span className="muted">({state.error.stage})</span>
        </div>
      )}
      <footer className="statusbar">
        <span>SESSION {boot.sessionId.slice(0, 8)}</span>
        <span>UID {boot.uidHash.slice(0, 12)}</span>
        <span>PRESET {state.policy.presetId}</span>
        <span>{boot.localOnly ? "LOCAL-ONLY" : "HYBRID READY"}</span>
        <span title={boot.authNote}>AUTH · ANONYMOUS</span>
        <span title={boot.appCheckNote}>APP CHECK · ACTIVE</span>
      </footer>
    </div>
  );
}
