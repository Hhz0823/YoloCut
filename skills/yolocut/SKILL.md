---
name: yolocut
description: Connect an MCP-capable coding agent to YoloCut and edit local video projects. Use for YoloCut installation, connection, project inspection, timeline editing, captions, media, generation, audio, color, export, or MCP recovery. Legacy ChatCut and OpenChatCut registrations remain compatible.
---

# YoloCut

YoloCut is a local-first, agent-native video editor. This skill is the external
entry point; specialized editing playbooks are loaded from the running editor
with `load_skill`.

## Route the task

- Install, connect, or diagnose MCP: read `references/getting-started.md`.
- Inspect or modify a project: read `references/editing-workflow.md`.
- Recover from a failed call or stale session: read `references/known-errors.md`.

## Essentials

1. Start YoloCut. Its default endpoint is
   `http://localhost:5199/api/external-mcp/mcp`; use the actual URL and bearer
   token shown by **Agent Connection Center (MCP)**.
2. Call `yolocut_status`, then `get_connection_manifest`. The legacy
   `chatcut_status` and `openchatcut_status` aliases are equivalent. Full editing requires
   `readiness.fullEditing=ready` and `capabilityCoverage.complete=true`.
3. Call `list_projects`, and select only a project identified by the user or
   current context. Bind it with `target_project`.
4. Call `load_skill` before specialized work. Refresh the MCP list after
   `tools/list_changed` when progressive exposure is enabled.
5. Call `begin_edit_session` before project reads or edits and pass its
   `editSessionId` to every draft-safe tool.
6. Default to `approvalMode: "manual"`; use `auto` only when the user explicitly
   authorizes unattended application.
7. Finish with `review_edit_session`. Report success only after
   `get_edit_session` returns `status="applied"`.

## Compatibility

`yolocut` is the product/client name. A centralized migration layer accepts
the former client names, status tools, data directories, and request headers
so existing projects and Agent configurations remain usable.

## Skill version

`2026-08-24.1`
