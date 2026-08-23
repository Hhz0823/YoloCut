import assert from 'node:assert/strict';
import { ffmpegThreadArgs, ffmpegThreadCount } from './media-process.ts';

const previous = process.env.YOLOCUT_FFMPEG_THREADS;
try {
  delete process.env.YOLOCUT_FFMPEG_THREADS;
  assert.equal(ffmpegThreadCount(8), 4);
  assert.deepEqual(ffmpegThreadArgs(4), ['-threads', '2']);
  assert.equal(ffmpegThreadCount(64), 12, 'workstation pools stay bounded');
  process.env.YOLOCUT_FFMPEG_THREADS = '2';
  assert.equal(ffmpegThreadCount(16), 2);
  process.env.YOLOCUT_FFMPEG_THREADS = '99';
  assert.equal(ffmpegThreadCount(4), 4, 'override must not exceed available cores');
} finally {
  if (previous === undefined) delete process.env.YOLOCUT_FFMPEG_THREADS;
  else process.env.YOLOCUT_FFMPEG_THREADS = previous;
}

console.log('media process thread limit verification passed');
