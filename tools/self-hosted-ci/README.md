# DiveeOI self-hosted CI runner

`diveeoi-ci` is an early, standalone Go runner intended for a Linux machine or VPS you control. It polls configured Git remotes for selected branch/tag refs, checks out changed commits, reads a repository-owned YAML pipeline, and runs shell steps in resource-limited Docker containers. It does not expose an inbound webhook or HTTP server.

The runner is deliberately conservative about trust, but this is not a guarantee of issue-free operation or a sandbox against a hostile Docker administrator. Treat pipeline code on a trusted ref as code running with access to the runner's Docker daemon and declared secrets.

## Current scope

- Multiple HTTPS, SSH, `git://`, or scp-style Git remotes; branch and tag allowlists use `*`, `**`, and `?` patterns.
- Polling triggers, one-off manual runs, durable run state and bounded logs.
- YAML pipelines with ordered jobs, dependencies (`needs`), images, timeouts, per-job environment, encrypted secrets, and explicit retained artifacts.
- Docker execution on Linux with read-only container root filesystems, dropped capabilities, `no-new-privileges`, PID/CPU/memory limits, temporary filesystems, a per-run workspace, and runner-owned container cleanup.
- AES-GCM encrypted, per-repository secrets; ref trust rules; stream log redaction; ref patterns for deciding which branches/tags may receive secrets.
- Local CLI commands for config checks, workflow validation, run status/logs, artifacts, and secret management.

This is not a GitHub Actions-compatible runner: there are no `uses:` actions, matrix builds, hosted web UI, webhook receiver, cache service, cross-repository permissions, deployment approvals, automatic GitHub App token minting, or artifact download server. Pipeline steps are shell commands in Docker images that contain `/bin/sh`. Jobs run sequentially in one checkout workspace, so later jobs can use files produced earlier; explicitly declared artifacts are copied to private storage after their job succeeds. Wildcard artifact patterns are not supported.

## Requirements

- Linux host (the runner refuses to start on other operating systems and refuses to run as UID 0).
- Go 1.22 or newer to build/test the runner.
- Git and Docker Engine accessible to the dedicated runner account. A **rootless Docker daemon is strongly recommended**. Membership in the rootful `docker` group is effectively root-level access to the host.
- Persistent storage with restrictive ownership/permissions and enough space for run logs, workspaces, encrypted secrets, and declared artifacts.
- Network access from the VPS to the configured Git remotes and to the image registry used by jobs.

The runner does not install Docker or configure the host firewall. Use a maintained Linux distribution and keep the OS, Docker Engine, Go toolchain, and job images patched.

## Build and test

From this directory:

```sh
go test ./...
mkdir -p bin
go build -trimpath -o ./bin/diveeoi-ci ./cmd/diveeoi-ci
./bin/diveeoi-ci version
```

`make test`, `make build`, and `make fmt` are also available. Building downloads the single YAML dependency declared in `go.mod`.

## Configure repositories and refs

Start from `examples/config.json`. The current example watches the public DiveeOI repository's `dev` branch and `v*` tags and expects `.diveeoi/pipeline.yml` at the checked-out commit. Adjust it for your own repositories and refs before starting the service.

Important configuration fields:

- `storageDir`: private persistent runner state; keep it outside a checkout.
- `pollIntervalSeconds`: 10–3600 (default 60). This is polling, not a webhook, so trigger latency can be up to one poll interval.
- `maxConcurrentRuns`: 1–16 (default 1). CPU/memory limits still apply to each container; set concurrency according to the VPS capacity.
- `branches` and `tags`: which refs are observed. An initial observation establishes a baseline by default; set `runOnStart` to run already-existing refs when the daemon first sees them.
- `trustedBranches` and `trustedTags`: the only refs whose pipelines may request secrets. Keep these patterns narrow and protect the corresponding branches/tags in your Git host.
- `allowedSecrets`: upper-case names that the workflow is allowed to request. A value must also be stored in the encrypted runner vault.
- `docker.rootless`: must match the connected daemon's actual rootless mode. The `check` command verifies the match.
- `maxArtifactBytesPerRun` and `artifactRetentionDays`: artifact size ceiling (1 byte–20 GiB; default 1 GiB) and cleanup age (1–365 days; default 14).

Pattern rules: `*` matches within one ref path segment, `**` may span `/`, and `?` matches one non-`/` character. Configure `branches` and `tags` separately; the runner does not watch pull-request refs or arbitrary refs.

A repository entry can use HTTPS or SSH. Do not put credentials into a remote URL. For a private HTTPS remote, configure a username and the *name* of a host environment variable containing the token:

```json
"gitCredentials": {
  "username": "x-access-token",
  "tokenEnv": "DIVE_CI_GITHUB_TOKEN"
}
```

The token value belongs in a root/service-user-readable environment file, not in JSON or Git. The runner uses a short-lived askpass helper and a mode-0600 token file under `/dev/shm` for host-side Git polling/checkout, then removes them. SSH remotes use the runner account's normal SSH configuration/agent; pin/verify host keys rather than disabling host-key checking.

