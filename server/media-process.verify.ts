import assert from 'node:assert/strict';
import {
  ffmpegThreadArgs,
  ffmpegThreadCount,
  mediaProcessArgs,
  resolveMediaCpuBudget,
} from './media-process.ts';

const GIB = 1024 ** 3;

const previous = process.env.YOLOCUT_FFMPEG_THREADS;
try {
  delete process.env.YOLOCUT_FFMPEG_THREADS;
  assert.equal(ffmpegThreadCount(8, 16 * GIB), 3);
  assert.deepEqual(ffmpegThreadArgs(4, 8 * GIB), ['-threads', '2']);
  assert.deepEqual(
    mediaProcessArgs('ffprobe', ['-v', 'error'], 4, 8 * GIB),
    ['-v', 'error'],
    'probe commands must never receive FFmpeg encoder thread options',
  );
  assert.deepEqual(
    mediaProcessArgs('ffmpeg', ['-v', 'error'], 4, 8 * GIB),
    ['-threads', '2', '-v', 'error'],
  );
  assert.equal(ffmpegThreadCount(64, 64 * GIB), 16, 'workstation pools use more cores but stay bounded');
  assert.deepEqual(resolveMediaCpuBudget(4, 8 * GIB), {
    logicalCores: 4,
    totalMemoryBytes: 8 * GIB,
    ffmpegThreadsPerProcess: 2,
    backgroundProcessConcurrency: 1,
  });
  assert.equal(resolveMediaCpuBudget(16, 32 * GIB).backgroundProcessConcurrency, 3);
  const workstation = resolveMediaCpuBudget(16, 32 * GIB);
  assert.ok(
    workstation.ffmpegThreadsPerProcess * workstation.backgroundProcessConcurrency <= 12,
    'background workers reserve at least one quarter of logical cores for the editor',
  );
  process.env.YOLOCUT_FFMPEG_THREADS = '2';
  assert.equal(ffmpegThreadCount(16, 32 * GIB), 2);
  process.env.YOLOCUT_FFMPEG_THREADS = '99';
  assert.equal(ffmpegThreadCount(4, 8 * GIB), 4, 'override must not exceed available cores');
} finally {
  if (previous === undefined) delete process.env.YOLOCUT_FFMPEG_THREADS;
  else process.env.YOLOCUT_FFMPEG_THREADS = previous;
}

console.log('media process thread limit verification passed');
