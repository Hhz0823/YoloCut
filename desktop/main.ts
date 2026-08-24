import './chdir-first.ts';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  shell,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import { buildTextContextMenuTemplate } from './context-menu.ts';
import { buildApplicationMenuTemplate } from './application-menu.ts';
import { createTransparentMovProxy, importLocalMedia } from './local-media-import.ts';
import {
  createLocalMediaImportHandler,
  LOCAL_MEDIA_IMPORT_CHANNEL,
} from './local-media-bridge.ts';
import { installEditorAuthIpc } from './editor-auth-ipc.ts';
import { installDesktopUpdateIpc } from './update-ipc.ts';
import { supportsDirectDesktopUpdates } from './update-service.ts';
import { installDesktopInferenceIpc } from './native-inference-ipc.ts';
import {
  detectDesktopHardwareProfile,
  snapshotDesktopHardwareProfile,
} from './native-hardware-profile.ts';
import { installDirectoryWatchIpc } from './directory-watch-ipc.ts';
import { importAgentPaths } from './agent-path-import.ts';
import { AutoEditSourceGrantStore } from './auto-edit-source-grants.ts';
import { getKey, setKeys } from '../server/keystore.ts';
import { AGENT_PATH_IMPORT_CHANNEL } from '../shared/directory-import.ts';
import {
  AUTO_EDIT_SOURCE_CHANNELS,
  isAutoEditSourceImportRequest,
} from '../shared/auto-edit-source.ts';
import {
  AGENT_WORKBENCH_CHANNELS,
  isAgentWorkbenchDockRequest,
  isAgentWorkbenchRequest,
  nativeAgentDockDecision,
  type AgentDockSide,
  type AgentWorkbenchDetachPoint,
  type AgentWorkbenchRequest,
  type AgentWorkbenchState,
} from '../shared/agent-workbench.ts';
import { isTranscriptWindowPayload, TRANSCRIPT_WINDOW_CHANNELS, type TranscriptWindowPayload } from '../shared/transcript-window.ts';
import {
  assertTrustedDesktopSenderUrl,
  resolveDesktopDevOrigin,
  resolveDesktopPageUrlDecision,
} from './page-origin.ts';
import type { DesktopPageUrlDecision, DesktopPageUrlSurface } from './page-origin.ts';
import { preparePackagedRuntime } from './packaged-runtime.ts';
import { focusExistingWindow } from './single-instance.ts';
import { requestProfileScopedSingleInstanceLock } from './runtime-profile.ts';
import { applyDesktopWindowFrame, desktopWindowFrameOptions } from './window-frame.ts';
import { applyResponsiveWindowScale, DESKTOP_UI_SCALE_MAX, DESKTOP_UI_SCALE_MIN, installResponsiveWindowScale, parseUserUiScale } from './window-scale.ts';
import { resolveInitialDesktopWindowBounds } from './window-scale.ts';
import {
  createExportDirectoryGrant,
  type ExportDirectoryGrantDescriptor,
} from '../server/export-destinations.ts';
import { resolveExportRevealTarget } from './export-reveal.ts';
import {
  persistExportDirectory,
  resolvePersistedExportDestination,
  restorePersistedExportDirectory,
  validatedDirectory,
  validDesktopExportFilename,
} from './export-directory-state.ts';
import { runtimeProfile } from '../server/runtime-profile.ts';
import { PRODUCT_NAME } from '../shared/product-brand.ts';
import {
  DESKTOP_LOCALE_CHANNEL,
  isDesktopLocale,
  type DesktopLocale,
} from '../shared/desktop-locale.ts';
import { setRenderRuntimeReadinessProvider } from '../server/render-runtime-readiness.ts';

// Electron main process entry. dev mode: esbuild hits desktop-dist/main.mjs,dist/ in the codebase root;
// Packaging form: dist/, resonance-bundle, chrome-headless-shell use extraResources.
const DIST_DIR = app.isPackaged
  ? join(process.resourcesPath, 'dist')
  : join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const PRELOAD_PATH = join(dirname(fileURLToPath(import.meta.url)), 'preload.cjs');

