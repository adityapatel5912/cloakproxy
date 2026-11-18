import { defineConfig } from "vite";

/**
 * Background service worker build pass (2 of 2).
 * Emits ONE self-contained ES module: dist/background.js
 * - inlineDynamicImports guarantees no chunk graph (MV3 SW must be a single file
 *   or use static imports only; chunks risk load failures after SW idle-recycling).
 * - emptyOutDir:false so it does not wipe the Side Panel pass output.
 * No React, no Firebase, no HTML — this file must stay tiny and stateless.
 */
export default defineConfig({
  build: {
    outDir: "dist",
    target: "chrome138",
    sourcemap: false,
    rollupOptions: {
      input: { background: "src/extension/background.ts" },
      output: {
        format: "es",
        entryFileNames: "[name].js",
        inlineDynamicImports: true,
      },
    },
    emptyOutDir: false,
  },
});
