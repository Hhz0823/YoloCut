import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { keyStatus, setKeys, type KeyStatus } from '../keystore.ts';
import {
  discoverZCode,
  zcodeSettingsPatch,
  type ZCodeDiscoveryResult,
} from '../zcode-discovery.ts';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export interface ZCodePluginDependencies {
  readonly discover: () => Promise<ZCodeDiscoveryResult>;
  readonly persist: (patch: Record<string, unknown>) => Promise<void>;
  readonly settingsStatus: () => KeyStatus;
}

const DEFAULT_DEPENDENCIES: ZCodePluginDependencies = {
  discover: discoverZCode,
  persist: setKeys,
  settingsStatus: keyStatus,
};

export async function handleZCodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  dependencies: ZCodePluginDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (req.method === 'GET' && path === '/status') {
    const { status } = await dependencies.discover();
    sendJson(res, 200, status);
    return;
  }
  if (req.method === 'POST' && path === '/connect') {
    const discovery = await dependencies.discover();
    if (!discovery.status.authenticated || !discovery.credentials) {
      sendJson(res, 409, { error: discovery.status.message, status: discovery.status });
      return;
    }
    await dependencies.persist(zcodeSettingsPatch(discovery));
    sendJson(res, 200, { status: discovery.status, settings: dependencies.settingsStatus() });
    return;
  }
  sendJson(res, 405, { error: 'method not allowed — use GET /status or POST /connect' });
}

export function zcodePlugin(dependencies: ZCodePluginDependencies = DEFAULT_DEPENDENCIES): Plugin {
  return {
    name: 'yolocut-zcode-discovery',
    configureServer(server) {
      server.middlewares.use('/api/zcode', async (req: IncomingMessage, res: ServerResponse) => {
        try {
          await handleZCodeRequest(req, res, dependencies);
        } catch {
          // Do not surface filesystem/HTTP error details: an unexpected error
          // could carry local paths or header material.
          server.config.logger.warn('[zcode] automatic connection failed');
          sendJson(res, 500, { error: 'ZCode 自动接入失败，请确认本地网关已启动后重试' });
        }
      });
    },
  };
}
