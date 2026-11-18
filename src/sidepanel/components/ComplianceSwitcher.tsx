import type { CompliancePolicyConfig, CompliancePresetId } from "../../engine/types.js";
import { applyLocalPreset } from "../../services/remoteConfig.js";

interface Props {
  policy: CompliancePolicyConfig;
  onChange: (policy: CompliancePolicyConfig) => void;
}

const PRESETS: readonly CompliancePresetId[] = ["STRICT_SOC2", "CODE_BALANCED", "OSS_PERMISSIVE"];

export function ComplianceSwitcher({ policy, onChange }: Props) {
  return (
    <div className="preset-switch" role="group" aria-label="Compliance preset">
      <span className="mini-label">RC PRESET</span>
      {PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          className={`preset-pill ${policy.presetId === preset ? "active" : ""}`}
          onClick={() => onChange(applyLocalPreset(preset))}
          title={`Remote Config preset: ${preset}`}
        >
          {preset.replace("_", " ")}
        </button>
      ))}
    </div>
  );
}
