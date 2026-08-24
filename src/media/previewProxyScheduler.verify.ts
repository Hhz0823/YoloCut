import assert from 'node:assert/strict';
import { PreviewProxyScheduler } from './previewProxyScheduler';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

const scheduler = new PreviewProxyScheduler(1);
const starts: string[] = [];
const low = deferred();
const high = deferred();

scheduler.enqueue('low', 10, async () => { starts.push('low'); await low.promise; });
scheduler.enqueue('high', 0, async () => { starts.push('high'); await high.promise; });
scheduler.enqueue('cancelled', -1, async () => { starts.push('cancelled'); });
assert.equal(scheduler.cancel('cancelled'), true);

await flush();
assert.deepEqual(starts, ['high'], 'the active/high-priority source starts first');
assert.deepEqual(scheduler.stats(), { queued: 1, running: 1, concurrency: 1 });

high.resolve();
await flush();
assert.deepEqual(starts, ['high', 'low'], 'only one heavyweight proxy runs at a time');
low.resolve();
await flush();
assert.deepEqual(scheduler.stats(), { queued: 0, running: 0, concurrency: 1 });

const deduped = new PreviewProxyScheduler(1);
deduped.enqueue('same', 2, async () => { starts.push('stale'); });
deduped.enqueue('same', 1, async () => { starts.push('deduped'); });
await flush();
assert.equal(starts.filter((value) => value === 'deduped').length, 1);
assert.equal(starts.includes('stale'), false, 'a queued source is updated instead of duplicated');

const adaptive = new PreviewProxyScheduler(1);
const first = deferred();
const second = deferred();
const adaptiveStarts: string[] = [];
adaptive.enqueue('first', 0, async () => { adaptiveStarts.push('first'); await first.promise; });
adaptive.enqueue('second', 1, async () => { adaptiveStarts.push('second'); await second.promise; });
await flush();
assert.deepEqual(adaptiveStarts, ['first']);
adaptive.setConcurrency(2);
await flush();
assert.deepEqual(adaptiveStarts, ['first', 'second'], 'performance profile can fill a second hardware proxy pipeline');
assert.deepEqual(adaptive.stats(), { queued: 0, running: 2, concurrency: 2 });
adaptive.setConcurrency(1);
assert.equal(adaptive.stats().running, 2, 'reducing the limit never aborts already-running work');
first.resolve();
second.resolve();
await flush();

console.log('previewProxyScheduler.verify: ok');
