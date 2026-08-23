import { Menu, type BrowserWindow } from 'electron';
import { Agent, fetch as undiciFetch } from 'undici';
import { externalMcpToken } from '../server/editor-auth.ts';
import { runDesktopMcpRecoverySmoke } from './smoke-mcp-recovery.ts';
import { runDesktopAgentWorkbenchSmoke } from './smoke-agent-workbench.ts';

const RENDER_DRAIN_MS = 500;
// The server installs a global outbound ProxyAgent so provider requests follow
// the user's proxy configuration. Desktop smoke requests are loopback traffic
// and must stay direct even when that proxy intentionally ignores NO_PROXY.
const LOOPBACK_DISPATCHER = new Agent();

export async function runDesktopSmokeProbe(
  origin: string,
  win: BrowserWindow,
  render: boolean,
): Promise<void> {
  const res = await undiciFetch(`${origin}/api/keys`, { dispatcher: LOOPBACK_DISPATCHER });
  if (!res.ok) throw new Error(`/api/keys → HTTP ${res.status}`);
  const mcp = await undiciFetch(`${origin}/api/external-mcp/mcp`, {
    dispatcher: LOOPBACK_DISPATCHER,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${externalMcpToken()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'desktop-smoke', version: '1' },
      },
    }),
  });
  if (!mcp.ok || !(await mcp.text()).includes('"name":"yolocut"')) {
    throw new Error(`/api/external-mcp/mcp → HTTP ${mcp.status}`);
  }
  console.log('[smoke] external MCP endpoint ok');
  const migration = await undiciFetch(`${origin}/api/project-store/migrate-status`, {
    dispatcher: LOOPBACK_DISPATCHER,
    headers: { 'Sec-Fetch-Site': 'same-origin' },
  });
  const migrationContentType = migration.headers.get('content-type') ?? '';
  if (!migration.ok || !migrationContentType.toLowerCase().includes('application/json')) {
    throw new Error(
      `/api/project-store/migrate-status → HTTP ${migration.status} ${migrationContentType || '(no content type)'}`,
    );
  }
  const migrationStatus = await migration.json() as { enabled?: unknown; phase?: unknown };
  if (typeof migrationStatus.enabled !== 'boolean'
    || !['legacy', 'migrating', 'complete', 'failed'].includes(String(migrationStatus.phase))) {
    throw new Error('/api/project-store/migrate-status returned an invalid status');
  }
  console.log(`[smoke] SQLite migration endpoint ok (${String(migrationStatus.phase)})`);
  if (process.env.CC_SMOKE_MCP_RECOVERY === '1') {
    await runDesktopMcpRecoverySmoke(origin, externalMcpToken());
  }
  const pickerType = await win.webContents.executeJavaScript(
    'typeof window.yoloCutDesktop?.selectDirectory',
  ) as unknown;
  if (pickerType !== 'function') throw new Error('desktop directory picker preload is unavailable');
  console.log('[smoke] desktop directory picker preload ok');
  const autoEditSourceBridge = await win.webContents.executeJavaScript(
    "['selectAutoEditSources','listAutoEditSources','importAutoEditSource'].map((name) => typeof window.yoloCutDesktop?.[name])",
  ) as unknown;
  if (!Array.isArray(autoEditSourceBridge) || autoEditSourceBridge.some((type) => type !== 'function')) {
    throw new Error('desktop auto-edit source grant preload is unavailable');
  }
  console.log('[smoke] desktop auto-edit source grant preload ok');
  const localeType = await win.webContents.executeJavaScript(
    'typeof window.yoloCutDesktop?.setLocale',
  ) as unknown;
  if (localeType !== 'function') throw new Error('desktop locale preload is unavailable');
  const initialLocale = await win.webContents.executeJavaScript(
    "document.documentElement.lang === 'en' ? 'en' : 'zh'",
  ) as 'zh' | 'en';
  try {
    for (const [locale, expectedLabels] of [
      ['zh', ['文件', '编辑', '视图', '窗口']],
      ['en', ['File', 'Edit', 'View', 'Window']],
    ] as const) {
      await win.webContents.executeJavaScript(`window.yoloCutDesktop.setLocale('${locale}')`);
      const actualLabels = Menu.getApplicationMenu()?.items.map((item) => item.label).slice(-4);
      if (JSON.stringify(actualLabels) !== JSON.stringify(expectedLabels)) {
        throw new Error(`desktop ${locale} menu labels are unavailable: ${JSON.stringify(actualLabels)}`);
      }
    }
  } finally {
    await win.webContents.executeJavaScript(`window.yoloCutDesktop.setLocale('${initialLocale}')`);
  }
  console.log('[smoke] desktop native menu localization ok');
  const updaterType = await win.webContents.executeJavaScript(
    'typeof window.yoloCutDesktop?.updates?.check',
  ) as unknown;
  if (updaterType !== 'function') throw new Error('desktop updater preload is unavailable');
  console.log('[smoke] desktop updater preload ok');
  // Editor bridge heartbeat (issue #86): the long poll is timer-driven, so
  // background throttling must be off or minimizing the window drops the
  // MCP bridge offline. Assert the RUNTIME value, not just the source flag.
  const throttlingDisabled = win.webContents.getBackgroundThrottling();
  if (throttlingDisabled !== false) {
    throw new Error(`background throttling is enabled (${String(throttlingDisabled)}); the MCP bridge heartbeat will stall in background windows`);
  }
  console.log('[smoke] background throttling disabled (bridge heartbeat safe)');
  const inference = await win.webContents.executeJavaScript(
    'window.yoloCutDesktop?.inference?.getCapabilities()',
  ) as {
    version?: unknown;
    asr?: { available?: unknown };
    semantic?: { available?: unknown };
    clap?: { available?: unknown };
    rhythm?: { available?: unknown };
    hardware?: {
      cpu?: { logicalCores?: unknown; totalMemoryBytes?: unknown };
      gpus?: unknown;
      hardwareAcceleration?: unknown;
    };
  } | null;
  if (inference?.version !== 3
    || typeof inference.asr?.available !== 'boolean'
    || typeof inference.semantic?.available !== 'boolean'
    || typeof inference.clap?.available !== 'boolean'
    || typeof inference.rhythm?.available !== 'boolean'
    || !Array.isArray(inference.hardware?.gpus)
    || typeof inference.hardware?.cpu?.logicalCores !== 'number'
    || typeof inference.hardware?.cpu?.totalMemoryBytes !== 'number'
    || typeof inference.hardware?.hardwareAcceleration !== 'boolean') {
    throw new Error('desktop native inference preload is unavailable');
  }
  console.log('[smoke] desktop native inference preload ok');
  if (process.env.CC_SMOKE_AGENT_WINDOW === '1') {
    await runDesktopAgentWorkbenchSmoke(win);
  }
  if (!render) return;
  const state = { fps: 30, width: 640, height: 360, items: [], selectedId: null };
  const response = await undiciFetch(`${origin}/render-still`, {
    dispatcher: LOOPBACK_DISPATCHER,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
    },
    body: JSON.stringify({ state, frames: [0] }),
  });
  if (!response.ok) {
    throw new Error(`/render-still → HTTP ${response.status}: ${await response.text()}`);
  }
  const rendered = (await response.json()) as { frames?: Array<{ base64?: string }> };
  if (!rendered.frames?.[0]?.base64) throw new Error('/render-still returned no frame');
  console.log(`[smoke] render-still ok, base64 ${rendered.frames[0].base64.length}B`);
  // Remotion can emit late DevTools protocol callbacks after the response.
  await new Promise((resolve) => setTimeout(resolve, RENDER_DRAIN_MS));
}
