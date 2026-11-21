/**
 * DiveeOI framework e2e — Playwright config (no new dependencies).
 *
 * The runner (tests/framework/runner.ts) probes the live app first and skips
 * the whole suite when nothing answers at BASE_URL within 3s, so this config
 * deliberately does NOT define a webServer: it expects the app to already be
 * running (start it with `bun run dev:both`, or point BASE_URL at any
 * already-deployed instance).
 *
 * Environment variables:
 *   BASE_URL        app base URL (default http://127.0.0.1:3000 — the Vite dev
 *                   port from packages/app/vite.config.ts; the backend API is
 *                   proxied same-origin to the DiveeOI server on :4097)
 *   E2E_WORKERS     number of parallel workers (default 1)
 *   CI              enables forbidOnly + 2 retries
 *
 * Import note: @playwright/test is resolved from the workspace's existing
 * devDependency in packages/app (catalog version 1.59.1) — the framework adds
 * no new dependency. If you move this directory, adjust the relative import.
 */
import { defineConfig, devices } from "../../../packages/app/node_modules/@playwright/test"

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000"
const here = __dirname // resolved by Playwright's config loader (CJS transpile)

export default defineConfig({
  testDir: here,
  // keep generated artifacts inside tests/framework/e2e/ (framework-owned paths)
  outputDir: `${here}/.test-results`,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS ?? 1),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["line"], ["html", { outputFolder: `${here}/.playwright-report`, open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    viewport: { width: 1440, height: 900 },
    // tolerate the self-signed/localhost setups used by self-hosted instances
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
