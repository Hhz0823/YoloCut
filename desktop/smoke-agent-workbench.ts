import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { BrowserWindow } from 'electron';
import type { AgentWorkbenchState } from '../shared/agent-workbench';

const POLL_MS = 100;
const TIMEOUT_MS = 45_000;

async function waitFor<T>(label: string, read: () => T | Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (accept(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  const suffix = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(`agent workbench smoke timed out waiting for ${label}${suffix}`);
}

async function rendererValue<T>(win: BrowserWindow, expression: string): Promise<T> {
  return win.webContents.executeJavaScript(expression) as Promise<T>;
}

async function workbenchState(win: BrowserWindow): Promise<AgentWorkbenchState | null> {
  return rendererValue<AgentWorkbenchState | null>(
    win,
    '(async () => window.yoloCutDesktop?.agentWorkbench?.getState?.() ?? null)()',
  );
}

async function waitForAgentWindow(main: BrowserWindow): Promise<BrowserWindow> {
  const candidate = await waitFor(
    'detached native window',
    () => BrowserWindow.getAllWindows().find((candidate) => (
      candidate !== main
      && !candidate.isDestroyed()
      && candidate.webContents.getURL().includes('agent-window=1')
    )) ?? null,
    (value) => value !== null,
  );
  if (!candidate) throw new Error('detached native window disappeared');
  return candidate;
}

async function captureAgentHeader(main: BrowserWindow): Promise<void> {
  const target = process.env.CC_SMOKE_AGENT_SCREENSHOT;
  if (!target) return;
  if (!isAbsolute(target)) throw new Error('CC_SMOKE_AGENT_SCREENSHOT must be an absolute path');
  await waitFor(
    'Agent header screenshot target',
    () => rendererValue<boolean>(main, "document.querySelector('.cc-chat-header') instanceof HTMLElement"),
    Boolean,
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  const image = await main.webContents.capturePage();
  await writeFile(target, image.toPNG());
  console.log(`[smoke] Agent header screenshot: ${target}`);
}

type DetachMethod = 'drag-release' | 'drag-blur' | 'button';

async function detachFromMain(main: BrowserWindow, method: DetachMethod): Promise<BrowserWindow> {
  const byDrag = method !== 'button';
  await waitFor(
    byDrag ? 'Agent tear-off handle' : 'enabled detach control',
    () => rendererValue<boolean>(main, `(() => {
      const button = ${byDrag
        ? "document.querySelector('[data-cc-agent-drag-handle]')"
        : "document.querySelector('.cc-agent-detach-glyph')?.closest('button')"};
      return button instanceof HTMLButtonElement && !button.disabled;
    })()`),
    Boolean,
  );
  if (byDrag) {
    main.show();
    main.focus();
    main.webContents.focus();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const points = await rendererValue<{
      startX: number;
      startY: number;
      dropX: number;
      dropY: number;
    } | null>(main, `(() => {
      const button = document.querySelector('[data-cc-agent-drag-handle]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return null;
      const rect = button.getBoundingClientRect();
      return {
        startX: Math.round(rect.left + rect.width / 2),
        startY: Math.round(rect.top + rect.height / 2),
        // Reproduce a short pull away from the docked right rail. This used to
        // fall inside the oversized 30% right zone and silently re-dock.
        dropX: Math.round(window.innerWidth * 0.76),
        dropY: Math.round(Math.max(80, rect.top + rect.height / 2 + 40)),
      };
    })()`);
    assert.ok(points, 'main renderer must expose drag coordinates');
    // Electron 40 on Windows drops sendInputEvent mouseMove frames while a
    // renderer button is pressed. DevTools Input dispatch still produces
    // trusted Chromium pointer/mouse events and therefore exercises the real
    // React drag path without replacing it with synthetic DOM events.
    main.webContents.debugger.attach('1.3');
    try {
      const dispatch = (params: Record<string, unknown>) => (
        main.webContents.debugger.sendCommand('Input.dispatchMouseEvent', params)
      );
      await dispatch({ type: 'mouseMoved', x: points.startX, y: points.startY, buttons: 0 });
      await dispatch({
        type: 'mousePressed', x: points.startX, y: points.startY,
        button: 'left', buttons: 1, clickCount: 1,
      });
      for (const progress of [0.35, 0.7, 1]) {
        await dispatch({
          type: 'mouseMoved',
          x: Math.round(points.startX + (points.dropX - points.startX) * progress),
          y: Math.round(points.startY + (points.dropY - points.startY) * progress),
          button: 'left',
          buttons: 1,
        });
        await new Promise((resolve) => setTimeout(resolve, 24));
      }
      const previewBeforeRelease = await rendererValue<string | null>(main, `(() => {
        const overlay = document.querySelector('.cc-agent-dock-overlay');
        return overlay?.getAttribute('data-target') ?? null;
      })()`);
      assert.equal(previewBeforeRelease, 'detached', 'a short pull away from the rail must preview a detached window');
      if (method === 'drag-blur') {
        // Reproduce Windows/Electron ordering when the cursor leaves the native
        // window and blur arrives before the final mouse-up.
        main.blur();
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
      await dispatch({
        type: 'mouseReleased', x: points.dropX, y: points.dropY,
        button: 'left', buttons: 0, clickCount: 1,
      });
    } finally {
      if (main.webContents.debugger.isAttached()) main.webContents.debugger.detach();
    }
  } else {
    const clicked = await rendererValue<boolean>(main, `(() => {
      const button = document.querySelector('.cc-agent-detach-glyph')?.closest('button');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`);
    assert.equal(clicked, true, 'main renderer must invoke Agent detach by button');
  }
  const detached = await waitForAgentWindow(main);
  await waitFor(
    'detached renderer workspace',
    () => rendererValue<boolean>(detached, `Boolean(
      document.querySelector('.cc-agent-window-root [data-cc-agent-dock="detached"]')
      && document.querySelector('.cc-agent-window-root textarea')
    )`),
    Boolean,
  );
  return detached;
}

async function dockFromDetached(
  main: BrowserWindow,
  detached: BrowserWindow,
  side: 'left' | 'right',
): Promise<void> {
  const index = side === 'left' ? 0 : 2;
  const clicked = await rendererValue<boolean>(detached, `(() => {
    const buttons = document.querySelectorAll('.cc-agent-dock-controls button');
    const button = buttons.item(${index});
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, `detached renderer must request ${side} docking`);
  await waitFor('detached window close', () => detached.isDestroyed(), Boolean);
  const state = await waitFor(
    `${side} dock state`,
    () => workbenchState(main),
    (value) => value?.placement === side && value.dockSide === side,
  );
  assert.equal(state?.dockPreview, null);
  await waitFor(
    `${side} docked renderer`,
    () => rendererValue<boolean>(main, `Boolean(document.querySelector('[data-cc-agent-dock="${side}"]'))`),
    Boolean,
  );
}

export async function runDesktopAgentWorkbenchSmoke(main: BrowserWindow): Promise<void> {
  await waitFor(
    'dashboard project card',
    () => rendererValue<boolean>(main, "Boolean(document.querySelector('button.cc-project-thumbnail'))"),
    Boolean,
  );
  const opened = await rendererValue<boolean>(main, `(() => {
    const button = document.querySelector('button.cc-project-thumbnail');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  assert.equal(opened, true, 'desktop renderer must open the first project');
  await waitFor(
    'editor route',
    () => rendererValue<string>(main, 'window.location.hash'),
    (hash) => hash.startsWith('#/editor/'),
  );
  await captureAgentHeader(main);

  const leftWindow = await detachFromMain(main, 'drag-release');
  const detachedState = await workbenchState(leftWindow);
  assert.equal(detachedState?.placement, 'detached');
  assert.ok(detachedState?.projectId, 'detached Agent state must stay bound to a project');
  assert.equal(leftWindow.webContents.getBackgroundThrottling(), false);
  await dockFromDetached(main, leftWindow, 'left');

  const rightWindow = await detachFromMain(main, 'drag-blur');
  await dockFromDetached(main, rightWindow, 'right');
  const buttonWindow = await detachFromMain(main, 'button');
  await dockFromDetached(main, buttonWindow, 'right');
  assert.equal(
    BrowserWindow.getAllWindows().filter((candidate) => !candidate.isDestroyed()).length,
    1,
    'the dock round-trip must leave only the main window',
  );
  console.log('[smoke] Agent window trusted drag → left dock → blur tear-off → right dock → button detach ok');
}
