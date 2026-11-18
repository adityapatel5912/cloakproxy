# Contributing to CloakProxy

Thanks for helping build a zero-trust AI dev workbench. Before your first PR, please read `AGENTS.md` (binding constraints) and this file.

## Non-negotiable rules

These are enforced by CI, not convention — `npm run boundaries` and the test suite will fail otherwise:

1. **All Firebase SDKs live only in `src/sidepanel/`.** `src/extension/background.ts` must stay a stateless event router with zero Firebase imports.
2. **`src/engine/` stays pure.** No `firebase/*`, no `chrome.*`, no React. The deterministic engine must run in bare Node for the unit suite.
3. **Never let an LLM rewrite raw source.** New AI features consume sanitized packets and re-hydrate deterministically.
4. **No heavyweight parsers.** `acorn` + regex/entropy only — no `@babel/parser`, no WASM tree-sitter.
5. **Only `firebase/ai` v13+ imports.** The deprecated `@firebase/vertexai` package is banned.
6. **Zero-friction auth only.** `signInAnonymously`; popup/redirect flows fail on `chrome-extension://`.
7. **Debug token ordering.** `self.FIREBASE_APPCHECK_DEBUG_TOKEN` must be set **before** `initializeAppCheck`, and the value must come from `import.meta.env`, never a literal.
8. **Low-RAM guardrail.** Any new `dev`/`build` script keeps the `NODE_OPTIONS="--max-old-space-size=2048"` prefix (via `cross-env`).
9. **Never commit** `.env.local`, `key.pem`, or `extension_public_key.txt`.

## Pull-request checklist

- [ ] `npm run typecheck` passes (strict TS, no `any` leaks in new code)
- [ ] `npm test` passes; new engine features come with unit fixtures
- [ ] `npm run boundaries` passes
- [ ] If the pipeline changed: the property-based syntax-integrity corpus still passes at 100% and the pre-flight leak-gate tests cover the new path
- [ ] If the UI changed: no horizontal overflow at 420 px and 1280 px; text contrast ≥ 4.5:1; tap targets ≥ 30 px
- [ ] If telemetry changed: the Firestore zero-knowledge ruleset (`firestore.rules`) still allows exactly the fields you write
- [ ] `docs/` updated when behavior or setup changes

## Architecture map

```
src/engine/     deterministic core (pure, unit-tested, no I/O)
src/services/   Firebase + hybrid-AI adapters (consumed only by sidepanel)
src/extension/  MV3 chrome.* surface (stateless worker)
src/sidepanel/  Firebase execution host + glassbox HUD
```

Full spec: `docs/ARCHITECTURE_BLUEPRINT.md`.

## Commit style

Conventional commits, imperative mood: `feat(stage-1b): chunk identifier payloads`, `fix(csp): allow recaptcha enterprise script`, `docs: expand user guide`.

## Testing philosophy

- Deterministic engine behavior is proven hermetically — no mocks of Firebase internals, because the engine never sees them.
- Anything involving the browser is proven twice: Playwright E2E against the loaded unpacked extension, and manual rehearsal in a real Chrome profile.
- Security claims need adversarial tests: the leak gate is tested by *deliberately trying to smuggle a secret past it*.

## Local development

```bash
npm install
npx -y firebase-tools@latest init ailogic   # once, against your Firebase project
cp .env.example .env.local                  # fill in your config
npm run dev
```
