<p align="center">
  <img src="assets/favicon.svg" width="96" alt="YoloCut logo" />
</p>

<h1 align="center">YoloCut</h1>

<p align="center">
  <strong>Edit by hand. Delegate to agents. Keep the timeline under your control.</strong>
</p>

<p align="center">
  Open-source desktop video editing · Detachable Agent workspace · External MCP access · Hardware-aware 4K workflows
</p>

<p align="center">
  <a href="README_ZH.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://github.com/Hhz0823/YoloCut/releases/tag/v0.0.2"><img alt="Release v0.0.2" src="https://img.shields.io/badge/release-v0.0.2-0A84FF?style=flat-square" /></a>
  <img alt="Desktop platforms" src="https://img.shields.io/badge/desktop-Windows%20%7C%20macOS%20%7C%20Linux-3A3A3C?style=flat-square" />
  <img alt="Agent tools 119" src="https://img.shields.io/badge/Agent_tools-119-30D158?style=flat-square" />
  <a href="LICENSE"><img alt="AGPL-3.0-or-later" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-FF9F0A?style=flat-square" /></a>
</p>

<p align="center">
  <a href="https://github.com/Hhz0823/YoloCut/releases/tag/v0.0.2"><strong>Download v0.0.2</strong></a>
  · <a href="#connect-an-external-agent">Connect an Agent</a>
  · <a href="#run-from-source">Run from source</a>
  · <a href="https://github.com/Hhz0823/YoloCut/issues">Report an issue</a>
</p>

<p align="center">
  <img src="assets/readme-pic/02-yolocut-editor.jpg" alt="YoloCut v0.0.2 desktop editor with multitrack timeline and Agent workspace" />
</p>

## A new kind of video editor

YoloCut is a local-first desktop editor where a human and an Agent work on the **same real project**. Trim and arrange clips on the timeline, or ask the built-in Agent, Codex, Claude Code, Gemini CLI, Cursor, or another MCP client to use the same editing commands.

This is not a one-shot video generator that returns an opaque result. Agent work becomes normal media, tracks, clips, captions, transitions, effects, keyframes, and export jobs. You can preview it, review the proposed changes, apply or reject them, undo them, and continue editing by hand.

```text
Media + script + editing goal
        ↓
Agent creates a reviewable edit session
        ↓
Real timeline changes → preview → refine → export
```

## Why YoloCut

| One editing core | Agent-native workspace | Built for real desktop hardware |
|---|---|---|
| Manual UI and Agent tools converge on the same `EditorCore` command layer. | Dock the Agent left or right, detach it into a wide window, or connect an external MCP client. | Proxy editing, decoder fallbacks, workload admission, and GPU-aware export keep long high-resolution projects usable. |

## Product tour

<table>
  <tr>
    <td width="50%">
      <img src="assets/readme-pic/01-yolocut-dashboard.jpg" alt="YoloCut v0.0.2 project dashboard" />
      <br /><sub><b>Local project dashboard</b> — create, search, import, copy, export, and manage projects.</sub>
    </td>
    <td width="50%">
      <img src="assets/readme-pic/03-yolocut-agent.jpg" alt="YoloCut Agent skill library and detachable Agent workspace" />
      <br /><sub><b>Agent workspace</b> — reusable workflows beside the same multitrack project.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="assets/readme-pic/04-yolocut-effects.jpg" alt="YoloCut effects library" />
      <br /><sub><b>Effects library</b> — masks, keying, color tools, LUTs, shaders, transitions, and motion effects.</sub>
    </td>
    <td width="50%">
      <img src="assets/readme-pic/05-yolocut-mcp.jpg" alt="YoloCut external Agent MCP connection center" />
      <br /><sub><b>External Agent connection</b> — live endpoint, Bearer token, health checks, and the required edit-session flow.</sub>
    </td>
  </tr>
</table>

All screenshots above were captured from the current YoloCut `v0.0.2` desktop application.

## What is available in v0.0.2

