import assert from 'node:assert/strict';

import { h264EncoderProfile } from './media-acceleration.ts';
import { resolveMediaPerformancePolicy } from './media-performance-profile.ts';
import {
  previewProxyBuildAttempts,
  previewProxyReason,
  resolvePreviewProxyDimensions,
  type PreviewSourceProbe,
} from './preview-proxy.ts';

const profile = resolveMediaPerformancePolicy({
  logicalCores: 16,
  totalMemoryBytes: 32 * 1024 ** 3,
  encoder: h264EncoderProfile('h264_nvenc'),
  nvidiaGpu: { name: 'NVIDIA GeForce RTX 5070', memoryMiB: 12_227, computeCapability: 12 },
  decodeArgs: ['-hwaccel', 'cuda'],
  scaleCuda: true,
});
const probe: PreviewSourceProbe = {
  durationMs: 3 * 60 * 60_000,
  width: 3_840,
  height: 2_160,
  fps: 59.94,
  codec: 'hevc',
  longGop: false,
  unstableCodec: true,
};
assert.equal(previewProxyReason(probe, false, profile), 'adaptive-resolution');
assert.deepEqual(resolvePreviewProxyDimensions(probe, profile), { width: 1_920, height: 1_080 });

const attempts = previewProxyBuildAttempts('master.mp4', 'proxy.mp4', probe, profile);
assert.deepEqual(attempts.map((attempt) => attempt.id), [
  'nvidia-zero-copy', 'hardware-decode-encode', 'hardware-encode', 'software',
]);
const zeroCopy = attempts[0]!;
assert.deepEqual(
  zeroCopy.args.slice(zeroCopy.args.indexOf('-hwaccel'), zeroCopy.args.indexOf('-i')),
  ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
);
assert.match(zeroCopy.args[zeroCopy.args.indexOf('-vf') + 1]!, /^scale_cuda=1920:1080:/);
assert.equal(zeroCopy.args[zeroCopy.args.indexOf('-c:v') + 1], 'h264_nvenc');
assert.equal(zeroCopy.args.includes('-pix_fmt'), false, 'CUDA frames must not trigger a software format conversion');
assert.equal(zeroCopy.args[zeroCopy.args.indexOf('-r') + 1], '30');
const software = attempts.at(-1)!;
assert.equal(software.args[software.args.indexOf('-c:v') + 1], 'libx264');

console.log('preview-proxy.verify: 4K adaptive target and NVDEC→scale_cuda→NVENC fallbacks OK');
