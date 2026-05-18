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
- **Curated tools** — 13 well-documented tools covering discovery (apps,
  spaces, catalog), introspection (fields, master items, sheets, field
  description), selections (apply/inspect/clear filters), and querying
  (hypercube, scalar evaluate).
- **Multi-tenant contexts** — `qac context create|use|ls|...` model mirroring
  `qlik-cli`. Active context is used by default; per-call override via
  `--context` flag or MCP `context` parameter.
- **Deterministic JSON output** — `{ok, data}` on success, `{ok, error}` on
  failure, distinct exit codes for usage/exec/auth errors.
- **No daemon** — each QIX call opens a fresh WebSocket session and closes it
  in a `finally` block; Qlik app selections can still be applied and reused by
  the same user/app selection state.
- **AGPL-3.0** licensed.

## Install

Pre-built binaries are published on each tagged release. Pick the asset that
matches your OS/arch from the GitHub Releases page:

| OS      | Architecture        | Asset                  |
| ------- | ------------------- | ---------------------- |
| Linux   | x86-64 (glibc)      | `qac-linux-x64`        |
| Linux   | x86-64 (musl/Alpine)| `qac-linux-x64-musl`   |
| Linux   | aarch64 / ARM64     | `qac-linux-arm64`      |
| macOS   | Intel               | `qac-darwin-x64`       |
| macOS   | Apple Silicon (M1+) | `qac-darwin-arm64`     |
| Windows | x86-64              | `qac-windows-x64.exe`  |

A `SHA256SUMS` file is published alongside the binaries; verify it before
moving the binary into your `PATH`.

### macOS

```sh
# Apple Silicon (M1/M2/M3/M4) — use x64 binary on Intel Macs.
curl -fLo qac https://github.com/jonasandre/qac/releases/latest/download/qac-darwin-arm64
chmod +x qac

# The binary is unsigned; clear Gatekeeper quarantine if present
# (no-op if binary wasn't downloaded via browser/AirDrop).
xattr -d com.apple.quarantine qac 2>/dev/null || true

sudo mv qac /usr/local/bin/qac
qac --version
```

If Gatekeeper still complains, open *System Settings → Privacy & Security* and
click *Allow Anyway* after the first run is blocked.

Apple Silicon users: the `darwin-arm64` binary runs natively. Avoid the
`darwin-x64` build (would run under Rosetta and be slower).

### Linux

```sh
# Pick the arch that matches `uname -m`:
#   x86_64  → qac-linux-x64       (Debian/Ubuntu/Fedora/RHEL — glibc)
#   x86_64  → qac-linux-x64-musl  (Alpine, distroless, scratch containers)
#   aarch64 → qac-linux-arm64     (ARM servers, Raspberry Pi 64-bit)
curl -fLo qac https://github.com/jonasandre/qac/releases/latest/download/qac-linux-x64
chmod +x qac
sudo mv qac /usr/local/bin/qac
qac --version
```

For unprivileged installs:

```sh
mkdir -p ~/.local/bin
mv qac ~/.local/bin/qac
# Make sure ~/.local/bin is in your PATH (usually is for systemd-based distros).
```

### Windows

Download `qac-windows-x64.exe` from the latest release and:

**PowerShell (recommended):**

```powershell
$dst = "$env:USERPROFILE\bin"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Move-Item .\qac-windows-x64.exe "$dst\qac.exe"

# Add to user PATH (once).
[Environment]::SetEnvironmentVariable(
  "Path",
  [Environment]::GetEnvironmentVariable("Path", "User") + ";$dst",
  "User"
)
# Open a new shell, then:
qac --version
```

**cmd.exe:**

```cmd
move qac-windows-x64.exe %USERPROFILE%\bin\qac.exe
setx PATH "%PATH%;%USERPROFILE%\bin"
```

On first run, Windows SmartScreen may show *"Windows protected your PC"* —
click *More info → Run anyway*. The binary is unsigned in the MVP; signing
will land in a later release.

### Build from source