| Area | Current capabilities |
|---|---|
| Timeline | Multitrack video and audio, move, trim, split, ripple trim, slip, rate stretch, snapping, markers, keyframes, undo, and redo |
| Preview and canvas | 25%–400% zoom, pan mode, custom output sizes, safe areas, composition guides, and clip transforms |
| Text and captions | Transcription jobs, transcript editing, silence cleanup, captions, translation, styling, and SRT export |
| Audio | Voice-over recording, multitrack mixing, sound effects, music analysis, loudness tools, ducking, and voice isolation |
| Visual system | Masks, chroma key, grading, scopes, LUTs, WebGL/GLSL effects, transitions, and motion-graphics templates |
| Agent | Built-in chat Agent, reusable Skills, proposals, approval policy, progress, history, and the canonical 119-tool catalog |
| Batch editing | Media folders, edit scripts, narration scripts, reference videos, durable queues, per-job projects, QA, and status readback |
| Local and cloud AI | Local ASR/TTS/model packs plus configurable third-party LLM, image, video, music, and sound providers |
| Desktop runtime | Immediate native startup shell, parallel embedded server startup, deferred heavy services, isolated smoke profiles, and stage-level startup tracing |
| Delivery | MP4, audio, SRT, FCPXML, portable project packages, export history, and hardware-aware H.264 routing |

## Agent-native by design

The detachable Agent workspace is a control surface, not a decorative chat sidebar:

- It shares project state and editing commands with the manual UI.
- It can dock left or right, open as a separate wide desktop window, and return to the editor through corner docking.
- Mutating work is staged in an edit session for review before it is considered applied.
- The built-in Agent and external MCP clients use the same canonical **119-tool** catalog.
- When no project is open, YoloCut exposes only the smaller server-direct surface and reports the limitation honestly.

<p align="center">
  <img src="assets/readme-pic/yolocut-runtime.en.svg" alt="YoloCut editor, Agent, MCP, media, and export architecture" />
</p>

## Connect an external Agent

Install the YoloCut Agent Skill:

```bash
npx skills add Hhz0823/YoloCut --skill yolocut
```

Start YoloCut, open the target project, then open **Agent Connection Center (MCP)** and copy its live URL and Bearer token. The default endpoint is:

```text
http://localhost:5199/api/external-mcp/mcp
```

The desktop application can choose another loopback port when `5199` is occupied, so clients should use the address displayed by the connection center rather than permanently hard-coding the default.

Required completion flow:

```text
yolocut_status → get_connection_manifest → list_projects → target_project
→ load_skill / ToolSearch → begin_edit_session → editing tools
→ review_edit_session → get_edit_session (status=applied)
```

An Agent should report completion only when full editing is ready, capability coverage is complete, and the final edit session is `applied`. Configuration examples for Codex, Claude Code, Gemini CLI, Cursor, and generic Streamable HTTP clients are in [YOLOCUT_AGENT_CONNECTION.md](YOLOCUT_AGENT_CONNECTION.md).

## Batch auto-editing

Give YoloCut a media directory, edit script, narration script, and optional reference video. The durable queue accepts up to **10,000 jobs**, with a separate project and lifecycle for every output instead of placing thousands of videos on one timeline.

1. Scan an authorized local media directory.
2. Attach the edit script, narration script, and optional reference cut.
3. Analyze rhythm, shot structure, captions, transitions, and color intent.
4. Let the Agent create reviewable edits with hardware-aware concurrency.
5. Render, quality-check, and read back success, failure, or cancellation per job.

Optional local reference analysis uses the Apache-2.0 `SmolVLM2-500M-Video-Instruct-GGUF` package with `llama.cpp`. Missing models or runtimes fail visibly; YoloCut does not fabricate an analysis result.

## Long 4K projects on modest machines

YoloCut separates the interactive proxy path from final-quality media. Analysis and preview can use smaller derivatives while final export reads the original files.

