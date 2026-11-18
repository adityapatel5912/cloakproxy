import { chromium, test as base, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const dist = resolve(root, "dist");

/**
 * The extension ID is deterministic when manifest.key is pinned:
 * ID = first 32 hex chars of SHA-256(DER public key), each nibble mapped a–p.
 */
export function extensionId(): string {
  const der = readFileSync(resolve(root, "extension_public_key.txt"), "utf8").trim();
  const hash = createHash("sha256").update(Buffer.from(der, "base64")).digest("hex").slice(0, 32);
  return [...hash].map((c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16))).join("");
}

export const test = base.extend<{ panel: Page }>({
  panel: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      // Full Chromium (not chrome-headless-shell) — headless shell cannot load MV3 extensions.
      headless: true,
      channel: "chromium",
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${dist}`,
        `--load-extension=${dist}`,
        "--disable-features=OptimizationGuideModelDownloading", // keep CI light
      ],
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId()}/sidepanel.html`);
    await use(page);
    await context.close();
  },
});

export { expect } from "@playwright/test";
