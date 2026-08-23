import assert from 'node:assert/strict';
import { adaptivePreviewPremountFrames } from './mediaPerformance';

assert.equal(adaptivePreviewPremountFrames(30, 'economy'), 8);
assert.equal(adaptivePreviewPremountFrames(30, 'balanced'), 15);
assert.equal(adaptivePreviewPremountFrames(30, 'performance'), 30);
assert.equal(adaptivePreviewPremountFrames(60, 'economy'), 15);
assert.equal(adaptivePreviewPremountFrames(Number.NaN, null), 15);

console.log('mediaPerformance.verify: ok');
