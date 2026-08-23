import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

import { modelPackCatalog } from './model-packs.ts';
import type { ModelPackCatalogEntry } from '../../shared/model-packs/catalog.ts';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function localVoiceCapabilitiesFromCatalog(packs: readonly ModelPackCatalogEntry[]): unknown {
  return {
    models: packs.filter((pack) => pack.kind === 'voice').map((pack) => ({
      modelId: pack.modelId,
      label: pack.label,
      status: pack.status,
      revision: pack.revision,
      license: pack.license,
      releaseChannel: pack.releaseChannel ?? 'stable',
      runtimeAvailable: pack.runtimeAvailability?.available ?? true,
      runtimeReason: pack.runtimeAvailability?.reason,
      voices: (pack.voices ?? []).map((voice) => ({
        voiceId: voice.id,
        label: voice.label,
        languageCodes: [voice.languageCode],
      })),
    })),
  };
}

export async function handleLocalVoiceModelsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  loadCatalog: () => Promise<readonly ModelPackCatalogEntry[]> = () => modelPackCatalog('voice'),
): Promise<void> {
  if (req.method !== 'GET') {
    req.resume();
    sendJson(res, 405, { error: 'method not allowed — use GET' });
    return;
  }
  sendJson(res, 200, localVoiceCapabilitiesFromCatalog(await loadCatalog()));
}

export function localVoiceModelsPlugin(): Plugin {
  return {
    name: 'yolocut-local-voice-models',
    configureServer(server) {
      server.middlewares.use('/api/local-voice/models', (req, res) => {
        void handleLocalVoiceModelsRequest(req, res).catch(() => {
          sendJson(res, 500, { error: 'local voice model status is unavailable' });
        });
      });
    },
  };
}
