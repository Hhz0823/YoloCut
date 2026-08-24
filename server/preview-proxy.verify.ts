import assert from 'node:assert/strict';

import { h264EncoderProfile } from './media-acceleration.ts';
import { resolveMediaPerformancePolicy } from './media-performance-profile.ts';
import {
  previewPixelFormatBitDepth,
  previewPixelFormatHasAlpha,
  previewProxyBuildAttempts,
  previewProxyReason,
  normalizePreviewPressure,
  resolvePressureAdjustedProfile,
  resolvePreviewProxyDimensions,
  type PreviewSourceProbe,
} from './preview-proxy.ts';

assert.equal(previewPixelFormatBitDepth('yuv420p'), 8);
assert.equal(previewPixelFormatBitDepth('yuv420p10le'), 10);
assert.equal(previewPixelFormatBitDepth('p010le'), 10, 'packed 10-bit formats must not be misreported as 8-bit');
assert.equal(previewPixelFormatBitDepth('gray12be'), 12);
assert.equal(previewPixelFormatBitDepth('yuv420p', '16'), 16, 'ffprobe raw bit depth remains authoritative');
assert.equal(previewPixelFormatHasAlpha('yuva420p'), true);
assert.equal(previewPixelFormatHasAlpha('gbrap10le'), true);
assert.equal(previewPixelFormatHasAlpha('gray10le'), false, 'grayscale is not an alpha channel');
assert.equal(previewPixelFormatHasAlpha('cuda'), false, 'hardware pixel-format names are not alpha formats');

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
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  extension: '.mp4',
  profile: 'Main 10',
  pixelFormat: 'yuv420p10le',
  bitDepth: 10,
  hasAlpha: false,
  bitrate: 120_000_000,
  longGop: false,
  unstableCodec: true,
};
assert.equal(previewProxyReason(probe, false, profile), 'adaptive-resolution');
assert.deepEqual(resolvePreviewProxyDimensions(probe, profile), { width: 1_920, height: 1_080 });
assert.equal(normalizePreviewPressure(3), 4);
assert.equal(normalizePreviewPressure(99), 128);
assert.equal(resolvePressureAdjustedProfile(profile, 8), profile, 'decoder pressure below the GPU budget keeps full proxy quality');
const denseProfile = resolvePressureAdjustedProfile(profile, 32);
assert.equal(denseProfile.proxy.maxHeight, 660);
assert.equal(denseProfile.proxy.maxWidth, 1_172);
assert.equal(denseProfile.proxy.maxFps, 24);
assert.match(denseProfile.cacheKey, /-p32-660p24$/);
assert.deepEqual(resolvePreviewProxyDimensions(probe, denseProfile), { width: 1_172, height: 658 });
const extremeProfile = resolvePressureAdjustedProfile(profile, 100);
assert.equal(extremeProfile.proxy.maxHeight, 360);
assert.equal(extremeProfile.proxy.maxFps, 15);
assert.equal(previewProxyReason({ ...probe, width: 1_920, height: 1_080, fps: 30, codec: 'h264', unstableCodec: false, longGop: false }, false, profile), 'high-bitrate');
const normalBitrate = { ...probe, bitrate: 4_000_000, width: 1_920, height: 1_080, fps: 30, longGop: false };
assert.equal(previewProxyReason({ ...normalBitrate, extension: '.mxf', codec: 'h264', profile: 'High', pixelFormat: 'yuv420p', bitDepth: 8, unstableCodec: false }, false, profile), 'portable-container-proxy');
assert.equal(previewProxyReason({ ...normalBitrate, codec: 'av1', profile: 'Main', pixelFormat: 'yuv420p', bitDepth: 8, unstableCodec: false }, false, profile), 'portable-av1-decoder');
assert.equal(previewProxyReason({ ...normalBitrate, codec: 'h264', profile: 'High 10', pixelFormat: 'yuv420p10le', bitDepth: 10, unstableCodec: false }, false, profile), 'browser-h264-profile');
assert.equal(previewProxyReason({ ...normalBitrate, codec: 'vp9', profile: 'Profile 2', pixelFormat: 'yuv420p10le', bitDepth: 10, unstableCodec: false }, false, profile), 'browser-vp9-profile');
assert.equal(previewProxyReason({ ...normalBitrate, codec: 'vp9', profile: 'Profile 0', pixelFormat: 'yuv420p', bitDepth: 8, hasAlpha: true, unstableCodec: false }, false, profile), null, 'alpha VP9 remains direct so compatibility proxying cannot destroy transparency');

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

const thirdPartyProfile = {
  ...profile,
  ffmpeg: { ...profile.ffmpeg, thirdPartyDecoders: ['libaom-av1'] },
};
const av1Attempts = previewProxyBuildAttempts(
  'av1.mp4',
  'proxy.mp4',
  { ...normalBitrate, codec: 'av1', profile: 'Main', pixelFormat: 'yuv420p', bitDepth: 8, unstableCodec: false },
  thirdPartyProfile,
);
assert.deepEqual(av1Attempts.map((attempt) => attempt.id), [
  'nvidia-zero-copy',
  'hardware-decode-encode',
  'hardware-encode',
  'third-party-decode-hardware-encode',
  'software',
  'third-party-software',
]);
const libaomHardware = av1Attempts.find((attempt) => attempt.id === 'third-party-decode-hardware-encode')!;
assert.deepEqual(
  libaomHardware.args.slice(libaomHardware.args.indexOf('-c:v'), libaomHardware.args.indexOf('-i')),
  ['-c:v', 'libaom-av1'],
);

console.log('preview-proxy.verify: 4K adaptive target and NVDEC→scale_cuda→NVENC fallbacks OK');
