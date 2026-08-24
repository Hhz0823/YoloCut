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
assert.equal(economy.budgets.ffmpegThreadsPerProcess, 2);
assert.equal(economy.budgets.mediaProcessConcurrency, 1);
assert.equal(economy.budgets.proxyPrefetchSources, 4);
assert.equal(economy.budgets.normalizeConcurrency, 1);

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
assert.equal(balanced.budgets.previewDecoderBudget, 8);
assert.equal(balanced.budgets.proxyConcurrency, 1);

const performance = resolveMediaPerformancePolicy({
  logicalCores: 16,
  totalMemoryBytes: 32 * GIB,
  encoder: h264EncoderProfile('h264_nvenc'),
  nvidiaGpu: { name: 'NVIDIA GeForce RTX 5070', memoryMiB: 12_227, computeCapability: 12 },
  decodeArgs: ['-hwaccel', 'cuda'],
  scaleCuda: true,
  thirdPartyDecoders: ['libaom-av1', 'libvpx-vp9'],
});
assert.equal(performance.tier, 'performance');
assert.equal(performance.proxy.maxHeight, 1_080);
assert.match(performance.cacheKey, /^v2-performance-1080p30-h264_nvenc-zc$/);
assert.equal(performance.budgets.ffmpegThreadsPerProcess, 4);
assert.equal(performance.budgets.mediaProcessConcurrency, 3);
assert.equal(performance.budgets.derivativeConcurrency, 3);
assert.equal(performance.budgets.normalizeConcurrency, 2);
assert.equal(performance.budgets.proxyConcurrency, 2);
assert.equal(performance.budgets.lutCacheMaxBytes, 64 * 1024 ** 2);
assert.deepEqual(performance.ffmpeg.thirdPartyDecoders, ['libaom-av1', 'libvpx-vp9']);
assert.equal(resolvePreviewCacheBudgetBytes(performance, 10 * GIB), 2 * GIB);
assert.ok(estimatePreviewProxyBytes(60 * 60_000, economy.proxy) < 1.1 * GIB);

const sixGigabyteGpu = resolveMediaPerformancePolicy({
  logicalCores: 16,
  totalMemoryBytes: 32 * GIB,
  encoder: h264EncoderProfile('h264_nvenc'),
  nvidiaGpu: { name: 'NVIDIA GeForce RTX 2060', memoryMiB: 6_144, computeCapability: 7.5 },
  decodeArgs: ['-hwaccel', 'cuda'],
  scaleCuda: true,
});
assert.equal(sixGigabyteGpu.tier, 'balanced', '6GB cards must not receive the 1080p multi-decoder tier');

const fourGigabyteGpu = resolveMediaPerformancePolicy({
  logicalCores: 16,
  totalMemoryBytes: 32 * GIB,
  encoder: h264EncoderProfile('h264_nvenc'),
  nvidiaGpu: { name: 'NVIDIA GeForce GTX fixture', memoryMiB: 4_096, computeCapability: 7.5 },
  decodeArgs: ['-hwaccel', 'cuda'],
  scaleCuda: true,
});
assert.equal(fourGigabyteGpu.tier, 'economy');

console.log('media-performance-profile.verify: adaptive CPU/RAM/GPU tiers, cache reserve and long proxy estimate OK');