## Pipeline format

Copy or adapt `.diveeoi/pipeline.yml` (also shown in `examples/pipeline.yml`) into each watched repository. A minimal pipeline:

```yaml
version: 1
name: Example
jobs:
  test:
    image: oven/bun:1.3.14
    timeoutMinutes: 30
    env:
      NODE_ENV: test
      SKIP_LIVE_EMBED: "1"
    secrets: [NPM_TOKEN]
    steps:
      - name: Install dependencies
        run: bun install --frozen-lockfile
      - name: Run tests
        run: bun test

  build:
    needs: [test]
    image: oven/bun:1.3.14
    artifacts:
      - dist
    steps:
      - name: Build
        run: bun run build
```

Supported job fields: `name`, `image`, `needs`, `timeoutMinutes` (1–1440; default 30), `env` (scalar values), `secrets` (names only), `artifacts` (explicit workspace-relative file/directory paths), and `steps`. Each step has `name`, `run` (up to 64 KiB of shell source), and `workingDirectory`. Pipelines allow up to 50 jobs and 100 steps per job, and are limited to 1 MiB. Unknown fields, unsafe paths, dependency cycles, host-sensitive environment names, and overlapping artifact paths are rejected.

Every job uses its configured image (or the runner default), an isolated container, and the same checked-out workspace. A job's declared artifacts are copied only after it succeeds; symlinks, special files, `.git` metadata, and paths escaping the workspace are rejected. Each run is capped by `maxArtifactBytesPerRun`; each job is capped at 10,000 artifact files. Artifacts are private files under `<storageDir>/artifacts/<run-id>/<job-id>/`; `artifacts` lists their absolute paths. The runner prunes expired run artifact directories periodically. Artifacts are not served over HTTP.

Validate configuration and workflows before deployment:

```sh
./bin/diveeoi-ci check --config /etc/diveeoi-ci/config.json
./bin/diveeoi-ci validate --workflow .diveeoi/pipeline.yml --image oven/bun:1.3.14
```

## Secrets and credential injection

Runner configuration contains secret names and Git token environment-variable names, never secret values. The secret CLI reads from standard input, encrypts values with AES-256-GCM, and stores them in `<storageDir>/secrets.enc.json`; the random 32-byte key is `<storageDir>/vault.key`. Both files are private to the runner account. Keep the storage directory and backups protected: encryption here helps protect a copied vault file by itself, but it does **not** protect against root, the runner account, a compromised runner, or a backup containing both the key and ciphertext.

1. Add the secret name to that repository's `allowedSecrets` configuration.
2. Add the same name to the trusted job's `secrets` list.
3. Store the value without putting it in command arguments or shell history:

```sh
printf '%s' "$NPM_TOKEN" | sudo -u diveeoi-ci /usr/local/bin/diveeoi-ci secret set \
  --stdin --config /etc/diveeoi-ci/config.json diveeoi NPM_TOKEN
```

The pipeline receives only requested secret values, and only when its ref matches `trustedBranches` or `trustedTags`. Untrusted refs are never given secrets. Secret values are redacted from the runner's streamed step logs on a best-effort basis; a process can transform or encode a secret, so log redaction is not a substitute for minimizing secret scope. Docker administrators and the host root user can inspect running containers and are trusted with these values. The runner does not mint short-lived `GITHUB_TOKEN` credentials; use narrowly scoped, rotated credentials and declare any job-side credential as a secret.

List names, delete values, inspect status, and read logs with:

```sh
./bin/diveeoi-ci secret list --config /etc/diveeoi-ci/config.json diveeoi
./bin/diveeoi-ci secret delete --config /etc/diveeoi-ci/config.json diveeoi NPM_TOKEN
./bin/diveeoi-ci status --config /etc/diveeoi-ci/config.json
./bin/diveeoi-ci logs --config /etc/diveeoi-ci/config.json <run-id-or-prefix>
./bin/diveeoi-ci artifacts --config /etc/diveeoi-ci/config.json <run-id-or-prefix>
```

A manual run requires a full watched ref and a 40- or 64-character commit SHA:

```sh
./bin/diveeoi-ci run --config /etc/diveeoi-ci/config.json \
  --repo diveeoi --ref refs/heads/dev --sha <commit-sha>
```

## VPS installation with systemd

1. Build and install the binary, create a dedicated unprivileged account, and create protected config/storage directories. Example:

   ```sh
   sudo useradd --system --user-group --home-dir /var/lib/diveeoi-ci \
     --create-home --shell /usr/sbin/nologin diveeoi-ci
   sudo install -d -o root -g root -m 0755 /etc/diveeoi-ci
   sudo install -d -o diveeoi-ci -g diveeoi-ci -m 0700 /var/lib/diveeoi-ci
   sudo install -o root -g root -m 0755 ./bin/diveeoi-ci /usr/local/bin/diveeoi-ci
   sudo install -o root -g diveeoi-ci -m 0640 examples/config.json /etc/diveeoi-ci/config.json
   ```

   Create `diveeoi-ci` as a system user with no interactive login and `/var/lib/diveeoi-ci` as its home/storage directory. Edit `/etc/diveeoi-ci/config.json`; its `storageDir` must match the storage directory and its `docker.rootless` field must match the Docker daemon.

