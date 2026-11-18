# AGENTS.md — CloakProxy v2.0 Engineering Constraints

These constraints are **binding** for all code generation, scaffolding, and edits in this repository.

CloakProxy v2.0 is a Chrome Manifest V3 Side Panel extension built with **TypeScript + Vite + React** and the **Firebase AI Logic Web SDK (`firebase/ai` v13+)** for **#BuildHybridAI 2026**.

## Firebase AI Logic SDK (v13+)

- Always import from `firebase/ai`.
- Use `GoogleAIBackend`, `InferenceMode.ONLY_ON_DEVICE`, `InferenceMode.PREFER_ON_DEVICE`, and `InferenceMode.ONLY_IN_CLOUD`.
- **Never** import the deprecated `@firebase/vertexai` package or any of its APIs.

## Chrome MV3 Execution Boundary

- All Firebase SDKs (`firebase/app`, `firebase/ai`, `firebase/app-check`, `firebase/auth`, `firebase/remote-config`, `firebase/firestore`) **MUST** run strictly inside the Chrome Side Panel page context (`src/sidepanel/`).
- **Never** initialize Firebase in `background.ts` or in content scripts.

## Zero-Friction MV3 Auth & App Check

- Use `signInAnonymously(auth)` on Side Panel initialization.
- **Never** use `signInWithPopup` or `signInWithRedirect` — they fail on `chrome-extension://` domains.
- Set `self.FIREBASE_APPCHECK_DEBUG_TOKEN` **before** calling `initializeAppCheck`.

## Lightweight Deterministic Engine

- Use `acorn` (~200 KB) plus regex / Shannon entropy in pure TypeScript for JS/TS AST identifier extraction.
- **Never** install heavy `@babel/parser` or WASM tree-sitter packages.
- **Never** let an LLM rewrite raw source code directly.

## Low-RAM Build Guardrail

- Prefix build/dev scripts in `package.json` with `NODE_OPTIONS="--max-old-space-size=2048"` so Vite and TypeScript stay lightweight.

## Security

- **Never** commit `.env.local` or `key.pem`.
- `extension_public_key.txt` is a local helper reference and is also gitignored — do not commit it.
