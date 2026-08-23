import assert from 'node:assert/strict';

import {
  parseLocalNvidiaGpus,
  probeLocalVoiceHardware,
  selectLocalVoiceGpu,
} from './local-voice-hardware.ts';

const gpus = parseLocalNvidiaGpus([
  'NVIDIA GeForce RTX 2060, 6144, 7.5',
  'NVIDIA GeForce RTX 4060, 8192, 8.9',
  'NVIDIA GeForce RTX 5070, 12227, 12.0',
  'malformed',
].join('\n'));
assert.equal(gpus.length, 3);
assert.equal(selectLocalVoiceGpu(gpus)?.name, 'NVIDIA GeForce RTX 5070');

if (process.platform === 'win32' && process.arch === 'x64') {
  const snapshot = await probeLocalVoiceHardware(async () => 'NVIDIA GeForce RTX 4060, 8192, 8.9');
  assert.equal(snapshot.selectedGpu?.memoryMiB, 8_192);
  assert.equal(snapshot.recommendation.packId, 'fish-s2-pro-q6-local');
}

console.log('local-voice-hardware.verify: NVIDIA CSV parsing and strongest-tier selection OK');
