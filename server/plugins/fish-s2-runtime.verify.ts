import assert from 'node:assert/strict';

import { fishS2LaunchArgs, inspectPcmWav } from './fish-s2-runtime.ts';

const args = fishS2LaunchArgs({
  engine: 's2.cpp',
  engineRevision: '2c33261938da1a41d713768b1b391b4d368d7d2c',
  architecture: 'fish-s2-pro',
  quantization: 'q8_0',
  modelPath: 's2-pro-q8_0.gguf',
  tokenizerPath: 'tokenizer.json',
  minimumVramMiB: 10_240,
  gpuLayers: -1,
}, 'C:\\models', 3030);
assert.deepEqual(args.slice(-14), [
  '--server', '--host', '127.0.0.1', '--port', '3030',
  '--cuda', '0', '--gpu-layers', '-1', '--codec-auto', '--normalize', '--trim-silence', '--log-level', 'warn',
]);

const wav = Buffer.alloc(44);
wav.write('RIFF', 0, 'ascii');
wav.write('WAVE', 8, 'ascii');
wav.write('fmt ', 12, 'ascii');
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44_100, 24);
wav.writeUInt16LE(16, 34);
assert.deepEqual(inspectPcmWav(wav), { sampleRate: 44_100, channels: 1, bits: 16 });
wav.writeUInt16LE(2, 22);
assert.equal(inspectPcmWav(wav), null, 'stereo output fails closed');

console.log('fish-s2-runtime.verify: pinned CUDA server args and PCM WAV boundary OK');
