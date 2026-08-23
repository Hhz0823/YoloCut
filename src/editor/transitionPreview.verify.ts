import assert from 'node:assert/strict';
import type { TimelineItem } from './types';
import {
  continuousVideoAudioGroups,
  frameInSortedRanges,
  mergeFrameRanges,
  timelineItemAtFrame,
} from './transitionAudio';
import { previewTransitionType } from './transitionPreview';

assert.equal(previewTransitionType('cross-dissolve'), 'cross-dissolve');
assert.equal(previewTransitionType('clean-line-wipe'), 'soft-wipe');
assert.equal(previewTransitionType('impact-shake'), 'whip-pan');
assert.equal(previewTransitionType('page-curl'), 'soft-wipe');
assert.equal(previewTransitionType('custom-shader'), 'cross-dissolve');

const outgoing = { id: 'out', kind: 'video', track: 'v1', src: '/x.mp4', startFrame: 0, durationInFrames: 30, srcInFrame: 0 } as unknown as TimelineItem;
const incoming = { id: 'in', kind: 'video', track: 'v1', src: '/x.mp4', startFrame: 30, durationInFrames: 30, srcInFrame: 30 } as unknown as TimelineItem;
assert.deepEqual(continuousVideoAudioGroups([incoming, outgoing]).map((group) => group.map((item) => item.id)), [['out', 'in']]);
assert.deepEqual(continuousVideoAudioGroups([outgoing, { ...incoming, srcInFrame: 31 }]), []);
assert.deepEqual(continuousVideoAudioGroups([outgoing, incoming], [{
  type: 'audio-cross-fade', outgoingItemId: 'out', incomingItemId: 'in', durationInFrames: 5,
}] as never), []);

const longSplitRun = Array.from({ length: 10_000 }, (_, index) => ({
  ...outgoing,
  id: `clip-${index}`,
  startFrame: index * 30,
  srcInFrame: index * 30,
})) as TimelineItem[];
assert.equal(timelineItemAtFrame(longSplitRun, 0)?.id, 'clip-0');
assert.equal(timelineItemAtFrame(longSplitRun, 150_017)?.id, 'clip-5000');
assert.equal(timelineItemAtFrame(longSplitRun, 299_999)?.id, 'clip-9999');
assert.equal(timelineItemAtFrame(longSplitRun, 300_000), undefined);

const mergedRanges = mergeFrameRanges([[90, 120], [0, 30], [20, 60], [60, 80], [120, 130]]);
assert.deepEqual(mergedRanges, [[0, 80], [90, 130]]);
assert.equal(frameInSortedRanges(mergedRanges, 79), true);
assert.equal(frameInSortedRanges(mergedRanges, 80), false);
assert.equal(frameInSortedRanges(mergedRanges, 100), true);

console.log('transitionPreview.verify: ok');
