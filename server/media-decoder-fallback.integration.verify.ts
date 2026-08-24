import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ffmpegBin } from './media-binaries.ts';
import { encodeNormalized, probeVideo } from './media-normalization.ts';
import type { VideoDecodeAttempt } from './media-decoder-fallback.ts';
import { resolveMediaPerformanceProfile } from './media-performance-profile.ts';
import { buildPreviewProxy, previewProxyReason, probePreviewSource } from './preview-proxy.ts';

const work = await mkdtemp(join(tmpdir(), 'yolocut-decoder-fallback-'));
const ffmpeg = ffmpegBin();
try {
  const av1 = join(work, 'source-av1.mkv');
  const generatedAv1 = spawnSync(ffmpeg, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24:duration=0.4',
    '-an', '-c:v', 'libaom-av1', '-cpu-used', '8', '-row-mt', '1', av1,
  ], { encoding: 'utf8' });
  assert.equal(generatedAv1.status, 0, `failed to generate AV1 fixture: ${generatedAv1.stderr}`);

  const meta = await probeVideo(av1);
  assert.equal(meta.videoCodec, 'av1');
  const output = join(work, 'normalized.mp4');
  const attempted: string[] = [];
  const attempts: VideoDecodeAttempt[] = [
    { kind: 'hardware', decoder: 'missing-hardware', inputArgs: ['-hwaccel', 'missing-hardware'] },
    { kind: 'software', decoder: 'missing-software', inputArgs: ['-c:v', 'missing-software'] },
    { kind: 'third-party', decoder: 'libaom-av1', inputArgs: ['-c:v', 'libaom-av1'] },
  ];
  await encodeNormalized(
    av1,
    output,
    meta,
    160,
    90,
    1_500_000,
    24,
    false,
    { transcodeVideo: true, transcodeAudio: false },
    undefined,
    { attempts, onAttempt: (attempt) => attempted.push(`${attempt.kind}:${attempt.decoder}`) },
  );
  assert.deepEqual(attempted, [
    'hardware:missing-hardware',
    'software:missing-software',
    'third-party:libaom-av1',
  ]);
  const normalized = await probeVideo(output);
  assert.equal(normalized.videoCodec, 'h264');
  assert.deepEqual([normalized.width, normalized.height], [160, 90]);

  const vp9 = join(work, 'source-vp9.webm');
  const generatedVp9 = spawnSync(ffmpeg, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24:duration=0.25',
    '-an', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', vp9,
  ], { encoding: 'utf8' });
  assert.equal(generatedVp9.status, 0, `failed to generate VP9 fixture: ${generatedVp9.stderr}`);
  const decodedVp9 = spawnSync(ffmpeg, [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-c:v', 'libvpx-vp9', '-i', vp9, '-frames:v', '1', '-f', 'null', '-',
  ], { encoding: 'utf8' });
  assert.equal(decodedVp9.status, 0, `libvpx VP9 decoder failed: ${decodedVp9.stderr}`);

  const cameraTransport = join(work, 'camera.m2ts');
  const generatedTransport = spawnSync(ffmpeg, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=0.3',
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'mpegts', cameraTransport,
  ], { encoding: 'utf8' });
  assert.equal(generatedTransport.status, 0, `failed to generate M2TS fixture: ${generatedTransport.stderr}`);
  const transportMeta = await probeVideo(cameraTransport);
  assert.equal(transportMeta.videoCodec, 'h264', 'normalization probe must survive transport-stream input');
  assert.deepEqual([transportMeta.width, transportMeta.height], [320, 180]);
  const controller = new AbortController();
  const transportProbe = await probePreviewSource(cameraTransport, controller.signal);
  const profile = await resolveMediaPerformanceProfile();
  assert.equal(previewProxyReason(transportProbe, false, profile), 'portable-container-proxy');
  const transportProxy = join(work, 'camera-proxy.mp4');
  const outcome = await buildPreviewProxy(
    cameraTransport,
    transportProxy,
    controller.signal,
    transportProbe,
    profile,
  );
  assert.ok(['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox', 'h264_vaapi', 'libx264'].includes(outcome.encoder.id));
  assert.equal((await probeVideo(transportProxy)).videoCodec, 'h264');
} finally {
  await rm(work, { recursive: true, force: true });
}

process.stdout.write('media-decoder-fallback.integration.verify: hardware → software → libaom/libvpx passed\n');
