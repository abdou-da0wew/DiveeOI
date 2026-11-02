// The browser must be able to load the SPA shell before it can render the
// in-app login page. API routes are registered ahead of this catch-all UI
// router, and keep their own authorization middleware.
export const PUBLIC_UI_ROUTES = new Set<string>(["/", "/login", "/register"])

// Static files requested by index.html without app-managed credentials.
export const PUBLIC_UI_PATHS = new Set<string>([
  "/site.webmanifest",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
  "/apple-touch-icon.png",
  "/apple-touch-icon-v3.png",
  "/favicon.svg",
  "/favicon-v3.svg",
  "/favicon.ico",
  "/favicon-v3.ico",
  "/favicon-96x96.png",
  "/favicon-96x96-v3.png",
  "/social-share.png",
  "/social-share-zen.png",
  "/oc-theme-preload.js",
  "/_opencode/themes",
])

function isSafeAssetPath(pathname: string) {
  if (!pathname.startsWith("/assets/") || pathname.includes("\\\\")) return false
  try {
    const decoded = decodeURIComponent(pathname)
    return !decoded.split("/").some((part) => part === "." || part === "..")
  } catch {
    return false
  }
}

export function isPublicUIPath(method: string, pathname: string) {
  if (method !== "GET" && method !== "HEAD") return false
  return (
    PUBLIC_UI_ROUTES.has(pathname) ||
    PUBLIC_UI_PATHS.has(pathname) ||
    isSafeAssetPath(pathname)
  )
}
