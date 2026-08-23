import assert from 'node:assert/strict';

import { recommendLocalVoiceHardware, rtxGeneration } from './local-voice-hardware.ts';

assert.equal(rtxGeneration('NVIDIA GeForce RTX 2060'), 2);
assert.equal(rtxGeneration('NVIDIA GeForce RTX 5060 Ti'), 5);
assert.equal(rtxGeneration('NVIDIA Tesla T4'), undefined);

assert.equal(recommendLocalVoiceHardware({
  name: 'NVIDIA GeForce RTX 2060', memoryMiB: 6_144, computeCapability: 7.5,
}).packId, 'kokoro-tts-local');
assert.deepEqual(
  recommendLocalVoiceHardware({
    name: 'NVIDIA GeForce RTX 4060', memoryMiB: 8_192, computeCapability: 8.9,
  }).quantization,
  'q6_k',
);
assert.equal(recommendLocalVoiceHardware({
  name: 'NVIDIA GeForce RTX 5060', memoryMiB: 8_192, computeCapability: 12,
}).packId, 'fish-s2-pro-q6-local');
assert.equal(recommendLocalVoiceHardware({
  name: 'NVIDIA GeForce RTX 5060 Ti', memoryMiB: 16_384, computeCapability: 12,
}).packId, 'fish-s2-pro-q8-local');
assert.equal(recommendLocalVoiceHardware({
  name: 'NVIDIA GeForce RTX 5070', memoryMiB: 12_227, computeCapability: 12,
}).tier, 'performance');
assert.equal(recommendLocalVoiceHardware({
  name: 'NVIDIA GeForce RTX 3060', memoryMiB: 12_288, computeCapability: 8.6,
}).packId, 'kokoro-tts-local', 'the product recommendation starts Fish S2 at RTX 40 series');
assert.equal(recommendLocalVoiceHardware({
  name: 'NVIDIA GeForce GTX 1650', memoryMiB: 4_096, computeCapability: 7.5,
}).tier, 'unsupported');
assert.equal(recommendLocalVoiceHardware(null).tier, 'unsupported');

console.log('local-voice-hardware.verify: 2060 minimum, 4060/5060 Q6, and 10GB+ Q8 policy OK');
