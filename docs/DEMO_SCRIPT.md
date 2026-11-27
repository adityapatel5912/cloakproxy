# CloakProxy — Demo Recording Script

Target: ~3-minute 1080p video, caption cards + voiceover, no on-screen passwords or live credentials (all fixtures are synthetic).

## Shot list & narration

| Time | Visual | Narration |
|---|---|---|
| 0:00–0:08 | Title card: **CloakProxy — Zero-Trust AI Dev Workbench · #BuildHybridAI 2026** | "CloakProxy is a zero-trust AI workbench for developers. The promise is simple: raw secrets never leave your device." |
| 0:08–0:28 | Click **Stripe API key leak**; watch the stage rail | "One click loads a billing file with a hard-coded Stripe key and an internal email. Stage one A deterministically extracts spans using regex, entropy and an AST pass." |
| 0:28–0:48 | Wire X-ray pane zoom: `0 Bytes Raw PII`, vault legend, `inferenceSource` pill | "Stage one B classifies symbols — here on-device with Gemini Nano — and stage one C swaps flagged spans into an in-memory vault. This is the exact packet the cloud sees: zero bytes of raw PII." |
| 0:48–1:12 | Re-hydrated output + `✓ Syntax Intact` | "The cloud reasons only about placeholders. Re-hydration is a deterministic reverse-map on your device, so the returned code keeps valid syntax and every original value." |
| 1:12–1:32 | Click **Proprietary pricing algorithm**; highlights | "Proprietary logic is treated the same way. Internal margin and discount names are flagged locally, so the business logic itself stays off the wire." |
| 1:32–1:50 | Click **Production .env config**; leak badge + vaulted values | "Dot-env files need a different extractor. Whole values are vaulted — no partial password fragments survive at span boundaries." |
| 1:50–2:15 | Toggle **Air-Gap**; rerun; output note "AIR-GAP: no cloud request made" | "Air-gap mode pins everything on-device. No cloud request object is ever constructed — review and Q&A stay local." |
| 2:15–2:45 | **Red-Team Probe** → resistance score dial | "The red-team probe challenges cloud Gemini to reconstruct the hidden data. The score is computed locally, not by the model — a zero-knowledge resistance metric." |
| 2:45–3:00 | Outro: repo URL, MIT license, #BuildHybridAI 2026 | "CloakProxy: inspect, sanitize, refactor — without giving away what matters." |

## Notes for a future voiceover re-record
- Read at ~145 wpm; keep the "zero bytes of raw PII" line slow.
- The two money shots are the wire X-ray badge and the red-team dial.
- If Blaze billing is off, replace the red-team narration with: "Cloud stages are disabled until billing is enabled; the deterministic pipeline still works fully offline."
