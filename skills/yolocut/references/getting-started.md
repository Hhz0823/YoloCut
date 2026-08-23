# Connect YoloCut

## 1. Get the live connection data

Start YoloCut, open **Agent Connection Center (MCP)**, and copy the displayed
URL and bearer token. Port 5199 is the default, but the desktop app may select a
fallback port when it is occupied. Run the connection center's handshake test
before diagnosing a specific Agent client.

Default full endpoint:

```text
http://localhost:5199/api/external-mcp/mcp
```

Progressive endpoint for clients that honor `tools/list_changed`:

```text
http://localhost:5199/api/external-mcp/mcp?toolExposure=progressive
```

## 2. Register the server

Windows Codex:

```powershell
$env:YOLOCUT_MCP_TOKEN = '<token>'
codex mcp add yolocut `
  --url 'http://localhost:5199/api/external-mcp/mcp' `
  --bearer-token-env-var YOLOCUT_MCP_TOKEN
```

macOS/Linux Codex:

```bash
export YOLOCUT_MCP_TOKEN='<token>'
codex mcp add yolocut \
  --url http://localhost:5199/api/external-mcp/mcp \
  --bearer-token-env-var YOLOCUT_MCP_TOKEN
```

Claude Code:

```bash
claude mcp add --transport http \
  --header "Authorization: Bearer <token>" \
  yolocut http://localhost:5199/api/external-mcp/mcp
```

Gemini CLI:

```bash
gemini mcp add --transport http yolocut \
  http://localhost:5199/api/external-mcp/mcp \
  --header "Authorization: Bearer <token>"
```

Cursor:

```json
{
  "mcpServers": {
    "yolocut": {
      "type": "http",
      "url": "http://localhost:5199/api/external-mcp/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Existing `chatcut` or `openchatcut` client entries remain valid and do not need
to be rewritten immediately. New registrations should use `yolocut`.

## 3. Verify

Call, in order:

1. `yolocut_status` (historical status aliases remain compatible)
2. `get_connection_manifest`
3. `list_projects`

Treat the complete editor surface as available only when
`readiness.fullEditing=ready` and `capabilityCoverage.complete=true`. If no
editor is online, open the user-selected project; server-direct mode is a
limited data-only fallback.

## Token handling

The endpoint always requires a bearer token, even on localhost. Keep it in the
Agent client's secret or environment configuration. Never write it into source
control, project data, prompts, screenshots, or browser storage.
