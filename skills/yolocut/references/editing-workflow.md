# Edit a YoloCut project

1. Call `yolocut_status` and `get_connection_manifest`.
2. Call `list_projects`; bind the exact user-selected project with
   `target_project` and surface its `editorUrl`.
3. Call `load_skill` or `ToolSearch` for the task-specific workflow and exact
   schemas.
4. Call `begin_edit_session` with `approvalMode="manual"` unless unattended
   application was explicitly requested.
5. Pass the returned `editSessionId` to every project read and edit call. Keep
   all edits in that draft; do not mix projects or sessions.
6. Use readback and preview tools to validate IDs, tracks, timing, captions,
   media availability, and export prerequisites.
7. Call `review_edit_session` once the complete draft is ready.
8. Poll `get_edit_session`. `pending_review`, `draft`, `failed`, `cancelled`, or
   `stale` is not completion. Report success only for `applied`.

Manual sessions require the user to approve the complete proposal in YoloCut.
Auto sessions atomically apply only at review time. Real side-effect tools may
still require one-shot confirmation tied to their exact arguments.
