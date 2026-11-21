/**
 * DiveeOI framework e2e smoke spec (live server required).
 *
 * The runner only invokes Playwright when BASE_URL answered within 3s, so by
 * the time these tests execute a real app instance is listening. Checks:
 *   1. the app root loads and renders the Solid mount point,
 *   2. the login form renders (username/password + "Sign in"),
 *   3. no unexpected console errors / uncaught page errors on load.
 *
 * Import note: resolved from the workspace's existing @playwright/test
 * devDependency (packages/app) — no new dependency is added here.
 */
import { expect, test, type Page } from "../../../packages/app/node_modules/@playwright/test"

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000"

/**
 * Chromium logs one console "error" per non-2xx network response
 * ("Failed to load resource …"). While logged out the app legitimately gets
 * 401s on bootstrap endpoints (see docs/testing/2026-11-09-ui-test Bug 8), so
 * those transport-level lines are filtered; real application errors still fail
 * the test.
 */
const NETWORK_NOISE = /^Failed to load resource/

function collectErrors(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error" && !NETWORK_NOISE.test(msg.text())) consoleErrors.push(msg.text())
  })
  page.on("pageerror", (err) => pageErrors.push(String(err)))
  return { consoleErrors, pageErrors }
}

test.describe("DiveeOI app smoke (live server)", () => {
  test("app root loads and renders", async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page)
    const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 20_000 })
    expect(response, "BASE_URL responds with an HTTP response").not.toBeNull()
    expect(response!.status(), "root URL answers with HTTP < 500").toBeLessThan(500)

    // index.html mounts the Solid app into #root; it must exist and gain content
    const root = page.locator("#root")
    await expect(root).toBeVisible()
    await expect
      .poll(async () => (await root.innerHTML()).trim().length, {
        message: "app shell should render content into #root",
        timeout: 15_000,
      })
      .toBeGreaterThan(0)

    expect(consoleErrors, `console errors on load: ${consoleErrors.join(" | ")}`).toEqual([])
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(" | ")}`).toEqual([])
  })

  test("login form renders with username, password and submit", async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page)
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 20_000 })

    // AuthPanel title (packages/app/src/pages/login.tsx)
    await expect(page.getByText("Welcome back")).toBeVisible({ timeout: 15_000 })
    // local dev pre-fills the Basic-auth username "DIVEEOI"
    await expect(page.locator('input[name="username"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible()

    expect(consoleErrors, `console errors on login load: ${consoleErrors.join(" | ")}`).toEqual([])
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(" | ")}`).toEqual([])
  })

  test("client-side routing serves the login route without a hard failure", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 20_000 })
    // visiting a deep link must not produce an HTTP 5xx from the dev server
    const response = await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 20_000 })
    expect(response!.status(), "login route answers with HTTP < 500").toBeLessThan(500)
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 15_000 })
  })
})
