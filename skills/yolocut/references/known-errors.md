# YoloCut MCP recovery

## Cannot connect

Start YoloCut, reopen **Agent Connection Center (MCP)**, copy the current URL
and token, run its handshake test, then reconnect the Agent. A fallback desktop
port makes an old hard-coded 5199 URL stale.

## Full editing is not ready

Open the exact target project in YoloCut and call `yolocut_status` again. If the
manifest reports `catalog_mismatch`, refresh or update the editor and inspect
the listed missing tools.

## Stale or cancelled session

Do not reuse it. Start a new MCP transport and a new `begin_edit_session`, then
re-read project state before rebuilding the draft.

## Proposal is waiting

`awaiting_review` means the draft is ready but not applied. Ask the user to
approve it inside YoloCut, then continue polling `get_edit_session`.

## Legacy configuration

MCP servers registered under the former `chatcut` or `openchatcut` names and
calls to `chatcut_status` or `openchatcut_status` remain supported. They use
the same YoloCut endpoint and project data.
