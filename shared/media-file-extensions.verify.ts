import assert from 'node:assert/strict';

import {
  VIDEO_FILE_PICKER_ACCEPT,
  VIDEO_EXTENSION_BY_MIME,
  isVideoFileName,
  videoMimeForFileName,
} from './media-file-extensions.ts';

for (const file of ['camera.MXF', 'clip.MTS', 'disc.VOB', 'legacy.WMV', 'stream.flv?token=1']) {
  assert.equal(isVideoFileName(file), true, `${file} must enter the native decoder pipeline`);
}
assert.equal(isVideoFileName('notes.txt'), false);
assert.equal(videoMimeForFileName('camera.m2ts'), 'video/mp2t');
assert.equal(videoMimeForFileName('grade.mxf'), 'application/mxf');
assert.equal(VIDEO_EXTENSION_BY_MIME['video/mp4'], '.mp4');
assert.match(VIDEO_FILE_PICKER_ACCEPT, /\.rmvb/);

process.stdout.write('media-file-extensions.verify: portable FFmpeg container contract passed\n');
