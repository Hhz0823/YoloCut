import assert from 'node:assert/strict';

import { ffmpegBin } from './media-binaries.ts';
import {
  parseVideoDecoderNames,
  resolveThirdPartyVideoDecoders,
  runVideoDecodeFallback,
  thirdPartyDecoderFallbacks,
  videoDecodeAttempts,
} from './media-decoder-fallback.ts';

const parsed = parseVideoDecoderNames(`
 VFS..D h264 H.264
 V....D libdav1d dav1d AV1
 V..... libvpx-vp9 libvpx VP9
 A....D aac AAC
`);
assert.deepEqual([...parsed], ['h264', 'libdav1d', 'libvpx-vp9']);
assert.deepEqual(
  thirdPartyDecoderFallbacks('av01', new Set(['libaom-av1', 'libdav1d'])),
  ['libdav1d', 'libaom-av1'],
  'dav1d is preferred when a full codec build provides it',
);
assert.deepEqual(thirdPartyDecoderFallbacks('vp09', new Set(['libvpx-vp9'])), ['libvpx-vp9']);

const attempts = videoDecodeAttempts(
  ['-hwaccel', 'cuda'],
  'av1',
  ['libaom-av1'],
);
assert.deepEqual(attempts, [
  { kind: 'hardware', decoder: 'cuda', inputArgs: ['-hwaccel', 'cuda'] },
  { kind: 'software', decoder: 'auto', inputArgs: [] },
  { kind: 'third-party', decoder: 'libaom-av1', inputArgs: ['-c:v', 'libaom-av1'] },
]);

const executed: string[] = [];
const cleaned: string[] = [];
const selected = await runVideoDecodeFallback(attempts, async (attempt) => {
  executed.push(attempt.decoder);
  if (attempt.kind === 'hardware') throw new Error('device rejected codec');
  return attempt.decoder;
}, { cleanup: (attempt) => { cleaned.push(attempt.decoder); } });
assert.equal(selected, 'auto');
assert.deepEqual(executed, ['cuda', 'auto']);
assert.deepEqual(cleaned, ['cuda']);

const cancelled = new AbortController();
cancelled.abort();
await assert.rejects(
  runVideoDecodeFallback(attempts, async () => 'unreachable', { signal: cancelled.signal }),
  (error: unknown) => error instanceof Error && error.name === 'AbortError',
);

const bundled = await resolveThirdPartyVideoDecoders(ffmpegBin());
assert.ok(bundled.includes('libaom-av1'), 'bundled FFmpeg must expose the libaom AV1 safety decoder');
assert.ok(bundled.includes('libvpx-vp9'), 'bundled FFmpeg must expose the libvpx VP9 safety decoder');
assert.ok(bundled.includes('libvpx'), 'bundled FFmpeg must expose the libvpx VP8 safety decoder');

process.stdout.write(`media-decoder-fallback.verify: ${bundled.join(', ')}\n`);
