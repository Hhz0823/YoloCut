# OpenCut-style agent workspace

This branch keeps YoloCut's AGPL-3.0-or-later editing engine and Agent
runtime while adopting the information architecture of a conventional OpenCut
workspace.

## Product contract

The desktop editor has four cooperating surfaces:

1. A left tool rail and resource browser for media, sequences, effects,
   transcripts, captions, and skills.
2. A central preview with a persistent properties inspector on its right edge.
3. A multi-track timeline across the bottom of the manual editing workspace.
4. A resizable Agent workspace docked on the far right.

The manual UI and Agent must continue to call the same `EditorCommands` API.
The Agent may produce a proposal/draft, but it must not mutate persisted project
JSON directly. Applying a reviewed proposal remains one atomic history action.

## Model providers

Direct third-party providers remain independently configurable. ZCode
Antigravity is an optional OpenAI-compatible loopback provider, not an editing
engine and not an OAuth owner inside YoloCut. Users start ZCode separately;
the settings page can discover its loopback port and model catalogue, verify the
local random API key server-side, and atomically configure it as the Agent model.
The key is never returned to the browser. Manual URL/key/model entry remains as
a recovery path, while ZCode continues to own OAuth and upstream accounts.

## Source and license boundary

- YoloCut code remains licensed under AGPL-3.0-or-later.
- OpenCut and OpenCut Classic are used as MIT-licensed interaction references.
- Preserve attribution for any MIT code copied in the future; visual similarity
  alone does not change YoloCut's AGPL distribution obligations.

## Phase 2 acceptance snapshot (2026-08-22)

- Automatic discovery verified ZCode Antigravity `0.6.4-test` on loopback port
  `18080`, authenticated the local gateway, and loaded 29 advertised models.
- The one-click route selected `zcode` / `gemini-3.7-flash`; its browser response
  contained only key status booleans and non-secret model routing values.
- A real built-in Agent run invoked `read_timeline` and `edit_item`. In Ask mode,
  the two-second title stayed out of the persisted timeline until review,
  applied as one history action, and returned to an empty timeline through the
  persisted Agent session rollback.
- A real 480p export completed at 854×480, H.264/AAC, 30 fps; the export path
  conforms fractional Remotion presets through an exact FFmpeg resize.
- Full `npm test`, `verify:affected`, lint, TypeScript, the Vite production build,
  and the isolated Electron smoke test passed. Browser checks at 1920×1080 and
  1280×720 found no document-level overflow in the ZCode settings flow.
