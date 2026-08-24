import assert from 'node:assert/strict';

import { MediaWorkAdmission, resolveMediaWorkConcurrency } from './media-work-admission.ts';

const GIB = 1024 ** 3;
assert.equal(resolveMediaWorkConcurrency(4, 8 * GIB, ''), 1);
assert.equal(resolveMediaWorkConcurrency(8, 16 * GIB, ''), 2);
assert.equal(resolveMediaWorkConcurrency(16, 32 * GIB, ''), 3);
assert.equal(resolveMediaWorkConcurrency(64, 64 * GIB, '99'), 4);

const admission = new MediaWorkAdmission(2);
const releaseFirst = await admission.acquire();
const releaseSecond = await admission.acquire();
const abort = new AbortController();
const cancelled = admission.acquire(abort.signal);
assert.deepEqual(admission.snapshot(), { active: 2, queued: 1, concurrency: 2 });
abort.abort();
await assert.rejects(cancelled, (error: unknown) => error instanceof Error && error.name === 'AbortError');
assert.deepEqual(admission.snapshot(), { active: 2, queued: 0, concurrency: 2 });

let thirdStarted = false;
const third = admission.acquire().then((release) => {
  thirdStarted = true;
  return release;
});
releaseFirst();
const releaseThird = await third;
assert.equal(thirdStarted, true);
assert.deepEqual(admission.snapshot(), { active: 2, queued: 0, concurrency: 2 });
releaseSecond();
releaseThird();
assert.deepEqual(admission.snapshot(), { active: 0, queued: 0, concurrency: 2 });

process.stdout.write('media-work-admission.verify: global CPU/RAM media budget passed\n');
