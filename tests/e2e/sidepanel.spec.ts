import { expect, test } from "./fixtures.js";
import { STRIPE_LEAK_KEY } from "../../src/engine/samples.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

test("built manifest is MV3-valid: no remote script sources in the CSP (regression)", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const manifest = JSON.parse(readFileSync(resolve(root, "dist/manifest.json"), "utf8"));
  const csp: string = manifest.content_security_policy.extension_pages;
  expect(csp).toContain("script-src 'self'");
  // MV3 rejects remote script sources outright, which prevents the whole
  // extension from loading (ERR_BLOCKED_BY_CLIENT).
  expect(csp).not.toMatch(/script-src[^;]*https:\/\//);
});

test("workbench renders all three glassbox panes and a preflight card", async ({ panel }) => {
  await expect(panel.getByText("RAW LOCAL INPUT")).toBeVisible();
  await expect(panel.getByText("SANITIZED CLOUD PACKET")).toBeVisible();
  await expect(panel.getByText("RE-HYDRATED OUTPUT")).toBeVisible();
  await expect(panel.getByText(/NANO 4 ·/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Stripe API key leak" })).toBeVisible();
});

test("one-click Stripe sample produces a leak-verified sanitized packet", async ({ panel }) => {
  await panel.getByRole("button", { name: "Stripe API key leak" }).click();
  await expect(panel.getByText("✓ 0 BYTES RAW PII")).toBeVisible({ timeout: 20_000 });
  const packet = panel.locator(".packet-view");
  await expect(packet).toBeVisible();
  const text = await packet.innerText();
  expect(text).not.toContain(STRIPE_LEAK_KEY);
  expect(text).toMatch(/(fn|str|ident)_\d+/);
});

test("no request body ever contains a raw fixture secret", async ({ panel }) => {
  const violations: string[] = [];
  panel.on("request", (request) => {
    const body = request.postData() ?? "";
    if (body.includes(STRIPE_LEAK_KEY)) {
      violations.push(request.url());
    }
  });
  await panel.getByRole("button", { name: "Stripe API key leak" }).click();
  await expect(panel.getByText("✓ 0 BYTES RAW PII")).toBeVisible({ timeout: 20_000 });
  await panel.waitForTimeout(1500);
  expect(violations).toEqual([]); // network-level INV-1 proof
});

test("context-menu capture handoff is drained from chrome.storage.session", async ({ panel }) => {
  await panel.evaluate(async () => {
    await chrome.storage.session.set({
      pendingCapture: { version: 1, text: "const key = 'sk_live_ABCDEFGHIJKLMNOPQRST';", source: "context-menu", ts: Date.now() },
    });
  });
  await expect(panel.locator(".raw-pane .code-view")).toContainText("sk_live_ABCDEFGHIJKLMNOPQRST", { timeout: 20_000 });
});
