import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bezierCurvePath, editableBezierControlPoints, normalizeBezierControlPoints } from './bezierCurve';

assert.deepEqual(normalizeBezierControlPoints([-1, 0.25, 2, Number.NaN]), [0, 0.25, 1, 0]);
assert.deepEqual(editableBezierControlPoints('easeInOut'), [0.42, 0, 0.58, 1]);
assert.deepEqual(editableBezierControlPoints(undefined), [0, 0, 1, 1]);
assert.equal(bezierCurvePath([0.25, 0.1, 0.25, 1]), 'M 16 124 C 68 113.2, 68 16, 224 16');

const source = readFileSync(new URL('./BezierCurveEditor.tsx', import.meta.url), 'utf8');
assert.match(source, /role="dialog"/);
assert.match(source, /cubic-bezier/);
assert.equal((source.match(/type="number"/g) ?? []).length, 1, 'one mapped numeric-input template renders four values');
assert.match(source, /\(\[p1, p2\] as const\)\.map/);

console.log('BezierCurveEditor.verify: presets, path, handles, and numeric controls passed');
