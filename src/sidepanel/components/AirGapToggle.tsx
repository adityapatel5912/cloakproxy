interface Props {
  enabled: boolean;
  onToggle: () => void;
}

export function AirGapToggle({ enabled, onToggle }: Props) {
  return (
    <button
      type="button"
      className={`airgap-toggle ${enabled ? "on" : ""}`}
      onClick={onToggle}
      aria-pressed={enabled}
      title="Force 100% on-device inference; no cloud requests are constructed"
    >
      <span className="toggle-dot" />
      {enabled ? "AIR-GAP: ON · 0 NETWORK CALLS" : "AIR-GAP: OFF"}
    </button>
  );
}
