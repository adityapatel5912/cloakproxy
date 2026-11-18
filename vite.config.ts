import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Copies public/manifest.template.json -> dist/manifest.json and injects the
 * base64 public key from the gitignored extension_public_key.txt.
 * The key pins the extension ID across unpacked reloads (blueprint §4.1).
 */
function manifestKeyPlugin(): Plugin {
  return {
    name: "cloakproxy-manifest-key",
    apply: "build",
    closeBundle() {
      const root = process.cwd();
      const templatePath = resolve(root, "public/manifest.template.json");
      const keyPath = resolve(root, "extension_public_key.txt");
      const template = readFileSync(templatePath, "utf8");
      let key: string | undefined;
      try {
        key = readFileSync(keyPath, "utf8").trim();
      } catch {
        console.warn("[CloakProxy] extension_public_key.txt missing — building without pinned ID.");
      }
      const manifest = key
        ? template.replace("__EXTENSION_PUBLIC_KEY__", key)
        : template.replace(/"key"\s*:\s*"__EXTENSION_PUBLIC_KEY__"\s*,?\s*/, "");
      writeFileSync(resolve(root, "dist/manifest.json"), manifest);
      rmSync(resolve(root, "dist/manifest.template.json"), { force: true });

      // Vite keeps the source folder structure for nested HTML entries.
      // The manifest expects dist/sidepanel.html; emitted asset URLs are
      // root-absolute (/assets/...), so relocating the HTML is safe.
      const nestedHtml = resolve(root, "dist/src/sidepanel/index.html");
      if (existsSync(nestedHtml)) {
        writeFileSync(resolve(root, "dist/sidepanel.html"), readFileSync(nestedHtml));
        rmSync(resolve(root, "dist/src"), { recursive: true, force: true });
      }
    },
  };
}

/**
 * Side Panel build pass (1 of 2).
 * Entry: src/sidepanel/index.html -> dist/sidepanel.html + dist/assets/*
 * The MV3 service worker is built by vite.background.config.ts so it stays a
 * single chunk-free ES module (no dynamic import graph after SW idle-recycling).
 */
export default defineConfig({
  plugins: [react(), manifestKeyPlugin()],
  build: {
    outDir: "dist",
    target: "chrome138",
    sourcemap: false,
    rollupOptions: {
      input: { sidepanel: "src/sidepanel/index.html" },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/chunk-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
