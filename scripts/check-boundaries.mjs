/**
 * Lightweight import-boundary enforcement (no dependency-cruiser needed).
 * Enforces the AGENTS.md execution boundary and the lightweight-engine rule:
 *  - src/engine/**       : no firebase/*, no chrome.*, no React
 *  - src/extension/**    : no firebase/*, no services/*, no React
 *  - src/services/**     : no chrome.*, no React
 *  - src/sidepanel/**    : sole Firebase initializer (no other dir may import firebase/ai init)
 *  - whole repo          : no @firebase/vertexai, no @babel/parser, no tree-sitter WASM
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(root, "src");
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(full)) check(full);
  }
}

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function check(file) {
  const rel = relative(root, file).split(sep).join("/");
  const rawContent = readFileSync(file, "utf8");
  // Documentation comments legitimately mention banned APIs (e.g. "never use
  // signInWithPopup"); lint actual code only.
  const content = stripComments(rawContent);
  const imports = [...content.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g)].map((m) => m[1]);

  const forbidden = [];
  if (rel.startsWith("src/engine/")) {
    forbidden.push(...imports.filter((i) => /^firebase\//.test(i) || i === "react" || i === "react-dom"));
    if (/\bchrome\./.test(content)) forbidden.push("chrome.* usage");
  }
  if (rel.startsWith("src/extension/")) {
    forbidden.push(...imports.filter((i) => /^firebase\//.test(i) || i.includes("services/") || i === "react"));
  }
  if (rel.startsWith("src/services/")) {
    forbidden.push(...imports.filter((i) => i === "react" || i === "react-dom"));
    if (/\bchrome\./.test(content)) forbidden.push("chrome.* usage");
  }
  if (/@firebase\/vertexai/.test(content)) forbidden.push("@firebase/vertexai (deprecated — banned)");
  if (/signInWithPopup|signInWithRedirect/.test(content)) forbidden.push("popup/redirect auth (banned on chrome-extension://)");

  if (forbidden.length > 0) {
    violations.push(`${rel}: ${[...new Set(forbidden)].join(", ")}`);
  }
}

walk(sourceRoot);

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const dep of ["@babel/parser", "tree-sitter", "web-tree-sitter"]) {
  if (pkg.dependencies?.[dep] || pkg.devDependencies?.[dep]) {
    violations.push(`package.json: forbidden heavy dependency ${dep}`);
  }
}

if (violations.length > 0) {
  console.error("[CloakProxy] import-boundary violations:\n" + violations.map((v) => `  ✕ ${v}`).join("\n"));
  process.exit(1);
}
console.log("[CloakProxy] import boundaries OK — Firebase confined to src/sidepanel/ consumers.");