// Remotion renders export frames inside this process (main + headless tabs).
// Raise the V8 heap ceiling so large/4K exports don't die with "out of memory"
// (issue #40). Must run before app 'ready'; js-flags apply to every V8 instance.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=6144');

// CC_SMOKE=1: No window smoke - start the embedded server, load the page, explore /api/keys, and return the code 0/1 according to the result.
// CC_SMOKE_RENDER=1 adds a true rendering probe (packaged version acceptance: pre-bundled + full browser link included in the package).
const SMOKE = process.env.CC_SMOKE === '1';
const SMOKE_RENDER = process.env.CC_SMOKE_RENDER === '1';
const STARTUP_TRACE = process.env.YOLOCUT_STARTUP_TRACE === '1';
const STARTUP_STARTED_AT = performance.now();
const SMOKE_TIMEOUT_MS = SMOKE_RENDER ? 240_000 : 90_000;
const PACKAGED_RENDER_WARMUP_DELAY_MS = 10_000;
const STARTUP_SHELL_URL = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="color-scheme" content="dark">
<style>
html,body{height:100%;margin:0;background:#1c1c1e;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{display:grid;place-items:center}.shell{display:flex;align-items:center;gap:12px;padding:18px 22px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:#2c2c2e}
.mark{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:#3a3a3c;font-weight:700}.name{font-size:16px;font-weight:650}.status{margin-top:3px;color:#a1a1a6;font-size:12px}
</style></head><body><div class="shell"><div class="mark">Y</div><div><div class="name">YoloCut</div><div class="status">正在启动剪辑工作台…</div></div></div></body></html>`)}`;
let mainWindow: BrowserWindow | null = null;
let agentWorkbenchWindow: BrowserWindow | null = null;
let agentWorkbenchState: AgentWorkbenchState = {
  placement: 'right',
  dockSide: 'right',
  projectId: null,
  dockPreview: null,
};
let agentWorkbenchCloseForDock = false;
let agentWorkbenchPendingDock: AgentWorkbenchRequest | null = null;
let desktopLocale: DesktopLocale = 'zh';

function traceStartup(stage: string, details?: unknown): void {
  if (!STARTUP_TRACE) return;
  const elapsed = Math.round((performance.now() - STARTUP_STARTED_AT) * 10) / 10;
  console.log(
    `[startup] ${stage} +${elapsed}ms${details === undefined ? '' : ` ${JSON.stringify(details)}`}`,
  );
}

function applyApplicationMenu(locale: DesktopLocale): void {
  desktopLocale = locale;
  Menu.setApplicationMenu(Menu.buildFromTemplate(
    buildApplicationMenuTemplate(locale, process.platform, PRODUCT_NAME),
  ));
}

type DesktopIpcHandler = Parameters<typeof ipcMain.handle>[1];

function trustedDesktopHandler(
  trustedOrigin: string,
  handler: DesktopIpcHandler,
): DesktopIpcHandler {
  return (event, ...args) => {
    assertTrustedDesktopSenderUrl(event.senderFrame?.url ?? '', trustedOrigin);
    return handler(event, ...args);
  };
}

function handOffExternalUrl(decision: DesktopPageUrlDecision): void {
  if (decision.action !== 'open-external') return;
  void shell.openExternal(decision.url).catch((error: unknown) => {
    console.error('[desktop] failed to open external URL:', error);
  });
}

function installDesktopPageGuards(win: BrowserWindow, trustedOrigin: string): void {
  const guardNavigation = (surface: Extract<DesktopPageUrlSurface, 'navigation' | 'redirect'>) => (
    event: { preventDefault(): void },
    requestedUrl: string,
  ): void => {
    const decision = resolveDesktopPageUrlDecision(requestedUrl, trustedOrigin, surface);
    if (decision.action === 'allow') return;
    event.preventDefault();
    handOffExternalUrl(decision);
  };

  win.webContents.on('will-navigate', guardNavigation('navigation'));
  win.webContents.on('will-redirect', guardNavigation('redirect'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    const decision = resolveDesktopPageUrlDecision(url, trustedOrigin, 'popup');
    handOffExternalUrl(decision);
    return { action: 'deny' };
  });
}

function sendAgentWorkbenchState(): void {
  const targets = [mainWindow, agentWorkbenchWindow];
  for (const target of targets) {
    if (!target || target.isDestroyed()) continue;
    target.webContents.send(AGENT_WORKBENCH_CHANNELS.state, agentWorkbenchState);
  }
}

function updateAgentWorkbenchState(patch: Partial<AgentWorkbenchState>): AgentWorkbenchState {
  agentWorkbenchState = { ...agentWorkbenchState, ...patch };
  sendAgentWorkbenchState();
  return agentWorkbenchState;
}

function agentWorkbenchBounds(detachAt?: AgentWorkbenchDetachPoint): { width: number; height: number; x?: number; y?: number } {
  // Agent conversations, tool calls, batch-edit plans, and referenced media
  // need horizontal room. Keep the detached workbench compact, but default to
  // a landscape window instead of the former phone-like 560 x 760 shape.
  const preferredWidth = 860;
  const preferredHeight = 640;
  const ownerBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
  if (!ownerBounds && !detachAt) return { width: preferredWidth, height: preferredHeight };
  const workArea = detachAt
    ? screen.getDisplayNearestPoint({ x: Math.round(detachAt.screenX), y: Math.round(detachAt.screenY) }).workArea
    : screen.getDisplayMatching(ownerBounds!).workArea;
  const width = Math.min(preferredWidth, Math.max(380, workArea.width - 24));
  const height = Math.min(preferredHeight, Math.max(480, workArea.height - 24));
  if (detachAt) {
    return {
      width,
      height,
      x: Math.max(workArea.x, Math.min(
        workArea.x + workArea.width - width,
        Math.round(detachAt.screenX - 80),
      )),
      y: Math.max(workArea.y, Math.min(
        workArea.y + workArea.height - height,
        Math.round(detachAt.screenY - 24),
      )),
    };
  }
  if (!ownerBounds) return { width, height };
  const gap = 16;
  const y = Math.max(workArea.y, Math.min(
    workArea.y + workArea.height - height,
    ownerBounds.y + Math.max(28, Math.round((ownerBounds.height - height) / 2)),
  ));
  const right = ownerBounds.x + ownerBounds.width + gap;
  if (right + width <= workArea.x + workArea.width) return { width, height, x: right, y };
  const left = ownerBounds.x - width - gap;
  if (left >= workArea.x) return { width, height, x: left, y };
  return {
    width,
    height,
    x: Math.max(workArea.x, Math.min(workArea.x + workArea.width - width, ownerBounds.x + ownerBounds.width - width - 36)),
    y,
  };
}

function closeAgentWorkbenchForDock(): void {
  const win = agentWorkbenchWindow;
  const pendingDock = agentWorkbenchPendingDock;
  if (!win || win.isDestroyed() || !pendingDock) return;
  agentWorkbenchCloseForDock = true;
  setTimeout(() => {
    if (win.isDestroyed()) return;
    if (agentWorkbenchPendingDock !== pendingDock) {
      agentWorkbenchCloseForDock = false;
      return;
    }
    // Let the renderer observe the dock state first so it can flush its draft
    // and mark this close as an intentional host transfer.
    win.close();
    setTimeout(() => {
      if (!win.isDestroyed() && agentWorkbenchPendingDock === pendingDock) win.destroy();
    }, 500).unref();
  }, 80).unref();
}

function dockAgentWorkbench(projectId: string, dockSide: AgentDockSide): AgentWorkbenchState {
  if (agentWorkbenchWindow && !agentWorkbenchWindow.isDestroyed()) {
    agentWorkbenchPendingDock = { projectId, dockSide };
    updateAgentWorkbenchState({ placement: 'detached', dockSide, projectId, dockPreview: dockSide });
    closeAgentWorkbenchForDock();
  } else {
    agentWorkbenchPendingDock = null;
    updateAgentWorkbenchState({ placement: dockSide, dockSide, projectId, dockPreview: null });
    if (!SMOKE) {
      mainWindow?.show();
      mainWindow?.focus();
    }
  }
  return agentWorkbenchState;
}

function openAgentWorkbenchWindow(trustedOrigin: string, request: AgentWorkbenchRequest): AgentWorkbenchState {
  agentWorkbenchPendingDock = null;
  updateAgentWorkbenchState({
    placement: 'detached',
    dockSide: request.dockSide,
    projectId: request.projectId,
    dockPreview: null,
  });
  const existing = agentWorkbenchWindow;
  if (existing && !existing.isDestroyed()) {
    const expected = new URL(`${trustedOrigin}/`);
    expected.searchParams.set('agent-window', '1');
    expected.searchParams.set('projectId', request.projectId);
    if (existing.webContents.getURL() !== expected.href) void existing.loadURL(expected.href);
    if (!SMOKE) {
      existing.show();
      existing.focus();
    }
    return agentWorkbenchState;
  }

  const bounds = agentWorkbenchBounds(request.detachAt);
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 380,
    minHeight: 480,
    backgroundColor: '#1c1c1e',
    title: 'YoloCut Agent',
    autoHideMenuBar: true,
    show: false,
    ...desktopWindowFrameOptions(),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  agentWorkbenchWindow = win;
  applyDesktopWindowFrame(win);
  installResponsiveWindowScale(win);
  installDesktopPageGuards(win, trustedOrigin);

  let nativeAgentDockArmed = false;
  const previewDock = (): AgentDockSide | null => {
    const owner = mainWindow;
    if (!owner || owner.isDestroyed() || owner.isMinimized()) return null;
    const decision = nativeAgentDockDecision(
      owner.getBounds(),
      screen.getCursorScreenPoint(),
      nativeAgentDockArmed,
    );
    nativeAgentDockArmed = decision.armed;
    return decision.target;
  };
  win.on('will-move', () => {
    const dockPreview = previewDock();
    if (dockPreview !== agentWorkbenchState.dockPreview) updateAgentWorkbenchState({ dockPreview });
  });
  win.on('moved', () => {
    const side = previewDock();
    if (side && agentWorkbenchState.projectId) {
      dockAgentWorkbench(agentWorkbenchState.projectId, side);
    } else if (agentWorkbenchState.dockPreview) {
      updateAgentWorkbenchState({ dockPreview: null });
    }
  });
  win.once('closed', () => {
    if (agentWorkbenchWindow === win) agentWorkbenchWindow = null;
    const dockedByRequest = agentWorkbenchCloseForDock;
    agentWorkbenchCloseForDock = false;
    const pendingDock = agentWorkbenchPendingDock;
    if (dockedByRequest && pendingDock) {
      if (!mainWindow || mainWindow.isDestroyed()) {
        agentWorkbenchPendingDock = null;
        return;
      }
      setTimeout(() => {
        if (agentWorkbenchPendingDock !== pendingDock || agentWorkbenchWindow) return;
        agentWorkbenchPendingDock = null;
        updateAgentWorkbenchState({
          placement: pendingDock.dockSide,
          dockSide: pendingDock.dockSide,
          projectId: pendingDock.projectId,
          dockPreview: null,
        });
        if (!SMOKE) {
          mainWindow?.show();
          mainWindow?.focus();
        }
      }, 120).unref();
      return;
    }
    // If the user detached again while a beforeunload-delayed dock close was
    // still resolving, replace the closing window instead of leaving the
    // shared state stuck at "detached" with no native host.
    if (dockedByRequest
      && agentWorkbenchState.placement === 'detached'
      && agentWorkbenchState.projectId
      && mainWindow && !mainWindow.isDestroyed()) {
      openAgentWorkbenchWindow(trustedOrigin, {
        projectId: agentWorkbenchState.projectId,
        dockSide: agentWorkbenchState.dockSide,
      });
      return;
    }
    if (!dockedByRequest && agentWorkbenchState.placement === 'detached') {
      updateAgentWorkbenchState({
        placement: agentWorkbenchState.dockSide,
        dockPreview: null,
      });
    }
  });

  const url = new URL(`${trustedOrigin}/`);
  url.searchParams.set('agent-window', '1');
  url.searchParams.set('projectId', request.projectId);
  void win.loadURL(url.href).then(() => {
    if (win.isDestroyed()) return;
    if (!SMOKE) win.show();
    sendAgentWorkbenchState();
  });
  return agentWorkbenchState;
}

function registerDesktopHandlers(trustedOrigin: string): void {
  const autoEditSources = new AutoEditSourceGrantStore(
    join(app.getPath('userData'), 'auto-edit-source-grants.json'),
  );
  ipcMain.handle(DESKTOP_LOCALE_CHANNEL, trustedDesktopHandler(trustedOrigin, (_event, value: unknown) => {
    if (!isDesktopLocale(value)) throw new Error('invalid desktop locale');
    applyApplicationMenu(value);
  }));
  ipcMain.handle('yolocut:select-directory', trustedDesktopHandler(trustedOrigin, async (event, requestedPath: unknown) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const requested = typeof requestedPath === 'string' && isAbsolute(requestedPath)
      ? requestedPath
      : app.getPath('videos');
    const options: OpenDialogOptions = {
      title: '选择素材保存目录',
      defaultPath: requested,
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }));
  ipcMain.handle(AUTO_EDIT_SOURCE_CHANNELS.select, trustedDesktopHandler(trustedOrigin, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: '选择批量自动剪辑素材目录',
      defaultPath: app.getPath('videos'),
      properties: ['openDirectory'],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    return autoEditSources.grantDirectory(result.filePaths[0]);
  }));
  ipcMain.handle(AUTO_EDIT_SOURCE_CHANNELS.list, trustedDesktopHandler(trustedOrigin, async (_event, grantId: unknown) => {
    if (typeof grantId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(grantId)) {
      throw new Error('invalid auto-edit source grant id');
    }
    return autoEditSources.selection(grantId);
  }));
  ipcMain.handle(AUTO_EDIT_SOURCE_CHANNELS.import, trustedDesktopHandler(trustedOrigin, async (_event, request: unknown) => {
    if (!isAutoEditSourceImportRequest(request)) throw new Error('invalid auto-edit source import request');
    return autoEditSources.importSource(request);
  }));
  const exportStatePath = join(app.getPath('userData'), 'export-destination.json');
  let activeExportDirectory: {
    directory: string;
    grant: ExportDirectoryGrantDescriptor;
  } | null = null;
  ipcMain.handle('yolocut:select-export-directory', trustedDesktopHandler(trustedOrigin, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: '选择导出目录',
      defaultPath: app.getPath('videos'),
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const directory = await validatedDirectory(result.filePaths[0]);
    if (!directory) throw new Error('所选导出目录不可用');
    const grant = createExportDirectoryGrant(directory);
    activeExportDirectory = { directory, grant };
    await persistExportDirectory(exportStatePath, directory, grant.grantId);
    return grant;
  }));
  ipcMain.handle('yolocut:select-export-file', trustedDesktopHandler(trustedOrigin, async (
    event,
    suggestedFilename: unknown,
  ) => {
    if (!validDesktopExportFilename(suggestedFilename)) {
      throw new Error('invalid export filename');
    }
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: SaveDialogOptions = {
      title: '选择导出文件',
      defaultPath: join(app.getPath('videos'), suggestedFilename),
    };
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    const filename = basename(result.filePath);
    if (!validDesktopExportFilename(filename)) throw new Error('导出文件名无效');
    const directory = await validatedDirectory(dirname(result.filePath));
    if (!directory) throw new Error('所选导出目录不可用');
    const grant = createExportDirectoryGrant(directory);
    activeExportDirectory = { directory, grant };
    await persistExportDirectory(exportStatePath, directory, grant.grantId);
    return { ...grant, label: filename, filename };
  }));
  ipcMain.handle('yolocut:restore-export-directory', trustedDesktopHandler(trustedOrigin, async () => {
    const restored = await restorePersistedExportDirectory(exportStatePath);
    if (!restored) return null;
    if (activeExportDirectory?.directory === restored.directory) {
      return activeExportDirectory.grant;
    }
    const grant = createExportDirectoryGrant(restored.directory);
    activeExportDirectory = { directory: restored.directory, grant };
    await persistExportDirectory(exportStatePath, restored.directory, grant.grantId, restored.state);
    return grant;
  }));
  ipcMain.handle(
    LOCAL_MEDIA_IMPORT_CHANNEL,
    trustedDesktopHandler(trustedOrigin, createLocalMediaImportHandler(importLocalMedia)),
  );
  ipcMain.handle('yolocut:transparent-mov-proxy', trustedDesktopHandler(trustedOrigin, async (_event, storedName: unknown) => {
    if (typeof storedName !== 'string') throw new Error('invalid local media name');
    return createTransparentMovProxy(storedName);
  }));
  let transcriptWindow: BrowserWindow | null = null;
  const openTranscriptWindow = (payload: TranscriptWindowPayload): void => {
    if (transcriptWindow && !transcriptWindow.isDestroyed()) {
      transcriptWindow.webContents.send(TRANSCRIPT_WINDOW_CHANNELS.update, payload);
      transcriptWindow.show();
      transcriptWindow.focus();
      return;
    }
    const win = new BrowserWindow({
      width: 420,
      height: 560,
      minWidth: 300,
      minHeight: 220,
      backgroundColor: '#1c1c1e',
      title: '文字稿',
      show: false,
      webPreferences: {
        preload: PRELOAD_PATH,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        // The editor bridge heartbeat is a timer-driven long poll; without
        // this, Electron throttles background windows and the MCP bridge
        // drops offline (connected:false) while the window is minimized.
        backgroundThrottling: false,
      },
    });
    transcriptWindow = win;
    win.once('closed', () => {
      if (transcriptWindow === win) transcriptWindow = null;
    });
    installDesktopPageGuards(win, trustedOrigin);
    void win.loadURL(`${trustedOrigin}/?transcript-window=1`).then(() => {
      if (win.isDestroyed()) return;
      win.webContents.send(TRANSCRIPT_WINDOW_CHANNELS.update, payload);
      win.show();
    });
  };
  ipcMain.handle(TRANSCRIPT_WINDOW_CHANNELS.open, trustedDesktopHandler(trustedOrigin, (_event, value: unknown) => {
    if (!isTranscriptWindowPayload(value)) throw new Error('invalid transcript window payload');
    openTranscriptWindow(value);
  }));
  ipcMain.handle(AGENT_WORKBENCH_CHANNELS.getState, trustedDesktopHandler(trustedOrigin, () => (
    agentWorkbenchState
  )));
  ipcMain.handle(AGENT_WORKBENCH_CHANNELS.detach, trustedDesktopHandler(trustedOrigin, (_event, value: unknown) => {
    if (!isAgentWorkbenchRequest(value)) throw new Error('invalid Agent workbench request');
    return openAgentWorkbenchWindow(trustedOrigin, value);
  }));
  ipcMain.handle(AGENT_WORKBENCH_CHANNELS.dock, trustedDesktopHandler(trustedOrigin, (_event, value: unknown) => {
    if (!isAgentWorkbenchDockRequest(value)) throw new Error('invalid Agent dock request');
    return dockAgentWorkbench(value.projectId, value.dockSide);
  }));
  ipcMain.handle('yolocut:window-action', trustedDesktopHandler(trustedOrigin, (event, action: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || typeof action !== 'string') return;
    if (action === 'close') win.close();
    else if (action === 'minimize') win.minimize();
    else if (action === 'toggle-maximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'apply-ui-scale') {
      applyResponsiveWindowScale(win);
    }
  }));
  // Zoom accelerators (issue #85): step the saved UI scale and re-apply.
  ipcMain.handle('yolocut:zoom-step', trustedDesktopHandler(trustedOrigin, async (event, step: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (step !== 'reset' && (typeof step !== 'number' || step === 0)) throw new Error('invalid zoom step');
    const current = parseUserUiScale(getKey('UI_SCALE' as never));
    const next = step === 'reset'
      ? 1
      : Math.min(DESKTOP_UI_SCALE_MAX, Math.max(DESKTOP_UI_SCALE_MIN, Math.round((current + step) * 100) / 100));
    await setKeys({ UI_SCALE: String(next) });
    applyResponsiveWindowScale(win);
    win.webContents.send('yolocut:ui-scale-changed', next);
  }));
  ipcMain.handle('yolocut:reveal-export', trustedDesktopHandler(trustedOrigin, async (
    _event,
    destinationId: unknown,
    filename: unknown,
  ) => {
    const target = await resolveExportRevealTarget(
      destinationId,
      filename,
      (identity) => resolvePersistedExportDestination(exportStatePath, identity),
    );
    if (!target) throw new Error('export destination is unavailable');
    if (target.candidate && existsSync(target.candidate)) {
      shell.showItemInFolder(target.candidate);
      return;
    }
    const error = await shell.openPath(target.directory);
    if (error) throw new Error(error);
  }));
}


