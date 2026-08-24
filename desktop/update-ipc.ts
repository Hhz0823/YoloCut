import { app, BrowserWindow, ipcMain } from 'electron';
import type { AppUpdater } from 'electron-updater';
import {
  DESKTOP_UPDATE_CHANNELS,
  isDesktopUpdateCheckSource,
  type DesktopUpdateOperation,
  type DesktopUpdateState,
} from '../shared/desktop-update.ts';
import { assertTrustedDesktopSenderUrl } from './page-origin.ts';
import { DesktopUpdateService } from './update-service.ts';

interface DesktopUpdateIpcOptions {
  readonly enabled: boolean;
}

function publishUpdateState(state: DesktopUpdateState): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send(DESKTOP_UPDATE_CHANNELS.state, state);
  });
}

export function installDesktopUpdateIpc(
  trustedOrigin: string,
  options: DesktopUpdateIpcOptions,
): void {
  const currentVersion = app.getVersion();
  let state: DesktopUpdateState = {
    phase: options.enabled ? 'idle' : 'unsupported',
    source: 'auto',
    currentVersion,
  };
  let servicePromise: Promise<DesktopUpdateService> | null = null;

  const loadService = async (): Promise<DesktopUpdateService> => {
    if (!servicePromise) {
      servicePromise = import('electron-updater').then((module) => {
        const defaultExport = Reflect.get(module, 'default');
        const autoUpdater = (
          Reflect.get(module, 'autoUpdater')
          ?? (typeof defaultExport === 'object' && defaultExport !== null
            ? Reflect.get(defaultExport, 'autoUpdater')
            : undefined)
        ) as AppUpdater | undefined;
        if (!autoUpdater) throw new Error('desktop updater is unavailable');
        const service = new DesktopUpdateService(autoUpdater, {
          enabled: options.enabled,
          currentVersion,
        });
        state = service.getState();
        service.subscribe((next) => {
          state = next;
          publishUpdateState(next);
        });
        return service;
      }).catch((error) => {
        servicePromise = null;
        throw error;
      });
    }
    return servicePromise;
  };

  const run = async (
    operation: DesktopUpdateOperation,
    action: (service: DesktopUpdateService) => DesktopUpdateState | Promise<DesktopUpdateState>,
  ): Promise<DesktopUpdateState> => {
    if (!options.enabled) return state;
    try {
      return await action(await loadService());
    } catch {
      state = {
        phase: 'error',
        source: state.source,
        currentVersion,
        latestVersion: state.latestVersion,
        failedOperation: operation,
      };
      publishUpdateState(state);
      return state;
    }
  };

  ipcMain.handle(DESKTOP_UPDATE_CHANNELS.getState, (event) => {
    assertTrustedDesktopSenderUrl(event.senderFrame?.url ?? '', trustedOrigin);
    return state;
  });
  ipcMain.handle(DESKTOP_UPDATE_CHANNELS.check, async (event, source: unknown) => {
    assertTrustedDesktopSenderUrl(event.senderFrame?.url ?? '', trustedOrigin);
    if (!isDesktopUpdateCheckSource(source)) throw new Error('invalid update check source');
    state = { ...state, source };
    return run('check', (service) => service.check(source));
  });
  ipcMain.handle(DESKTOP_UPDATE_CHANNELS.download, async (event) => {
    assertTrustedDesktopSenderUrl(event.senderFrame?.url ?? '', trustedOrigin);
    return run('download', (service) => service.download());
  });
  ipcMain.handle(DESKTOP_UPDATE_CHANNELS.install, async (event) => {
    assertTrustedDesktopSenderUrl(event.senderFrame?.url ?? '', trustedOrigin);
    return run('install', (service) => service.install());
  });
}
