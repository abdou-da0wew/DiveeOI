/**
 * Browser fetches carry Origin and/or Fetch Metadata headers. Headerless
 * clients retain the legacy refresh-token body flow while browser refresh
 * tokens remain confined to an HttpOnly cookie.
 */
export const isBrowserRequest = (headers: Record<string, string | undefined>) =>
  headers.origin !== undefined ||
  headers["sec-fetch-site"] !== undefined ||
  headers["sec-fetch-mode"] !== undefined
