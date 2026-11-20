import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "./session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

const profile = {
  id: "profile-local-ssh",
  name: "Local SSH test",
  host: "127.0.0.1",
  port: 22,
  user: "test-user",
  workingDirectory: "~",
  authMethod: "agent" as const,
  createdAt: 1,
  updatedAt: 1,
}

test("a session can attach to a saved SSH profile", async ({ page }) => {
  let sessionUpdate: Record<string, unknown> | undefined

  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    const sessionMatch = url.pathname.match(/^\/api\/session\/([^/]+)$/)
    if (sessionMatch && route.request().method() === "GET") {
      const session = fixture.sessions.find((item) => item.id === sessionMatch[1])
      return route.fulfill({
        status: session ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(session ?? { error: "Session not found" }),
      })
    }

    if (
      ["/prefs/global", "/prefs/local", "/api/prefs/global", "/api/prefs/local", "/api/auth/refresh"].includes(
        url.pathname,
      )
    ) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
    }
    if (["/_opencode/themes", "/file", "/api/file", "/pty/shells"].includes(url.pathname)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
    }
    if (url.pathname === "/targeted-learning/health" || url.pathname === "/api/targeted-learning/health") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    }
    return route.fallback()
  })

  await page.route("**/api/v1/remote/**", async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname.endsWith("/profiles") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, profiles: [profile] }),
      })
    }
    if (/\/profiles\/[^/]+\/probe$/.test(url.pathname) && method === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          platform: "linux",
          homeDirectory: "/home/test-user",
        }),
      })
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unexpected remote API request", path: url.pathname, method }),
    })
  })

  await page.route("**/api/session/**", async (route) => {
    if (route.request().method() === "PATCH") {
      sessionUpdate = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    }
    return route.fallback()
  })

  await page.addInitScript((directory) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)

  await page.goto("/")
  const projectRow = page
    .locator('[data-component="home-project-row"]')
    .filter({ hasText: fixture.project.name })
    .first()
  await expect(projectRow).toBeVisible({ timeout: 30_000 })
  await projectRow.click()
  await expect(projectRow).toHaveAttribute("data-selected", "", { timeout: 30_000 })
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole("button", { name: new RegExp(fixture.expected.targetTitle) }).click()
  await expect(page.getByRole("heading", { name: fixture.expected.targetTitle })).toBeVisible({
    timeout: 30_000,
  })

  await page.getByRole("button", { name: "Toggle remote SSH session" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Remote SSH session")).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Connect", exact: true })).toBeDisabled()
  await dialog.locator('[data-component="select-v2"]').click()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await dialog.getByPlaceholder("~ or /home/user/project").fill("/srv/worktree")
  await dialog.getByRole("button", { name: "Test connection" }).click()
  await expect(dialog.getByRole("status")).toContainText("Connected · linux · /home/test-user")
  await dialog.getByRole("button", { name: "Connect", exact: true }).click()

  await expect(dialog).toBeHidden()
  expect(sessionUpdate).toEqual({
    metadata: {
      remote: {
        profileId: profile.id,
        workingDirectory: "/srv/worktree",
      },
    },
  })
})
