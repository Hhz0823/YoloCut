import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

import { seedKeystore } from '../keystore.ts';
import { ffmpegBin } from '../media-binaries.ts';
import { probeVideoInfo } from '../media-probe.ts';
import { analyzeColorInFile } from './auto-grade.ts';
import { extractFramesPlugin } from './extract-frames.ts';
import { mediaPreviewPlugin } from './media-preview.ts';
import { detectScenesInFile } from './scene-detection.ts';
import { materializeVideoReferences } from './video-media.ts';

const previousMediaDir = process.env.MEDIA_DIR;
const work = await mkdtemp(join(tmpdir(), 'yolocut-preview-decode-'));
let server: ViteDevServer | undefined;
try {
  process.env.MEDIA_DIR = work;
  seedKeystore({ MEDIA_DIR: work });
  const source = join(work, 'software-only-ffv1.mkv');
  const generated = spawnSync(ffmpegBin(), [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=1',
    '-an', '-c:v', 'ffv1', '-level', '3', source,
  ], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const grade = await analyzeColorInFile(source);
  assert.ok(grade.stats.sampleCount > 0);
  assert.ok(Number.isFinite(grade.filters.brightness));
  const scenes = await detectScenesInFile(source, { maxScenes: 5 });
  assert.ok(scenes.durationMs >= 900 && scenes.durationMs <= 1_100);
  const materialized = await materializeVideoReferences({
    model: 'seedance2',
    prompt: 'FFV1 fallback verification',
    generationReferences: [{
      kind: 'timeline-slice',
      role: 'reference-video',
      assetId: 'ffv1-source',
      path: '/media/uploads/software-only-ffv1.mkv',
      sourceRevision: 'ffv1-v1',
      itemId: 'ffv1-item',
      srcInFrame: 0,
      srcOutFrame: 24,
      playbackRate: 1,
      timelineDurationInFrames: 24,
      fps: 24,
    }],
  });
  const slicePath = materialized.refVideoPaths?.[0] ?? '';
  assert.match(slicePath, /^\/media\/uploads\/generation-slice-[a-f0-9]+\.mp4$/);
  const sliceProbe = await probeVideoInfo(join(work, slicePath.split('/').at(-1)!));
  assert.equal(sliceProbe.video.codec, 'h264');

  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    plugins: [mediaPreviewPlugin(), extractFramesPlugin()],
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('preview verification server has no TCP address');
  const origin = `http://127.0.0.1:${address.port}`;
  const src = encodeURIComponent('/media/uploads/software-only-ffv1.mkv');

  for (const route of ['media-poster', 'filmstrip']) {
    const response = await fetch(`${origin}/api/${route}?src=${src}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200, `${route}: ${bytes.toString('utf8')}`);
    assert.match(response.headers.get('content-type') ?? '', /^image\/jpeg/);
    assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8], `${route} must return a JPEG`);
  }
  const framesResponse = await fetch(`${origin}/api/extract-frames`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ src: '/media/uploads/software-only-ffv1.mkv', count: 2 }),
  });
  const frames = await framesResponse.json() as { ok?: boolean; base64?: string; sampleCount?: number; error?: string };
  assert.equal(framesResponse.status, 200, frames.error);
  assert.equal(frames.ok, true);
  assert.equal(frames.sampleCount, 2);
  assert.deepEqual([...Buffer.from(frames.base64 ?? '', 'base64').subarray(0, 2)], [0xff, 0xd8]);
} finally {
  await server?.close();
  await rm(work, { recursive: true, force: true });
  if (previousMediaDir === undefined) delete process.env.MEDIA_DIR;
  else process.env.MEDIA_DIR = previousMediaDir;
}

process.stdout.write('media-preview-decode.verify: FFV1 grade/scene/poster/filmstrip/Agent frame+slice fallback passed\n');
