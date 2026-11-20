# Remote SSH Sessions

Remote Sessions let a DiveeOI session run its shell and filesystem tools on a machine reached over SSH. The SSH client runs in the **DiveeOI server process**, not in the browser. SSH profiles, private keys, agent sockets, and known_hosts are therefore resolved from the account and environment that run the server.

## Manage hosts

Open **Settings → Remote Sessions** to inspect discovered SSH hosts, save or edit a profile, test its connection, generate an Ed25519 key pair, and disconnect sessions that are currently attached to a host.

Discovery reads the server account's OpenSSH config (including bounded Include trees), known_hosts, key directory, and loaded SSH_AUTH_SOCK identities. Discovery is informational: a discovered identity or host does not bypass host-key verification.

A profile stores the host, port, username, remote working directory, and authentication method:

- **SSH agent** uses the server process's SSH_AUTH_SOCK.
- **Private key** reads a key file on the server. Encrypted-key passphrases are stored as encrypted profile secrets.
- **Password** is stored as an encrypted profile secret.

The browser receives profile metadata only. Passwords and private-key passphrases are not returned by the profile-list API.

## Trust and storage

SSH host keys are verified strictly against the server account's OpenSSH known_hosts file. This includes hashed host entries, non-default ports, wildcard exclusions, and revoked-key entries. Unknown or changed host keys fail closed. Before connecting to a new host, verify its host-key fingerprint through a trusted channel, then add the accepted key to the server account's known_hosts; do not blindly trust an unverified ssh-keyscan result.

By default, the remote profile file and encryption key are stored under:

- ~/.config/diveeoi/remote-profiles.json
- ~/.config/diveeoi/remote-profiles.key

The server creates owner-only files and an owner-only configuration directory. Passwords and key passphrases use AES-256-GCM with a separate 32-byte key. Back up the profile file and encryption key together. Losing the key makes stored secrets unrecoverable. Keep both files outside source control and restrict access to the server account.

SSH key pairs generated from Settings are written under the server account's SSH key directory with private-key permissions set to 0600. The public key is shown so it can be installed in the remote account's authorized_keys.

## Attach a session

Use the server/cloud icon in a session header, choose a saved profile, set the remote working directory, and test the connection. Connecting stores the profile ID and selected working directory in that session's metadata. Subsequent shell, file, search, and project operations resolve against that remote context. Disconnecting clears the remote reference and returns the session to its local context.

Remote connection cache identity includes the selected profile version and authentication identity. Editing credentials therefore does not silently reuse a previous connection. Separate sessions retain separate working directories.

## Configuration

All paths are resolved by the DiveeOI server process. Set these variables when the defaults are not appropriate:

| Variable | Purpose |
|---|---|
| DIVEEOI_SSH_KEY_DIR | SSH key directory; defaults to ~/.ssh |
| DIVEEOI_SSH_CONFIG_FILE | OpenSSH config path; defaults to ~/.ssh/config |
| DIVEEOI_SSH_KNOWN_HOSTS_FILE | Trusted host-key database; defaults to ~/.ssh/known_hosts |
| DIVEEOI_REMOTE_CONFIG_DIR | Remote profile state directory; defaults to ~/.config/diveeoi |
| DIVEEOI_REMOTE_PROFILES_FILE | Encrypted profile store path |
| DIVEEOI_REMOTE_SECRET_KEY_FILE | AES-256-GCM key file path |
| DIVEEOI_REMOTE_SECRET_KEY | Optional explicit 32-byte key, as 64 hex characters or base64 |
| SSH_AUTH_SOCK | SSH agent socket inherited by the server process |

See .env.example for commented examples.

## Current implementation boundaries

Remote file reads/writes, recursive parent creation, stat/list, copy, chmod, rename, file/directory removal, glob, findUp, up, groupUp, and globUp use SFTP. Shell and grep-style search use the remote SSH command channel. Remote SFTP open, stream, hard-link creation, and scoped temporary-directory helpers are not implemented; use the remote shell tool for workflows that require those lower-level operations. OpenSSH ProxyJump metadata may be discovered, but the current connector does not tunnel through jump hosts.

## Verification

The server includes a local SSH smoke script at packages/server/script/remote-ssh-smoke.ts that checks SSH-agent authentication, shell execution, path quoting, recursive SFTP writes, read/edit/rename, glob/upward discovery, and independent session working directories. It requires a trusted host-key entry for the target. Focused SFTP and host-key tests live beside the adapter under packages/server/src/ssh-client/.

The app includes Playwright regressions for Settings profile management and session attachment under packages/app/e2e/smoke/.
