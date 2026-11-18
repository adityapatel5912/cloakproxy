# Security Policy — CloakProxy

## Threat model

CloakProxy assumes the **cloud inference provider is untrusted** with respect to your secrets. The design goal: a developer must be able to get cloud-quality refactoring help on code containing live credentials, proprietary algorithms and customer PII, while provably sending none of it over the network.

| Threat | Mitigation |
|---|---|
| Secret/PII exfiltration via the AI prompt | Stage 1C vault swap + the pre-flight zero-leak assertion (client) — the request object is never constructed on failure |
| LLM rewriting/corrupting raw source | The LLM only ever sees sanitized placeholders; re-hydration is a deterministic reverse-map, never model output |
| LLM verdict drift or hallucination downgrading a secret | Deterministic regex/entropy hits are ground truth (`SECRET`, confidence 1.0); on-device verdicts can only add flags, never remove them (reconciler discards unmatched rows) |
| Adversarial reconstruction of hidden values | Red-Team Probe measures resistance locally; compromised guesses are redacted before display/persistence |
| Telemetry becoming a leak channel | Only aggregates are logged (token counts, latency, `inferenceSource`, scores, hashes). Firestore rules reject secret-shaped strings server-side |
| Unauthorized API usage of your Firebase project | App Check (reCAPTCHA Enterprise) with limited-use tokens; debug token only via gitignored env var |
| Malicious extension page → page DOM | No content scripts, no third-party DOM injection at all; capture is context-menu + paste only |
| Service worker abuse surface | `background.js` is ~1 kB, stateless, Firebase-free, and does no fetch |

## The pre-flight zero-leak assertion

The single most important line of defense. Immediately after the vault swap and **before** any cloud call:

1. Every vault original (`classification !== SAFE`, length ≥ 5) must **not** appear as a substring of the sanitized packet.
2. The full deterministic detector suite (regex + entropy + `.env` scan) is re-run against the sanitized packet and must yield zero new sensitive spans.

On failure the machine transitions to `ERROR{PRE_FLIGHT_LEAK}` and the network layer is never reached. There is no bypass flag, in code or in Remote Config.

## What is never committed

Enforced by `.gitignore` and verified in CI:

- `.env.local` — Firebase config + App Check debug token
- `key.pem` — extension signing private key
- `extension_public_key.txt` — the pinned public key (local helper only)
- `dist/` — bundles contain your Firebase web config
- `node_modules/`, `test-results/`, `playwright-report/`

App Check debug tokens are treated as private secrets: injected only through `import.meta.env.VITE_APPCHECK_DEBUG_TOKEN`, never hardcoded, never logged. If a token is compromised, revoke it in Firebase Console → App Check → Manage debug tokens immediately.

## Reporting a vulnerability

Please open a private security advisory on the repository (GitHub → Security → Advisories) rather than a public issue. Include the stage(s) involved and, if possible, a minimal fixture that reproduces the leak without containing real credentials.
