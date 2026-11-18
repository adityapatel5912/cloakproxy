/**
 * Firebase Remote Config — live compliance presets.
 * `compliance_preset` is a JSON string validated by the engine's policy module
 * before it can influence detection thresholds. Any bad/missing value falls
 * back to CODE_BALANCED (never to "permissive").
 */
import {
  getRemoteConfig,
  fetchAndActivate,
  getValue,
  type RemoteConfig,
} from "firebase/remote-config";
import type { FirebaseApp } from "firebase/app";
import {
  DEFAULT_POLICY,
  validatePolicy,
  validatePolicyJson,
} from "../engine/policy.js";
import type { CompliancePolicyConfig, CompliancePresetId } from "../engine/types.js";

const KEY = "compliance_preset";

let rc: RemoteConfig | null = null;

export async function initializeRemoteConfig(app: FirebaseApp | null): Promise<CompliancePolicyConfig> {
  if (!app) return DEFAULT_POLICY.CODE_BALANCED;
  try {
    rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 0 : 3_600_000;
    await fetchAndActivate(rc);
    const raw = getValue(rc, KEY).asString();
    return validatePolicyJson(raw);
  } catch {
    return DEFAULT_POLICY.CODE_BALANCED; // cached/default preset; never trust broken remote data
  }
}

/** Instant local switch used by the ComplianceSwitcher HUD control. */
export function applyLocalPreset(presetId: CompliancePresetId): CompliancePolicyConfig {
  const validated = validatePolicy(DEFAULT_POLICY[presetId]);
  if (rc) {
    // Best-effort local override for the current session; RC re-activation wins
    // on next panel mount. (setValue is intentionally not persisted.)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rc as unknown as { setInternalValue?: (k: string, v: string) => void }).setInternalValue?.(
        KEY,
        JSON.stringify(validated),
      );
    } catch {
      /* local-only override is still returned to the caller */
    }
  }
  return validated;
}

export function cloudKillSwitch(): boolean {
  if (!rc) return false;
  try {
    return getValue(rc, "cloud_kill_switch").asString() === "true";
  } catch {
    return false;
  }
}
