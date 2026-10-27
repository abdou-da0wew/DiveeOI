# celest — outbound-only remote shell

A two-part tool for reaching a machine you **cannot** SSH into: the target opens
an outbound HTTPS long-poll to a relay, and the relay hands it work. No inbound
port on the target, no public IP, no SSH, no VPN.

```
   ┌──────────────┐   1. POST /v1/enqueue   ┌──────────────┐
   │   operator   │ ──────────────────────► │    relay     │  (public HTTPS)
   │  (celest     │ ◄────────────────────── │  0.0.0.0:8080│
   │    run ...)  │   4. GET /v1/result     └──────┬───────┘
   └──────────────┘                                 │
                                       2. GET /v1/job (long-poll, outbound)
                                                    │
                                          ┌─────────▼────────┐
                                          │      agent       │  on the target
                                          │ executes locally │
                                          └─────────┬────────┘
                                       3. POST /v1/result
```

The agent only ever makes **outbound** requests, which is the one thing a
firewalled/NATed machine can still do.

## Why it is built this way

This exists because the operator side may sit behind an egress allowlist with no
routable address at all (that is exactly the case in this repo's sandbox: an
`169.254.0.21/30` link-local interface and an HTTPS proxy that only permits a
handful of hosts). A conventional reverse proxy or `ssh -R` needs either a
public listener or a real route. Long-polling over HTTPS with a shared token
needs neither.

## Build

```bash
cd tools/celest
go build -o celest .                 # native
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o celest-linux-amd64 .
```

`CGO_ENABLED=0` yields a fully static binary, so the target needs nothing
installed — no Go, no libc concerns.

## Quick start

On the **relay** host (has a public HTTPS endpoint):

```bash
celest serve --addr 0.0.0.0:8080 --bin-dir ./bin --state ~/.celest/state.json
# token is generated at ~/.celest/token on first run
```

On the **target** (firewalled machine):

```bash
curl -fL "https://RELAY/dl/celest-linux-amd64?token=$TOK" -o celest && chmod +x celest
./celest agent --relay https://RELAY --token "$TOK"
```

Back on the operator side:

```bash
celest status
celest run -- 'uname -a; id; ss -tulpn'
celest read /etc/nginx/nginx.conf
celest write ./local.conf /etc/nginx/conf.d/site.conf
celest history
```

## Commands

| Command | Purpose |
| --- | --- |
| `serve` | run the relay (`--addr`, `--bin-dir`, `--state`, `--token-file`) |
| `agent` | run on the target (`--relay`, `--name`, `--once`, `--insecure`) |
| `status` | agent online/offline, queue depth, counters |
| `run` | execute a shell command, print stdout/stderr, propagate exit code |
| `read` | fetch a remote file to stdout or `--out FILE` |
| `write` | upload a local file to a remote path |
| `history` / `show` | list past jobs, dump one in full |

`run` uses `/bin/sh -c` (or `cmd /C` on Windows), so pipes and redirection work.

## Protocol

All endpoints require the shared token, sent as `X-Celest-Token`,
`Authorization: Bearer …`, or `?token=`.

| Endpoint | Direction | Notes |
| --- | --- | --- |
| `GET /healthz` | public | liveness only, no auth, no data |
| `GET /v1/job?wait=20&host=&ver=` | agent → relay | long-poll; `204` when idle |
| `POST /v1/result` | agent → relay | finished job |
| `POST /v1/enqueue` | operator → relay | schedule work |
| `GET /v1/status` | operator | relay's view of the agent |
| `GET /v1/result/get?id=` | operator | one result |
| `GET /v1/history?limit=` | operator | recent results |
| `GET /dl/<name>?token=` | operator → relay | agent bootstrap binary |

## Safety properties

- **Token required everywhere** except `/healthz`; comparison is constant-time.
- **Output is capped** at 256 KiB per stream with a `truncated` flag, so
  `cat /dev/zero` cannot exhaust the relay.
- **Job timeouts** default to 120 s (`--timeout`), exit code `124` on expiry.
- **Bodies are never logged** — only method, path, status, duration.
- **Result count is bounded** (200 newest persisted) so `state.json` cannot grow
  without limit.
- `--insecure` skips TLS verification and exists only for local testing.

## Caveats

- The agent runs as whatever user launched it. There is no privilege model
  beyond that; do not run it as root unless you mean it.
- Anyone holding the token has shell access to the target. Treat it like an SSH
  private key and rotate it by deleting `~/.celest/token` and restarting the
  relay.
- The relay trusts the agent's reported results; it is a transport, not a
  sandbox.