Requires Bun 1.2+ ([install instructions](https://bun.sh/docs/installation)):

```sh
git clone https://github.com/jonasandre/qac.git
cd qlik-api-cli
bun install
bun test
bun run build:local       # produces dist/qac for your current OS/arch
```

Cross-compile to any target without a matching host:

```sh
bun build packages/cli/src/index.ts \
  --compile --target=bun-linux-arm64 \
  --outfile dist/qac-linux-arm64
```

## Configure

Create a context (stored in `~/.qac/config.yaml`, mode 600). Prefer the
`$env:VAR_NAME` reference or the interactive prompt — passing a raw secret as
a CLI arg can leak via shell history and process listings.

Recommended: reference an env var.

```sh
export QAC_PROD_API_KEY=qlik_xxx_yyy
qac context create prod \
  --tenant https://your-tenant.qlikcloud.com \
  --api-key '$env:QAC_PROD_API_KEY'
```

Or omit the flag and `qac` will prompt for the secret (no echo) on a TTY:

```sh
qac context create prod --tenant https://your-tenant.qlikcloud.com
# API key: ********
```

OAuth2 M2M with an env-referenced secret:

```sh
export QAC_PROD_OAUTH_SECRET=...
qac context create prod \
  --tenant https://your-tenant.qlikcloud.com \
  --oauth-client-id ... \
  --oauth-client-secret '$env:QAC_PROD_OAUTH_SECRET'
```

Scripting note: literal secrets via `--api-key qlik_xxx` or
`--oauth-client-secret ...` still work, but `qac` prints a stderr warning on
interactive shells. Quote `$env:` references to stop the shell expanding `$`.

The same secrets can be referenced through environment variables in the YAML:

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
qac app filter apply <appId> --filter "Year=2024,2025"
qac app query <appId> \
  --dim "[Region]" \
  --measure "Sum([Sales])" \
  --limit 100
qac app filter get <appId>
qac app filter clear <appId>
qac app eval <appId> --expr "Sum([Sales])"
```

All commands write `{"ok": true, "data": ...}` to stdout. Errors go to stderr
as `{"ok": false, "error": {"code": "...", "message": "...", "details": {...}}}`
with exit code 1 (usage), 2 (execution) or 3 (auth/config).

## MCP usage

`qac mcp` runs as an MCP server over **stdio**. There is no port to expose:
the client (Claude Desktop, Claude Code, ChatGPT Desktop, Cursor, …) spawns
`qac mcp` as a subprocess and communicates over its stdin/stdout. Auth lives
in the local `~/.qac/config.yaml`, so credentials never leave your machine
except for the call to Qlik Cloud itself.

### Before wiring it up

1. Install `qac` and confirm `qac --version` works in a shell.
2. Configure at least one context (`qac context create <name> --tenant ... --api-key ...`).
3. Verify it works directly: `qac apps list --limit 1`.
4. Note the absolute path to the binary — MCP clients usually need the full
   path because they don't inherit your shell's `PATH`:

   - macOS / Linux: `which qac` → e.g. `/usr/local/bin/qac`.
   - Windows: `where.exe qac` → e.g. `C:\Users\<you>\bin\qac.exe`.

### Claude Desktop

Edit `claude_desktop_config.json`. Location:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

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

Windows (escape backslashes in JSON):

```json
{
  "mcpServers": {
    "qac": {
      "command": "C:\\Users\\<you>\\bin\\qac.exe",
      "args": ["mcp"]
    }
  }
}
```

Fully restart Claude Desktop (quit, then reopen — not just close the window).
You should see a tool/plug icon in the message composer indicating MCP tools
are loaded. Hover or click to see `qac`'s tools listed.

If credentials should come from environment variables instead of the config
file, add them under `env`:

```json
{
  "mcpServers": {
    "qac": {
      "command": "/usr/local/bin/qac",
      "args": ["mcp"],
      "env": {
        "QAC_TENANT_URL": "https://your-tenant.qlikcloud.com",
        "QAC_API_KEY": "qlik_xxx_yyy"
      }
    }
  }
}
```

### Claude Code

From the project where you want Qlik available:

```sh
claude mcp add qac /usr/local/bin/qac mcp
```

This writes the entry to `.claude/mcp.json` (project-scoped). To install
user-wide instead, add `--scope user`. To verify:

```sh
claude mcp list
```

Start a session in that project and Claude Code will spawn `qac mcp` on
demand.

### ChatGPT Desktop

ChatGPT Desktop supports stdio MCP servers through **Connectors** (Developer
mode). Path may shift release-to-release; the general flow is:

1. Open ChatGPT Desktop → *Settings → Connectors* (you may need to enable
   *Developer mode* under *Settings → Advanced*).
2. *Add custom connector* → choose *Local (stdio)*.
3. Fill in:
   - **Name:** `qac`
   - **Command:** absolute path to the `qac` binary (e.g. `/usr/local/bin/qac`).
   - **Arguments:** `mcp`
   - **Environment** (optional): set `QAC_TENANT_URL`, `QAC_API_KEY`, etc. if
     you don't want to depend on `~/.qac/config.yaml`.
4. Save and enable the connector. Tools appear in the composer's tool menu.

ChatGPT web (`chat.openai.com`) and the OpenAI API itself do **not** speak
stdio MCP directly. To use `qac` from web/API workflows, run it from a custom
agent harness that bridges OpenAI tool calls to the MCP protocol (e.g. via
`@modelcontextprotocol/sdk` Client + your own glue code).

### Other MCP-aware clients

Same pattern — wire the absolute path to `qac` as the command and `mcp` as
the single argument:

- **Cursor:** `.cursor/mcp.json` (project) or settings UI.
- **Cline / Continue / Zed / …:** see each client's MCP docs.

### Verifying without a client

```sh
npx @modelcontextprotocol/inspector qac mcp
```

Opens a local web UI that connects to `qac mcp` over stdio, lists the 14
tools, and lets you invoke each one with form-validated arguments — useful
to confirm everything works before plugging into a real LLM client.

### Per-call context override

All tools accept an optional `context` argument that selects a tenant other
than the active one. Call `list_contexts` first to discover which contexts
are available.

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
| `apply_filters`     | QIX   | Apply reusable app selections.                    |
| `clear_filters`     | QIX   | Clear all selections or selected fields.          |
| `get_filters`       | QIX   | Inspect current app selections.                   |
| `query`             | QIX   | Run a hypercube query (rows × dim/measure).       |
| `evaluate`          | QIX   | Evaluate a single expression and return a scalar. |
| `list_contexts`     | local | List configured tenant contexts (MCP only).       |

Recommended MCP workflow for filtered analysis: use `list_fields` and
`describe_field` to discover valid fields/values, call `apply_filters`, run
`query` or `evaluate`, then call `clear_filters` when the filtered analysis is
done. `query.filters` remains available for one-shot filters.

## Development

```sh
bun install
bun test
bun run typecheck
bun run build:local
```

## License

AGPL-3.0-or-later. See [LICENSE](./LICENSE).
