import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';

import { modelPackDefinition, type ModelPackCatalogEntry } from '../../shared/model-packs/catalog.ts';
import { handleLocalVoiceModelsRequest, localVoiceCapabilitiesFromCatalog } from './local-voice-models.ts';

const definition = modelPackDefinition('kokoro-tts-local');
assert(definition);
const installed: ModelPackCatalogEntry = { ...definition, status: 'installed', installedBytes: definition.sizeBytes };
const capability = localVoiceCapabilitiesFromCatalog([installed]) as {
  models: Array<{
    modelId: string;
    status: string;
    runtimeAvailable: boolean;
    voices: Array<{ voiceId: string; languageCodes: string[] }>;
  }>;
};
assert.equal(capability.models.length, 1);
assert.equal(capability.models[0]?.modelId, 'nvidia/kokoro-82M-onnx-opt', 'external API uses HF modelId, not pack id');
assert.equal(capability.models[0]?.status, 'installed');
assert.equal(capability.models[0]?.runtimeAvailable, true);
assert.equal(capability.models[0]?.voices.length, 8);
assert.deepEqual(capability.models[0]?.voices[0]?.languageCodes, ['zh-CN']);
assert.equal(JSON.stringify(capability).includes('kokoro-tts-local'), false, 'installation pack id stays internal');

const fishDefinition = modelPackDefinition('fish-s2-pro-q6-local');
assert(fishDefinition);
const fishInstalled: ModelPackCatalogEntry = {
  ...fishDefinition,
  status: 'installed',
  installedBytes: fishDefinition.sizeBytes,
  runtimeAvailability: { available: false, reason: 'runtime missing' },
};
const withFish = localVoiceCapabilitiesFromCatalog([installed, fishInstalled]) as typeof capability;
assert.equal(withFish.models[1]?.modelId, 'fishaudio/s2-pro-s2cpp-q6-k');
assert.equal(withFish.models[1]?.runtimeAvailable, false,
  'downloaded Fish weights remain unavailable until the pinned external runtime passes integrity');

const server = createServer((req, res) => {
  void handleLocalVoiceModelsRequest(req, res, async () => [installed]);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address === 'object');
try {
  const response = await fetch(`http://127.0.0.1:${address.port}/api/local-voice/models`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json() as typeof capability;
  assert.equal(body.models[0]?.modelId, 'nvidia/kokoro-82M-onnx-opt');
  assert.equal(body.models[0]?.voices.length, 8);
  const post = await fetch(`http://127.0.0.1:${address.port}/api/local-voice/models`, { method: 'POST' });
  assert.equal(post.status, 405);
} finally {
  server.close();
  await once(server, 'close');
}

console.log('local-voice-models.verify: public modelId/status/8-voice capability contract OK');
