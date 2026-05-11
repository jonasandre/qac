# qac — Qlik API Companion

Open-source CLI + MCP server that exposes Qlik Cloud (REST + QIX engine) to LLM
agents. Designed as a license-free alternative to the official Qlik MCP server,
focused specifically on analytical data extraction.

> Not a replacement for `qlik-cli` (which targets human operators doing REST
> administration). `qac` targets LLM agents that need to discover apps and
> extract analytical results — with curated tool schemas, deterministic JSON
> output, and a single binary that doubles as an MCP stdio server.

## Highlights

- **Dual surface** — same tool set exposed as both a CLI (`qac <command>`) and
  an MCP server (`qac mcp`).
- **Curated tools** — 10 well-documented tools covering discovery (apps,
  spaces, catalog), introspection (fields, master items, sheets, field
  description) and querying (hypercube, scalar evaluate).
- **Multi-tenant contexts** — `qac context create|use|ls|...` model mirroring
  `qlik-cli`. Active context is used by default; per-call override via
  `--context` flag or MCP `context` parameter.
- **Deterministic JSON output** — `{ok, data}` on success, `{ok, error}` on
  failure, distinct exit codes for usage/exec/auth errors.
- **Stateless** — each QIX call opens a fresh WebSocket session and closes it
  in a `finally` block. No daemon, no shared state.
- **AGPL-3.0** licensed.

## Install

Pre-built binaries are published on each tagged release for:

- `linux-x64`, `linux-x64-musl`, `linux-arm64`
- `darwin-x64`, `darwin-arm64`
- `windows-x64`

Download from the GitHub release page, then:

```sh
chmod +x qac-darwin-arm64
mv qac-darwin-arm64 /usr/local/bin/qac
```

On macOS the binary is unsigned; clear the Gatekeeper quarantine attribute
once after download:

```sh
xattr -d com.apple.quarantine /usr/local/bin/qac
```

### Build from source

```sh
bun install
bun run build:local        # produces dist/qac
```

Requires Bun 1.2+.

## Configure

Create a context (stored in `~/.qac/config.yaml`, mode 600):

```sh
qac context create prod \
  --tenant https://your-tenant.qlikcloud.com \
  --api-key qlik_xxx_yyy
```

Or with OAuth2 M2M:

```sh
qac context create prod \
  --tenant https://your-tenant.qlikcloud.com \
  --oauth-client-id ... \
  --oauth-client-secret ...
```

Secrets can also be referenced through environment variables in the YAML:

```yaml
contexts:
  prod:
    tenant: https://your-tenant.qlikcloud.com
    auth:
      type: api-key
      key: $env:QAC_PROD_API_KEY
```

### Credential resolution order

1. `--context <name>` flag.
2. `QAC_CONTEXT=<name>` env variable.
3. Full env override: `QAC_TENANT_URL` + (`QAC_API_KEY` _or_
   `QAC_OAUTH_CLIENT_ID`+`QAC_OAUTH_CLIENT_SECRET`). Creates an ephemeral
   context; ideal for CI/CD.
4. `active` field of `~/.qac/config.yaml`.
5. Error `NO_ACTIVE_CONTEXT`.

## CLI usage

```sh
qac apps list --query sales --limit 20
qac apps get <appId>
qac spaces ls
qac app fields <appId>
qac app master-items <appId>
qac app sheets <appId>
qac app describe-field <appId> Region --sample-size 100
qac app query <appId> \
  --dim "[Region]" \
  --measure "Sum([Sales])" \
  --filter "Year=2024,2025" \
  --limit 100
qac app eval <appId> --expr "Sum([Sales])"
```

All commands write `{"ok": true, "data": ...}` to stdout. Errors go to stderr
as `{"ok": false, "error": {"code": "...", "message": "...", "details": {...}}}`
with exit code 1 (usage), 2 (execution) or 3 (auth/config).

## MCP usage

Run via stdio:

```sh
qac mcp
```

Wire it into an MCP-aware client. Example for Claude Desktop
(`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "qac": {
      "command": "/usr/local/bin/qac",
      "args": ["mcp"]
    }
  }
}
```

All tools accept an optional `context` argument that names a context other
than the active one. Call `list_contexts` to discover which are available.

## Tool reference

| Tool                | Layer | Description                                       |
| ------------------- | ----- | ------------------------------------------------- |
| `list_apps`         | REST  | List apps in the tenant (paginated).              |
| `get_app`           | REST  | Fetch metadata for a single app.                  |
| `list_spaces`       | REST  | List spaces.                                      |
| `search_catalog`    | REST  | Free-text search across the catalog.              |
| `list_fields`       | QIX   | Data model fields.                                |
| `list_master_items` | QIX   | Master dimensions + measures (prefer these).      |
| `list_sheets`       | QIX   | Sheets in the app.                                |
| `describe_field`    | QIX   | Cardinality + sample values for one field.        |
| `query`             | QIX   | Run a hypercube query (rows × dim/measure).       |
| `evaluate`          | QIX   | Evaluate a single expression and return a scalar. |
| `list_contexts`     | local | List configured tenant contexts (MCP only).       |

## Development

```sh
bun install
bun test
bun run typecheck
bun run build:local
```

## License

AGPL-3.0-or-later. See [LICENSE](./LICENSE).
