import assert from 'node:assert/strict';

import { h264EncoderProfile } from './media-acceleration.ts';
import {
  estimatePreviewProxyBytes,
  resolveMediaPerformancePolicy,
  resolvePreviewCacheBudgetBytes,
} from './media-performance-profile.ts';

const GIB = 1024 ** 3;
const economy = resolveMediaPerformancePolicy({
  logicalCores: 4,
  totalMemoryBytes: 8 * GIB,
  encoder: h264EncoderProfile('libx264'),
  scaleCuda: false,
});
assert.equal(economy.tier, 'economy');
assert.equal(economy.proxy.maxHeight, 540);
assert.equal(economy.ffmpeg.decoder.hardware, false);

const balanced = resolveMediaPerformancePolicy({
  logicalCores: 8,
  totalMemoryBytes: 16 * GIB,
  encoder: h264EncoderProfile('h264_nvenc'),
  nvidiaGpu: { name: 'NVIDIA GeForce RTX 2060', memoryMiB: 6_144, computeCapability: 7.5 },
  decodeArgs: ['-hwaccel', 'cuda'],
  scaleCuda: true,
});
assert.equal(balanced.tier, 'balanced');
assert.equal(balanced.proxy.maxHeight, 720);
assert.equal(balanced.ffmpeg.decoder.zeroCopy, true);

const performance = resolveMediaPerformancePolicy({
  logicalCores: 16,
  totalMemoryBytes: 32 * GIB,
  encoder: h264EncoderProfile('h264_nvenc'),
  nvidiaGpu: { name: 'NVIDIA GeForce RTX 5070', memoryMiB: 12_227, computeCapability: 12 },
  decodeArgs: ['-hwaccel', 'cuda'],
  scaleCuda: true,
});
assert.equal(performance.tier, 'performance');
assert.equal(performance.proxy.maxHeight, 1_080);
assert.match(performance.cacheKey, /^v1-performance-1080p30-h264_nvenc-zc$/);
assert.equal(resolvePreviewCacheBudgetBytes(performance, 10 * GIB), 2 * GIB);
assert.ok(estimatePreviewProxyBytes(60 * 60_000, economy.proxy) < 1.1 * GIB);

console.log('media-performance-profile.verify: adaptive CPU/RAM/GPU tiers, cache reserve and long proxy estimate OK');