async function boot(): Promise<void> {
  await app.whenReady();
  traceStartup('electron-ready');
  applyApplicationMenu(desktopLocale);

  const initialBounds = resolveInitialDesktopWindowBounds(screen.getPrimaryDisplay().workArea);
  const win = new BrowserWindow({
    ...initialBounds,
    show: !SMOKE,
    backgroundColor: '#1c1c1e',
    title: PRODUCT_NAME,
    ...desktopWindowFrameOptions(),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // Keep the editor bridge heartbeat alive while the window is backgrounded.
      backgroundThrottling: false,
    },
  });
  applyDesktopWindowFrame(win);
  installResponsiveWindowScale(win);
  mainWindow = win;
  traceStartup('native-window-created');
  win.once('closed', () => {
    mainWindow = null;
    if (agentWorkbenchWindow && !agentWorkbenchWindow.isDestroyed()) {
      agentWorkbenchCloseForDock = true;
      agentWorkbenchWindow.close();
    }
  });
  win.webContents.on('context-menu', (_event, params) => {
    const template = buildTextContextMenuTemplate(params, desktopLocale);
    if (!template.length) return;
    Menu.buildFromTemplate(template).popup({ window: win });
  });
  if (!SMOKE) {
    void win.loadURL(STARTUP_SHELL_URL)
      .then(() => traceStartup('startup-shell-loaded'))
      .catch(() => undefined);
  }

  let packagedRuntimePromise: Promise<void> | null = null;
  const ensurePackagedRenderRuntime = (): Promise<void> => {
    if (!app.isPackaged) return Promise.resolve();
    if (!packagedRuntimePromise) {
      packagedRuntimePromise = preparePackagedRuntime({
        resourcesPath: process.resourcesPath,
        userDataPath: app.getPath('userData'),
        version: app.getVersion(),
      }).catch((error) => {
        packagedRuntimePromise = null;
        throw error;
      });
    }
    return packagedRuntimePromise;
  };
  setRenderRuntimeReadinessProvider(ensurePackagedRenderRuntime);

  const hardwarePromise = detectDesktopHardwareProfile(app);
  const devOrigin = resolveDesktopDevOrigin({
    configuredDevUrl: process.env.CC_DESKTOP_DEV_URL,
    packaged: app.isPackaged,
    smoke: SMOKE,
  });
  const embeddedServerModule = new URL('./embedded-server.mjs', import.meta.url).href;
  const origin = devOrigin ?? (
    await (await import(embeddedServerModule) as typeof import('./embedded-server.ts'))
      .startEmbeddedServer(DIST_DIR)
  ).origin;
  traceStartup('embedded-server-ready', { origin });
  registerDesktopHandlers(origin);
  const projectStoreIpcModule = new URL('./project-store-ipc.mjs', import.meta.url).href;
  await (await import(projectStoreIpcModule) as typeof import('./project-store-ipc.ts'))
    .installProjectStoreIpc(origin);
  installEditorAuthIpc(origin);
  installDesktopUpdateIpc(origin, {
    enabled: supportsDirectDesktopUpdates({
      packaged: app.isPackaged,
      smoke: SMOKE,
      platform: process.platform,
      updateConfigPresent: existsSync(join(process.resourcesPath, 'app-update.yml')),
    }),
  });
  installDirectoryWatchIpc(origin);
  ipcMain.handle(AGENT_PATH_IMPORT_CHANNEL, trustedDesktopHandler(origin, async (_event, request: unknown) => {
    const value = request as { paths?: unknown; projectId?: unknown; knownHashes?: unknown };
    const paths = Array.isArray(value?.paths)
      ? value.paths.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0 && entry.length < 4096)
      : [];
    const knownHashes = Array.isArray(value?.knownHashes)
      ? value.knownHashes.filter((entry): entry is string => typeof entry === 'string' && entry.length <= 128)
      : [];
    if (!paths.length || typeof value?.projectId !== 'string') {
      throw new Error('invalid agent path import request');
    }
    return importAgentPaths({ paths, projectId: value.projectId, knownHashes });
  }));
  const desktopInference = installDesktopInferenceIpc(
    origin,
    join(runtimeProfile().rootDir, 'asr-models'),
    snapshotDesktopHardwareProfile(app),
  );
  void hardwarePromise
    .then((hardware) => {
      desktopInference.updateHardware(hardware);
      traceStartup('gpu-profile-ready', { gpus: hardware.gpus.length });
    })
    .catch((error) => console.warn(
      `[desktop] complete GPU probe failed: ${error instanceof Error ? error.message : String(error)}`,
    ));
  app.once('before-quit', () => desktopInference.dispose());
  traceStartup('desktop-ipc-ready');
  console.log(`[desktop] ${devOrigin ? 'live source' : 'embedded server'} at ${origin}`);
  installDesktopPageGuards(win, origin);
  if (win.isDestroyed()) return;
  await win.loadURL(`${origin}/`);
  traceStartup('renderer-loaded');
  if (STARTUP_TRACE) {
    void win.webContents.executeJavaScript(`(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const paints = Object.fromEntries(performance.getEntriesByType('paint').map((entry) => [entry.name, Math.round(entry.startTime * 10) / 10]));
      return navigation ? {
        domContentLoaded: Math.round(navigation.domContentLoadedEventEnd * 10) / 10,
        loadEventEnd: Math.round(navigation.loadEventEnd * 10) / 10,
        paints,
      } : { paints };
    })()`)
      .then((metrics) => traceStartup('renderer-metrics', metrics))
      .catch((error) => traceStartup('renderer-metrics-unavailable', String(error)));
  }

  if (app.isPackaged) {
    setTimeout(() => {
      if (win.isDestroyed()) return;
      void ensurePackagedRenderRuntime().catch((error) => console.warn(
        `[desktop] background render runtime preparation failed: ${error instanceof Error ? error.message : String(error)}`,
      ));
    }, PACKAGED_RENDER_WARMUP_DELAY_MS).unref();
  }

  if (SMOKE) {
    const smokeProbeModule = new URL('./smoke-probe.mjs', import.meta.url).href;
    await (await import(smokeProbeModule) as typeof import('./smoke-probe.ts'))
      .runDesktopSmokeProbe(origin, win, SMOKE_RENDER);
    console.log('SMOKE-OK');
    app.exit(0);
  }
}

app.on('window-all-closed', () => app.quit());

const hasSingleInstanceLock = requestProfileScopedSingleInstanceLock(app, runtimeProfile());
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) focusExistingWindow(mainWindow);
  });
}

if (SMOKE) {
  setTimeout(() => {
    console.error('smoke timed out');
    app.exit(2);
  }, SMOKE_TIMEOUT_MS).unref();
}

if (hasSingleInstanceLock) {
  boot().catch((err) => {
    console.error('[desktop] boot failed:', err instanceof Error ? err.stack ?? err.message : err);
    app.exit(1);
  });
}
