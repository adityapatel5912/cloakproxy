/**
 * Build orchestrator (Low-RAM guardrail wrapper supplies NODE_OPTIONS).
 * Order: icons → boundary lint → typecheck → Side Panel build → SW build →
 * manifest key injection (also done by the Vite plugin for watch mode).
 */
import { spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const watch = process.argv.includes("--watch");
const nodeBin = process.execPath;

function run(args, label) {
  const r = spawnSync(nodeBin, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`[CloakProxy] ${label} failed with status ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

if (!existsSync(resolve(root, "public/icons/icon128.png"))) {
  run([resolve(root, "scripts/make-icons.mjs")], "icon generation");
}
run([resolve(root, "scripts/check-boundaries.mjs")], "import-boundary check");
run([resolve(root, "node_modules/typescript/bin/tsc"), "--noEmit"], "typecheck");

if (watch) {
  // Dev mode: keep both Vite watchers alive; production build is fully linear.
  const children = [
    spawn(nodeBin, [resolve(root, "node_modules/vite/bin/vite.js"), "build", "--watch"], { cwd: root, stdio: "inherit" }),
    spawn(nodeBin, [resolve(root, "node_modules/vite/bin/vite.js"), "build", "-c", "vite.background.config.ts", "--watch"], { cwd: root, stdio: "inherit" }),
  ];
  const shutdown = () => children.forEach((c) => c.kill("SIGINT"));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else {
  run([resolve(root, "node_modules/vite/bin/vite.js"), "build"], "Side Panel build");
  run([resolve(root, "node_modules/vite/bin/vite.js"), "build", "-c", "vite.background.config.ts"], "service worker build");

  // Belt-and-braces key injection (the Vite plugin already wrote dist/manifest.json).
  const template = readFileSync(resolve(root, "public/manifest.template.json"), "utf8");
  let key;
  try {
    key = readFileSync(resolve(root, "extension_public_key.txt"), "utf8").trim();
  } catch {
    key = undefined;
  }
  const manifest = key
    ? template.replace("__EXTENSION_PUBLIC_KEY__", key)
    : template.replace(/"key"\s*:\s*"__EXTENSION_PUBLIC_KEY__"\s*,?\s*/, "");
  writeFileSync(resolve(root, "dist/manifest.json"), manifest);
  rmSync(resolve(root, "dist/manifest.template.json"), { force: true });
  console.log("[CloakProxy] build complete → dist/ (load unpacked in chrome://extensions)");
}
