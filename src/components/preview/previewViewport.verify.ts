import assert from 'node:assert/strict';
import {
  clampPreviewPan,
  clampPreviewZoom,
  stepPreviewZoom,
  zoomedPreviewCanvasSize,
} from './previewViewport';

assert.equal(clampPreviewZoom(Number.NaN), 1);
assert.equal(clampPreviewZoom(0), 0.25);
assert.equal(clampPreviewZoom(8), 4);
assert.equal(stepPreviewZoom(1, 1), 1.25);
assert.equal(stepPreviewZoom(1, -1), 0.75);
assert.deepEqual(zoomedPreviewCanvasSize({ width: 640, height: 360 }, 2), { width: 1280, height: 720 });
assert.deepEqual(clampPreviewPan({ x: 50, y: 50 }, { width: 640, height: 360 }, 1), { x: 0, y: 0 });
assert.deepEqual(clampPreviewPan({ x: 999, y: -999 }, { width: 640, height: 360 }, 2), { x: 320, y: -180 });

console.log('previewViewport.verify: fit-relative zoom steps and bounded pan passed');
