import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ffmpegBin } from './media-binaries.ts';
import { probeMediaDurationSeconds, probeVideoInfo } from './media-probe.ts';

const work = await mkdtemp(join(tmpdir(), 'yolocut-media-probe-'));
try {
  const video = join(work, 'probe.mp4');
  const generated = spawnSync(ffmpegBin(), [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24:duration=0.5',
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video,
  ], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const info = await probeVideoInfo(video, { errorLabel: 'verification video' });
  assert.equal(info.video.codec, 'h264');
  assert.deepEqual([info.video.width, info.video.height], [160, 90]);
  assert.ok(info.durationSeconds >= 0.45 && info.durationSeconds <= 0.6);
  assert.equal(await probeMediaDurationSeconds(video), info.durationSeconds);

  const image = join(work, 'still.png');
  const generatedImage = spawnSync(ffmpegBin(), [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:size=64x64', '-frames:v', '1', image,
  ], { encoding: 'utf8' });
  assert.equal(generatedImage.status, 0, generatedImage.stderr);
  const still = await probeVideoInfo(image, { allowMissingDuration: true, errorLabel: 'verification still' });
  assert.equal(still.video.codec, 'png');
  assert.equal(still.durationSeconds, 0);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    probeVideoInfo(video, { signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
} finally {
  await rm(work, { recursive: true, force: true });
}

process.stdout.write('media-probe.verify: bundled ffprobe video/still/cancellation contract passed\n');