2. Configure rootless Docker for that user (recommended) and confirm `docker info` works as the service account. For rootless Docker, set `docker.rootless` to `true` and provide the local socket, commonly `DOCKER_HOST=unix:///run/user/<uid>/docker.sock`. Rootless Docker requires the host's subordinate UID/GID and cgroup setup. If you instead grant access to a rootful Docker socket, add the account to the Docker socket's access group (commonly `docker`) and understand that this grants host-root-equivalent power to the account and all trusted pipelines; add `SupplementaryGroups=docker` to the unit if group membership is not inherited.

3. If using private HTTPS Git remotes, create `/etc/diveeoi-ci/runner.env` with the token environment variable declared by `gitCredentials.tokenEnv`. Set ownership to `root:diveeoi-ci` and mode `0640` (or use a systemd credential mechanism); never commit it. The unit below reads it.

4. Copy and adapt `deploy/diveeoi-ci.service`, then enable it:

   ```sh
   sudo install -o root -g root -m 0644 deploy/diveeoi-ci.service /etc/systemd/system/diveeoi-ci.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now diveeoi-ci
   sudo systemctl status diveeoi-ci
   journalctl -u diveeoi-ci -f
   ```

5. Verify with `diveeoi-ci status`, `logs`, and `artifacts`. The first poll is baseline-only unless `runOnStart` is true. Make a commit on a watched branch or create/move a watched tag to exercise polling. Use `check` first and `run` for a controlled manual validation.

The example unit uses systemd hardening and permits writes only below the configured storage directory. Edit its `DOCKER_HOST` and group/socket settings for the VPS. Rootless Docker often runs as a separate user service; arrange startup ordering so its socket is available before the CI unit. Do not enable an inbound port for this runner.

## Security and operational boundaries

- A pipeline is repository-controlled executable code. Protect trusted branches/tags and review changes to `.diveeoi/pipeline.yml` before allowing them to receive secrets.
- Docker is a useful isolation boundary, not a perfect sandbox. Rootful Docker access is effectively root. Rootless Docker reduces host impact but still shares the host kernel and needs resource limits.
- Jobs have network access through Docker's bridge network. Do not run untrusted pipelines with secrets; restrict outbound network at the host/firewall if required.
- Workspace and Docker image-pull disk usage are not currently quota-limited. Use a dedicated filesystem/user quota and monitor free disk space; a repository or build script can otherwise consume substantial storage before artifact limits are applied.
- The repository workspace is writable by the job container and deleted after the run. Only declared successful job artifacts persist. Never put secrets in artifact paths; artifact copying is opt-in but cannot determine whether a file contains sensitive data.
- Run history is capped at 500 records; old run logs/workspaces are pruned when their state records roll out. Step-output logs are capped at 64 MiB per run and contain best-effort redaction. Logs and artifacts are private to the service account.
- State and vault files are local JSON files, not a replicated database. Back up the complete storage directory securely; do not restore a vault key without its matching encrypted vault, or vice versa.
- Polling notices only the selected branch/tag refs and may miss a force-push that appears and disappears between polls. It does not guarantee exactly-once execution across crashes.
- A run is recorded as failed if the runner restarts while it is active. Workspaces are removed on normal completion and cleaned for completed/interrupted runs on the next startup; active or queued runs are preserved.
- This code is an initial implementation. Test it on a staging VPS and non-sensitive repository before production; review the isolation/security model for your threat profile.

## DiveeOI repository pipeline and validation

The checked-in `.diveeoi/pipeline.yml` is an example for this monorepo. It installs the frozen Bun workspace, runs `packages/learning` tests, typechecks the server and app, runs `build:nobin`, and retains `packages/app/dist` as an artifact. This exercises Targeted Learning unit coverage as part of CI but does not replace a model-backed live validation or browser/runtime checks. The repository's `docs/targeted-learning-debugging.md` and `scripts/tl-live-check.ts` describe the separate model-backed procedure.

To run the pipeline on a staging runner:

```sh
./bin/diveeoi-ci validate --workflow .diveeoi/pipeline.yml --image oven/bun:1.3.14
./bin/diveeoi-ci run --config /etc/diveeoi-ci/config.json \
  --repo diveeoi --ref refs/heads/dev --sha <full-commit-sha>
./bin/diveeoi-ci status --config /etc/diveeoi-ci/config.json
./bin/diveeoi-ci logs --config /etc/diveeoi-ci/config.json <run-id>
./bin/diveeoi-ci artifacts --config /etc/diveeoi-ci/config.json <run-id>
```

The self-hosted runner's unit tests cover config/ref validation, workflow ordering and rejection cases, secret encryption/redaction, state recovery, bounded output, Docker argument construction, locking, and artifact collection. A real end-to-end run additionally requires a Linux host with a supported Docker daemon and network access to the remotes/images.
