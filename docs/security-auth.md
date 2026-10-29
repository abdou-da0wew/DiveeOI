# Authentication and Security

This guide describes the authentication behavior currently implemented by DiveeOI. For the chronological implementation record, see `WORKLOG.md`.

## Server authentication modes

`DIVEEOI_AUTH_MODE` controls API authentication:

| Value | Behavior |
|---|---|
| `both` (default) | Accept either configured Basic credentials or a valid account JWT. |
| `basic` | Require configured Basic credentials. |
| `jwt` | Require an account JWT; Basic credentials are not accepted. |
| `disabled` | Disable the authorization middleware. Use only for a deliberately isolated local instance. |

Authentication is required unless mode is explicitly `disabled`. In `both` mode, a production server with no Basic password still requires JWT account authentication.

### Basic credentials

- `DIVEEOI_SERVER_USERNAME` defaults to **`DIVEEOI`**.
- Set `DIVEEOI_SERVER_PASSWORD` to configure Basic authentication.
- When no password is configured, non-production/non-test processes use the development default **`divee`**. Production has no default Basic password.
- `DIVEEOI_SERVER_USERNAME` and `DIVEEOI_SERVER_PASSWORD` take precedence over the legacy `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD` fallbacks.
- The browser's themed sign-in form tests these credentials against the selected server. Credentials entered there remain in memory and are not saved by that login flow or embedded in the frontend bundle. The server does not issue `WWW-Authenticate: Basic`, so browsers do not show their native login dialog.

Basic credentials are only Base64-encoded in the HTTP `Authorization` header; Base64 is not encryption. Use HTTPS for any connection that crosses an untrusted network. Do not reuse the development password on a reachable server.

### JWT signing key

Account access and refresh tokens are signed with `DIVEEOI_JWT_SECRET`. Configure a stable, randomly generated value with at least 32 characters in production, and keep it outside source control. If omitted, DiveeOI generates a random signing key in its persistent data directory (`DIVEEOI_DATA_DIR`, or `<working-directory>/data`) and creates the key file with owner-only permissions on supported platforms. Losing that file invalidates existing tokens; configure a stable environment secret or persist and back up the data directory.

The signer uses distinct issuer/audience and `token_use` claims for access and refresh tokens. Access tokens expire after 15 minutes. Refresh tokens expire after 7 days, are stored as server-side session records, and rotate when used. Logout revokes the relevant refresh session(s); changing an account password or email revokes all of that account's refresh sessions.

In the browser, access tokens are held in memory only. Refresh tokens are delivered through an HttpOnly, SameSite=Lax cookie scoped to `/api/auth`; JavaScript cannot read the cookie. Browser requests identified by `Origin` or Fetch Metadata do not receive a refresh token in JSON. Headerless non-browser clients retain the legacy body-token flow; they receive a refresh token at login and can rotate it by sending `refreshToken` in the refresh request body. The app's API helper only injects the account Bearer token into requests to the app's own origin, avoiding accidental forwarding to arbitrary remote server connections.

## Accounts and registration

The first registered account is an administrator. A conditional database insert makes the first-admin claim atomic, so concurrent first registrations cannot both receive the admin role. Public registration closes after that account is created unless `DIVEEOI_AUTH_ALLOW_REGISTRATION=1` (also accepts `true` or `yes`); subsequent registrations receive the regular user role. Because the initial registration endpoint is unauthenticated, create the first account before exposing an uninitialized instance to an untrusted network, or restrict `/api/auth/register` at the reverse proxy during bootstrap. Registration is intended for account login, not as a replacement for configuring Basic credentials on a shared-password server.

Passwords must be at least 12 characters and no more than 72 UTF-8 bytes. Email delivery is not configured in this deployment, so registration does not claim to send a verification email.

## Browser and development proxy

The app uses its styled `/login` and `/register` pages. Basic sign-in accepts a server username/password; when Basic authentication is rejected, the same form attempts JWT account sign-in. This avoids browser-native Basic-auth dialogs.

During web development, Vite proxies recognized API and WebSocket paths to the backend. Configure the proxy target with:

- `VITE_DIVEEOI_SERVER_URL`, or
- `VITE_DIVEEOI_SERVER_HOST` and `VITE_DIVEEOI_SERVER_PORT` (defaults: `127.0.0.1:4097`).

The browser uses the app origin and does not call `localhost` to reach the backend. Same-origin proxying avoids requiring broad development CORS exceptions. For a separately hosted frontend, configure `CORS` with only trusted origins and ensure the backend is reachable over HTTPS.

## Production checklist

1. Set `DIVEEOI_AUTH_MODE=both` or `jwt`; do not set `disabled` on a network-facing instance.
2. Set a strong, unique `DIVEEOI_SERVER_PASSWORD` if Basic auth is required. Never rely on `divee` outside local development.
3. Set and persist a stable `DIVEEOI_JWT_SECRET` of at least 32 characters, or persist the data directory containing the generated key.
4. Serve the app and API over HTTPS. Basic auth is not safe over plain HTTP on an untrusted network.
5. Leave public registration disabled unless it is intentionally required.
6. Keep `CORS` restricted to the actual frontend origins; do not use permissive wildcard CORS with credentials.
7. Do not put secrets in `.env.example`, built frontend variables, URLs, screenshots, logs, or version control. If a credential was previously shared outside a secure channel, rotate it.

See `.env.example` for the environment-variable template.
