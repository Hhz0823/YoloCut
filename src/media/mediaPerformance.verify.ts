import assert from 'node:assert/strict';
import {
  adaptivePreviewPremountFrames,
  mediaRuntimeBudgets,
  previewProxyPlanning,
  type ClientMediaPerformanceProfile,
} from './mediaPerformance';

assert.equal(adaptivePreviewPremountFrames(30, 'economy'), 8);
assert.equal(adaptivePreviewPremountFrames(30, 'balanced'), 15);
assert.equal(adaptivePreviewPremountFrames(30, 'performance'), 30);
assert.equal(adaptivePreviewPremountFrames(60, 'economy'), 15);
assert.equal(adaptivePreviewPremountFrames(Number.NaN, null), 15);
assert.equal(adaptivePreviewPremountFrames(30, 'performance', 16, 12), 15, 'moderate pressure halves decoder warm-up');
assert.equal(adaptivePreviewPremountFrames(30, 'performance', 32, 12), 0, 'dense timelines do not premount another decoder wave');

assert.equal(mediaRuntimeBudgets(null).proxyPrefetchSources, 4, 'unknown hosts start conservatively');
const performance = {
  version: 2,
  tier: 'performance',
  label: 'performance',
  reason: 'fixture',
  ffmpeg: {
    encoder: { id: 'h264_nvenc', label: 'NVENC', hardware: true },
    decoder: { id: 'cuda', hardware: true, zeroCopy: true },
    thirdPartyDecoders: ['libaom-av1', 'libvpx-vp9'],
  },
  proxy: { maxWidth: 1920, maxHeight: 1080, maxFps: 30 },
  budgets: {
    ffmpegThreadsPerProcess: 4,
    mediaProcessConcurrency: 3,
    derivativeConcurrency: 3,
    normalizeConcurrency: 2,
    proxyConcurrency: 2,
    proxyPrefetchSources: 16,
    proxyLookBehindSeconds: 30,
    proxyLookAheadSeconds: 180,
    previewDecoderBudget: 12,
    decodedVideoMemoryBytes: 1024 ** 3,
    lutCacheMaxEntries: 20,
    lutCacheMaxBytes: 64 * 1024 ** 2,
  },
} satisfies ClientMediaPerformanceProfile;
assert.deepEqual(previewProxyPlanning(30, performance), {
  beforeFrames: 900,
  afterFrames: 5_400,
  prefetchSources: 16,
  maxSources: 64,
  decoderBudget: 12,
  proxyConcurrency: 2,
});

console.log('mediaPerformance.verify: ok');
