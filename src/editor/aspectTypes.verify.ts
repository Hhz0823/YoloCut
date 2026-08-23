import assert from 'node:assert/strict';
import {
  CANVAS_DIMENSION_MAX,
  CANVAS_DIMENSION_MIN,
  canvasDimensionFromInput,
  customCanvasSize,
  ratioLabel,
} from './aspectTypes';
import { reduce } from './reduce';
import type { TimelineState } from './types';

assert.equal(canvasDimensionFromInput(String(CANVAS_DIMENSION_MIN)), CANVAS_DIMENSION_MIN);
assert.equal(canvasDimensionFromInput(CANVAS_DIMENSION_MAX), CANVAS_DIMENSION_MAX);
assert.equal(canvasDimensionFromInput('15'), null);
assert.equal(canvasDimensionFromInput('8193'), null);
assert.equal(canvasDimensionFromInput('1080.5'), null);
assert.equal(canvasDimensionFromInput(''), null);
assert.deepEqual(customCanvasSize('2160', '3840'), { width: 2160, height: 3840 });
assert.equal(customCanvasSize('bad', '1080'), null);
assert.equal(ratioLabel(2160, 3840), '9:16');

const state: TimelineState = { fps: 30, width: 1920, height: 1080, items: [], selectedId: null };
const custom = reduce(state, { type: 'setCanvas', width: 2048, height: 858, fit: 'cover' });
assert.equal(custom.width, 2048);
assert.equal(custom.height, 858);
assert.equal(custom.fit, 'cover');
assert.strictEqual(reduce(state, { type: 'setCanvas', width: 0, height: 1080 }), state);
assert.strictEqual(reduce(state, { type: 'setCanvas', width: 1920.5, height: 1080 }), state);

console.log('aspectTypes.verify: bounded integer custom canvas sizes passed');
