import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ffmpegBin,
  ffmpegCandidates,
  ffprobeBin,
  ffprobeCandidates,
  runFfmpegFallback,
  siblingFfprobe,
  systemFfmpegBinary,
  systemFfprobeBinary,
} from './media-binaries.ts';

const work = await mkdtemp(join(tmpdir(), 'yolocut-codec-pack-'));
const suffix = process.platform === 'win32' ? '.exe' : '';
const ffmpeg = join(work, `ffmpeg${suffix}`);
const ffprobe = join(work, `ffprobe${suffix}`);
const previous = {
  codecPack: process.env.YOLOCUT_CODEC_PACK_DIR,
  ffmpeg: process.env.YOLOCUT_FFMPEG,
  ffprobe: process.env.YOLOCUT_FFPROBE,
  genericFfmpeg: process.env.FFMPEG_PATH,
  genericFfprobe: process.env.FFPROBE_PATH,
};
try {
  await writeFile(ffmpeg, 'fixture');
  await writeFile(ffprobe, 'fixture');
  delete process.env.YOLOCUT_FFMPEG;
  delete process.env.YOLOCUT_FFPROBE;
  delete process.env.FFMPEG_PATH;
  delete process.env.FFPROBE_PATH;
  process.env.YOLOCUT_CODEC_PACK_DIR = work;
  assert.equal(ffmpegBin(), ffmpeg);
  assert.equal(ffmpegCandidates()[0], ffmpeg);
  assert.ok(ffmpegCandidates().includes('ffmpeg'), 'PATH FFmpeg remains the last-resort candidate');
  assert.equal(ffprobeBin(), ffprobe, 'codec pack uses a matching probe binary');
  assert.equal(ffprobeCandidates()[0], ffprobe);
  assert.ok(ffprobeCandidates().includes('ffprobe'), 'PATH probe remains the last-resort candidate');
  assert.equal(siblingFfprobe(ffmpeg), ffprobe);
  assert.equal(systemFfprobeBinary('win32', () => true), null);
  assert.equal(systemFfmpegBinary('win32', () => true), null);
  assert.equal(
    systemFfmpegBinary('linux', (path) => path === '/usr/bin/ffmpeg'),
    '/usr/bin/ffmpeg',
  );
  assert.equal(
    systemFfprobeBinary('linux', (path) => path === '/usr/bin/ffprobe'),
    '/usr/bin/ffprobe',
  );

  const attempted: string[] = [];
  const fallback = await runFfmpegFallback(async (command) => {
    attempted.push(command);
    if (command === ffmpeg) throw new Error('simulated codec-pack crash');
    return command;
  });
  assert.ok(attempted.length >= 2, 'a failed preferred FFmpeg must try the next binary');
  assert.notEqual(fallback.command, ffmpeg);
} finally {
  for (const [key, value] of Object.entries(previous)) {
    const name = key === 'codecPack' ? 'YOLOCUT_CODEC_PACK_DIR'
      : key === 'ffmpeg' ? 'YOLOCUT_FFMPEG'
        : key === 'ffprobe' ? 'YOLOCUT_FFPROBE'
          : key === 'genericFfmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH';
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(work, { recursive: true, force: true });
}

process.stdout.write('media-binaries.verify: matched third-party codec pack binaries passed\n');