- NVIDIA systems prefer `NVDEC → scale_cuda → NVENC` after live capability probes.
- H.264 routing probes NVENC, Intel QSV, AMD AMF, and then software `libx264`.
- AV1, VP9, and unsupported hardware paths can fall back to FFmpeg software decoders such as `libaom-av1` and `libvpx`.
- CPU, memory, VRAM, codec support, and active workload decide proxy size and queue concurrency.
- Runtime results show the backend that was actually used and any fallback reason; model or GPU names alone are never treated as proof.

| Hardware tier | Conservative editing policy | Local narration recommendation |
|---|---|---|
| Unrecognized GPU / low-end PC | 540p proxy, one analysis job, one render job | Kokoro CPU fallback |
| RTX 2060 6 GB | 540p proxy, NVDEC/NVENC when proven available | Kokoro 82M ONNX, WebGPU preferred with CPU fallback |
| RTX 4060 8–9 GB | 720p proxy, up to two analysis jobs, protected single render | Fish Audio S2 Pro with `s2.cpp + Q6_K` (experimental) |
| RTX 5060+ 8–9 GB | 1080p proxy, up to three analysis jobs, protected single render | Fish Audio S2 Pro with `s2.cpp + Q6_K` (experimental) |
| RTX 40/50 series with at least 10 GB VRAM | Higher-quality local inference while preserving render headroom | Fish Audio S2 Pro with `s2.cpp + Q8_0` (experimental) |

> Fish S2 model weights use the Fish Audio Research License. Commercial use requires separate written permission. Hardware tiers are conservative policy contracts, not performance guarantees for every driver and machine.

## Faster desktop startup

YoloCut `v0.0.2` now stages desktop startup instead of blocking the first window on the complete editing stack:

- Electron displays a lightweight native startup shell before loading the embedded application server.
- The server starts in parallel, while GPU discovery continues asynchronously after the editor becomes usable.
- Models, thumbnails, updater checks, and the packaged render runtime are deferred until the relevant feature or post-startup window needs them.
- Renderer surfaces and dashboard dialogs stay behind lazy boundaries so the full editor graph is not part of the initial dashboard load.
- Desktop smoke tests use a unique temporary profile and data directory, preventing tests from touching a user's projects, credentials, media, or live YoloCut process.

On the Windows release-verification machine, the unpacked build displayed its native shell in about **85 ms**, brought up the embedded server in about **0.72 s**, and loaded the first renderer in about **2.79 s** on a cold run; a warmed renderer loaded in about **0.51 s**. These are diagnostic measurements from one machine, not cross-device guarantees. Set `YOLOCUT_STARTUP_TRACE=1` when launching the desktop build to print stage timings for another system.

## Download

