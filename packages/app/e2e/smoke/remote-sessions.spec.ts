import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "./session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

type SavedProfile = {
  id: string
  name: string
  host: string
  port: number
  user: string
  workingDirectory: string
  authMethod: "agent" | "privateKey" | "password"
  createdAt: number
  updatedAt: number
}

test("remote sessions settings profile management", async ({ page }) => {
  let profiles: SavedProfile[] = []

  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === `/project/${fixture.project.id}`) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.project) })
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
    const sessionGet = url.pathname.match(/^\/api\/session\/([^/]+)$/)
    if (sessionGet && route.request().method() === "GET") {
      const session = fixture.sessions.find((item) => item.id === sessionGet[1])
      return route.fulfill({
        status: session ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(session ?? { error: "Session not found" }),
      })
    }
    if (url.pathname === "/targeted-learning/health" || url.pathname === "/api/targeted-learning/health") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    }
    return route.fallback()
  })

  await page.route("**/api/v1/remote/**", async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const path = url.pathname

    if (path.endsWith("/discovery") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          hosts: [
            {
              id: "local-test",
              name: "Local SSH",
              host: "127.0.0.1",
              port: 22,
              user: "test-user",
              sources: ["ssh_config"],
            },
          ],
          identities: [],
          sources: {
            sshConfig: "/home/test/.ssh/config",
            knownHosts: "/home/test/.ssh/known_hosts",
            keyDirectory: "/home/test/.ssh",
            agentAvailable: true,
          },
        }),
      })
    }

    if (path.endsWith("/profiles") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, profiles }),
      })
    }

    if (path.endsWith("/keys") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, keys: [] }),
      })
    }

    if (path.endsWith("/profiles") && method === "POST") {
      const body = route.request().postDataJSON()
      const now = Date.now()
      const profile: SavedProfile = {
        id: "profile-local-ssh",
        name: String(body.name),
        host: String(body.host),
        port: Number(body.port),
        user: String(body.user),
        workingDirectory: String(body.workingDirectory),
        authMethod: body.authMethod,
        createdAt: now,
        updatedAt: now,
      }
      profiles = [profile]
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, profile }),
      })
    }

    const probe = path.match(/\/profiles\/([^/]+)\/probe$/)
    if (probe && method === "POST") {
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
      body: JSON.stringify({ error: "Unexpected remote API request", path, method }),
    })
  })

  await page.addInitScript((directory) => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, editToolPartsExpanded: true } }),
    )
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
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("tab", { name: "Remote Sessions" }).click()
  await expect(page.getByRole("heading", { name: "Remote Sessions", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "SSH host discovery" })).toBeVisible()
  await expect(page.getByText("Local SSH", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Add host" }).click()
  await expect(page.getByRole("heading", { name: "New SSH profile" })).toBeVisible()
  await page.getByLabel("Profile name").fill("Local SSH test")
  await page.getByLabel("Host / address").fill("127.0.0.1")
  await page.getByLabel("Username").fill("test-user")
  await page.getByLabel("Port").fill("22")
  await page.getByRole("button", { name: "Save profile" }).click()

  await expect(page.getByText("Local SSH test", { exact: true })).toBeVisible()
  expect(profiles).toHaveLength(1)
  expect(profiles[0]?.authMethod).toBe("agent")

  await page.getByRole("button", { name: "Test", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("Local SSH test connected")
})
