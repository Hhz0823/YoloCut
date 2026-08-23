import assert from 'node:assert/strict';
import type { ProjectDoc, TimelineState } from '../editor/types';
import {
  __previewProxyCacheStatsForVerify,
  __resetPreviewProxyStateForVerify,
  orderedPreviewSourcesForProject,
  PREVIEW_PROXY_CACHE_LIMIT,
  PREVIEW_PROXY_RETRY_MS,
  reportPreviewPlaybackFailure,
  requestPreviewProxy,
  resolveProjectPreviewSources,
  resolveTimelinePreviewSources,
} from './previewMedia';

const source = '/media/uploads/preview-force-check.mp4';
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  return Response.json({
    source: { src: source, durationMs: 1_000, width: 640, height: 360, fps: 30, codec: 'h264', longGop: false },
    proxy: calls === 1
      ? { status: 'not-needed', reason: 'source-compatible' }
      : { status: 'ready', reason: 'forced', previewSrc: '/api/preview-proxy-file?src=check' },
  });
};

await requestPreviewProxy(source);
await requestPreviewProxy(source, true);
await requestPreviewProxy(source, true);
assert.equal(calls, 2, 'forced proxy generation is retried once and cached after it is ready');

__resetPreviewProxyStateForVerify();
const realNow = Date.now;
let now = 1_000;
Date.now = () => now;
calls = 0;
globalThis.fetch = async () => {
  calls++;
  if (calls === 1) throw new Error('temporary driver failure');
  return Response.json({
    source: { src: source, durationMs: 1_000, width: 640, height: 360, fps: 30, codec: 'h264', longGop: false },
    proxy: { status: 'ready', reason: 'retry', previewSrc: '/api/preview-proxy-file?src=retry' },
  });
};
await requestPreviewProxy(source);
await requestPreviewProxy(source);
assert.equal(calls, 1, 'transient failures are cooled down instead of hammered');
now += PREVIEW_PROXY_RETRY_MS;
await requestPreviewProxy(source);
assert.equal(calls, 2, 'transient failures become retryable after the server cooldown');

reportPreviewPlaybackFailure(source, 'proxy decoder rejected stream');
now += PREVIEW_PROXY_RETRY_MS;
await requestPreviewProxy(source);
assert.equal(calls, 2, 'a known-bad proxy is not automatically retried after playback failure');
Date.now = realNow;

const timeline = {
  fps: 30,
  width: 1920,
  height: 1080,
  selectedId: null,
  items: [
    { id: 'later', kind: 'video', src: '/media/uploads/z.mp4', track: 'v1', startFrame: 90, durationInFrames: 30 },
    { id: 'first', kind: 'video', src: '/media/uploads/a.mp4', track: 'v1', startFrame: 0, durationInFrames: 30 },
    { id: 'repeat', kind: 'video', src: '/media/uploads/a.mp4', track: 'v1', startFrame: 30, durationInFrames: 30 },
    { id: 'audio', kind: 'audio', src: '/media/uploads/voice.wav', track: 'a1', startFrame: 0, durationInFrames: 30 },
  ],
} as unknown as TimelineState;

assert.equal(resolveTimelinePreviewSources(timeline, (src) => src), timeline, 'unchanged preview keeps timeline identity');
const resolvedTimeline = resolveTimelinePreviewSources(timeline, (src) => src.endsWith('/a.mp4') ? '/proxy/a.mp4' : src);
assert.notEqual(resolvedTimeline, timeline);
assert.notEqual(resolvedTimeline.items, timeline.items);
assert.equal(resolvedTimeline.items[0], timeline.items[0], 'unchanged clips keep object identity');
assert.equal(resolvedTimeline.items[3], timeline.items[3], 'non-video clips keep object identity');
assert.equal(resolvedTimeline.items[1]!.src, '/proxy/a.mp4');

const nestedTimeline = {
  ...timeline,
  id: 'nested',
  name: 'Nested',
  order: 1,
  items: [{
    id: 'nested-first', kind: 'video', src: '/media/uploads/nested.mp4', track: 'v1',
    startFrame: 0, durationInFrames: 30,
  }],
} as unknown as ProjectDoc['timelines'][number];
const activeTimeline = { ...timeline, id: 'active', name: 'Active', order: 0 };
const project = {
  activeTimelineId: 'active',
  timelines: [nestedTimeline, activeTimeline],
} as unknown as ProjectDoc;
assert.deepEqual(
  orderedPreviewSourcesForProject(project, 'active', ['nested', 'active']),
  ['/media/uploads/a.mp4', '/media/uploads/z.mp4', '/media/uploads/nested.mp4'],
  'active timeline and earliest clips determine proxy priority, not alphabetic path order',
);
const untouchedProject = resolveProjectPreviewSources(project, new Set(['active']), (src) => src);
assert.equal(untouchedProject, project, 'unchanged preview keeps project identity');
const resolvedProject = resolveProjectPreviewSources(
  project,
  new Set(['active']),
  (src) => src.endsWith('/z.mp4') ? '/proxy/z.mp4' : src,
);
assert.notEqual(resolvedProject, project);
assert.equal(resolvedProject.timelines[0], nestedTimeline, 'unreachable timelines are not cloned');
assert.notEqual(resolvedProject.timelines[1], activeTimeline);

__resetPreviewProxyStateForVerify();
globalThis.fetch = async (input) => Response.json({
  source: { src: String(input), durationMs: 1_000, width: 640, height: 360, fps: 30, codec: 'h264', longGop: false },
  proxy: { status: 'not-needed', reason: 'source-compatible' },
});
for (let index = 0; index < PREVIEW_PROXY_CACHE_LIMIT + 20; index++) {
  await requestPreviewProxy(`/media/uploads/cache-${index}.mp4`);
}
assert.equal(
  __previewProxyCacheStatsForVerify().entries,
  PREVIEW_PROXY_CACHE_LIMIT,
  'idle proxy metadata uses a bounded LRU cache in long editing sessions',
);

console.log('previewMedia.verify: ok');