| Platform | v0.0.2 package |
|---|---|
| Windows x64 | [YoloCut-v0.0.2-x64.exe](https://github.com/Hhz0823/YoloCut/releases/download/v0.0.2/YoloCut-v0.0.2-x64.exe) |
| macOS Apple Silicon | [YoloCut-v0.0.2-arm64.dmg](https://github.com/Hhz0823/YoloCut/releases/download/v0.0.2/YoloCut-v0.0.2-arm64.dmg) |
| macOS Intel | [YoloCut-v0.0.2-x64.dmg](https://github.com/Hhz0823/YoloCut/releases/download/v0.0.2/YoloCut-v0.0.2-x64.dmg) |
| Linux x64 | [YoloCut-v0.0.2-x86_64.AppImage](https://github.com/Hhz0823/YoloCut/releases/download/v0.0.2/YoloCut-v0.0.2-x86_64.AppImage) |
| Checksums | [SHA256SUMS.txt](https://github.com/Hhz0823/YoloCut/releases/download/v0.0.2/SHA256SUMS.txt) |

Every package in this table is built and smoke-tested on its native GitHub Actions runner. Windows packages are currently unsigned, macOS packages are ad-hoc signed but not notarized, and Linux AppImages are unsigned. Verify the published SHA-256 values before running a package.

## Run from source

Requires Node.js `>=24 <25` and npm.

```bash
git clone https://github.com/Hhz0823/YoloCut.git
cd YoloCut
npm install
cp .env.example .env.local
npm run dev
```

Desktop development and Windows packaging:

```bash
npm run desktop:dev
npm run desktop:dist:win
```

Development profiles isolate projects, media, credentials, tasks, and settings per Git checkout/worktree. Configure only the AI or media providers you actually intend to use.

## Data and security

- Projects, chat, versions, indexes, and settings are local by default under `~/.yolocut`.
- Existing legacy data roots can be mounted by the migration layer so users do not lose earlier projects.
- Provider keys stay on the service side and are not exposed through `VITE_` browser variables.
- MCP binds to loopback by default and requires a generated Bearer token.
- Directory access uses opaque grants; absolute local paths do not cross the desktop IPC boundary into Agent tools.
- AI traffic leaves the computer only for providers the user explicitly configures.
- YoloCut targets a single-user desktop workflow, not an unisolated multi-tenant server deployment.

## Architecture and verification

| Layer | Main responsibilities |
|---|---|
| `src/editor/` | Immutable timeline state and editing commands |
| `src/agent/` | Agent runtime, tools, Skills, proposals, approval, and progress |
| `src/gl/` | WebGL effects, transitions, and shader runtime |
| `src/transcript/`, `src/captions/` | ASR, transcript editing, captions, and translation |
| `src/persist/` | Projects, versions, media metadata, and batch jobs |
| `server/` | Local HTTP, MCP, models, media processing, jobs, and exports |
| `desktop/` | Staged Electron startup, windows, hardware probing, secure storage, and native IPC |
| `remotion/` | Headless rendering and deliverable exports |

```bash
npm test                         # full regression suite
npm run build                    # type checking and production build
npm run lint                     # static analysis
npm run verify:architecture      # enforced dependency boundaries
npm run verify:mcp               # Agent/MCP contract checks
npm run verify:media-performance # codecs, proxies, acceleration, fallbacks
npm run verify:auto-edit         # batch auto-edit contracts
npm run desktop:smoke             # embedded server and desktop bridge
npm run desktop:smoke:render      # real packaged rendering path
npm run desktop:smoke:post-startup # deferred startup work
npm run desktop:smoke:agent-window
```

## Current release boundaries

YoloCut `0.0.2` is an early public release. Core editing, Agent, MCP, batch, desktop packaging, and local model management are actively verified, but several surfaces remain experimental:

- Fish S2, SmolVLM2, and some GPU paths depend on local runtimes and drivers.
- The project format and Agent catalog will continue to evolve; back up important projects before upgrades.
- Signing and notarization are not yet production-grade.
- A configured provider or installed model is required for its corresponding AI feature; manual editing remains available without one.

See [CHANGELOG.md](CHANGELOG.md) for version history and [GitHub Releases](https://github.com/Hhz0823/YoloCut/releases) for published artifacts.

## License, provenance, and contributing

YoloCut is independently maintained by [hhz0823](https://github.com/Hhz0823) and licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).

The codebase continues from the AGPL-licensed [0xsline/OpenChatCut](https://github.com/0xsline/OpenChatCut) project. This attribution preserves source and license provenance; upstream branding, contributors, community channels, and commercial relationships are not part of the YoloCut product or its public release history.

Third-party libraries, models, fonts, skills, and bundled binaries retain their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [`src/agent/skills/NOTICE.md`](src/agent/skills/NOTICE.md), and [`assets/fonts/LICENSES.md`](assets/fonts/LICENSES.md).

- Issues: [github.com/Hhz0823/YoloCut/issues](https://github.com/Hhz0823/YoloCut/issues)
- Releases: [github.com/Hhz0823/YoloCut/releases](https://github.com/Hhz0823/YoloCut/releases)
- Agent guide: [YOLOCUT_AGENT_CONNECTION.md](YOLOCUT_AGENT_CONNECTION.md)
