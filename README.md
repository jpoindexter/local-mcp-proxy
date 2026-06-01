# Local MCP Proxy

Local-only MCP proxy for sharing Mobbin and Refero across Claude Code, Codex, Claude Desktop, Hermes, or any other local MCP client.

The main reason this exists is Mobbin OAuth/session contention: Mobbin should see exactly one upstream client. Your local tools connect to this proxy, and this proxy keeps one queued upstream Mobbin session.

## Endpoints

- `http://127.0.0.1:8787/mobbin/mcp`
- `http://127.0.0.1:8787/refero/mcp`
- `http://127.0.0.1:8787/health`

The server refuses non-local bind hosts unless you edit the code. Do not expose this beyond localhost.

## Security

- Keep `mcp-proxy.config.json` and `.env` local. Both files are ignored by Git.
- Store Refero and Mobbin credentials in environment variables, not in committed config.
- Keep the proxy bound to `127.0.0.1`. The default config intentionally avoids non-local access.
- Runtime logs, cache files, pids, build output, and `node_modules` are ignored.

## Setup

```sh
npm install
cp mcp-proxy.config.example.json mcp-proxy.config.json
cp .env.example .env
```

Set your Refero token in the shell that runs the proxy:

```sh
export REFERO_MCP_TOKEN="your-refero-token"
```

You can also use a full header:

```sh
export REFERO_AUTHORIZATION="Bearer your-refero-token"
```

## Mobbin Login

Mobbin defaults to `mcp-remote`, launched once by the proxy:

```json
"mobbin": {
  "upstreamUrl": "https://api.mobbin.com/mcp",
  "mode": "mcp-remote"
}
```

On the first Mobbin tool call, `mcp-remote` may open a browser or print an OAuth URL. Complete that login once. After Claude, Codex, and Hermes are changed to localhost, they should stop logging into Mobbin directly.

This is the important part: do not keep any client pointed directly at `https://api.mobbin.com/mcp`, or it can still steal the upstream Mobbin session.

## Run

```sh
npm run dev
```

Or build and run:

```sh
npm run build
npm start
```

Check health:

```sh
curl http://127.0.0.1:8787/health
```

## Config

Config is loaded from `mcp-proxy.config.json`, then environment variables override operational values.

Useful env vars:

- `MCP_PROXY_PORT`, default `8787`
- `MCP_PROXY_HOST`, default `127.0.0.1`
- `MCP_PROXY_CACHE_DIR`, default `.mcp-proxy-cache`
- `MCP_PROXY_SEARCH_TTL_SECONDS`, default `21600`
- `MCP_PROXY_DETAIL_TTL_SECONDS`, default `86400`
- `MCP_PROXY_DEBUG`, default `false`
- `REFERO_TOKEN_ENV_VAR`, default `REFERO_MCP_TOKEN`
- `REFERO_MCP_TOKEN` or `REFERO_AUTHORIZATION`
- `MOBBIN_UPSTREAM_MODE`, default `mcp-remote`
- `MOBBIN_AUTHORIZATION`, optional direct header mode

## Proposed Codex Config

Do not apply until the proxy is running and Mobbin login works through the proxy.

In `~/.codex/config.toml`, replace the current upstream entries with:

```toml
[mcp_servers.refero]
url = "http://127.0.0.1:8787/refero/mcp"

[mcp_servers.mobbin]
url = "http://127.0.0.1:8787/mobbin/mcp"
```

Remove the direct Refero `http_headers` block from Codex after moving the token to the proxy environment.

## Proposed Claude Code Config

After the proxy is running:

```sh
claude mcp remove refero -s user
claude mcp add refero --transport http http://127.0.0.1:8787/refero/mcp -s user

claude mcp remove mobbin -s user
claude mcp add mobbin --transport http http://127.0.0.1:8787/mobbin/mcp -s user
```

## Proposed Claude Desktop Config

Claude Desktop currently did not have Mobbin or Refero configured here on this machine. If you add them, use:

```json
{
  "mcpServers": {
    "mobbin": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:8787/mobbin/mcp"]
    },
    "refero": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:8787/refero/mcp"]
    }
  }
}
```

If Claude Desktop supports HTTP MCP directly in your installed version, use the same localhost URLs directly instead of `mcp-remote`.

## Proposed Hermes Config

Point Hermes at the same local HTTP endpoints:

```json
{
  "mobbin": {
    "type": "http",
    "url": "http://127.0.0.1:8787/mobbin/mcp"
  },
  "refero": {
    "type": "http",
    "url": "http://127.0.0.1:8787/refero/mcp"
  }
}
```

The exact file depends on your Hermes install; the key requirement is that Mobbin must not point directly at `https://api.mobbin.com/mcp`.

## Troubleshooting

- Mobbin still disconnects Codex or Claude: one of the clients is still pointed directly at upstream Mobbin. Check every MCP config for `https://api.mobbin.com/mcp`.
- Mobbin auth required: keep the proxy running, call a Mobbin tool once, and complete the `mcp-remote` browser login.
- Refero auth required: set `REFERO_MCP_TOKEN` or `REFERO_AUTHORIZATION` in the proxy environment, then restart the proxy.
- Port conflict: set `MCP_PROXY_PORT=8788` and update local client URLs.
- Need more logs: set `MCP_PROXY_DEBUG=true`. Logs are JSON and redact token-like fields.
- Stale design results: delete `.mcp-proxy-cache` or lower the TTL env vars.

## Test Plan

```sh
npm test
npm run typecheck
npm run build
curl http://127.0.0.1:8787/health
```

Manual verification:

1. Start the proxy.
2. Point Claude Code to `http://127.0.0.1:8787/mobbin/mcp`.
3. Point Codex to `http://127.0.0.1:8787/mobbin/mcp`.
4. Call a Mobbin search from both clients.
5. Confirm `/health` shows one Mobbin provider with queue depth returning to `0`.
6. Confirm neither client is configured with the direct Mobbin upstream URL.
