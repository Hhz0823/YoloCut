import assert from 'node:assert/strict';
import { LEGACY_PORTABLE_FORMATS } from '../../shared/product-compat';

import { kvSet, resetSharedKvMemory } from './sharedKv.ts';
import {
  claimNextAutoEditJob,
  controlAutoEditBatch,
  createAutoEditBatch,
  getAutoEditBatch,
  updateAutoEditJob,
} from './autoEditBatchStore.ts';

resetSharedKvMemory();
const batch = await createAutoEditBatch({
  ownerProjectId: 'project-a',
  name: '千条测试',
  sourceGrantId: 'grant-a',
  workerConcurrency: 1,
  sources: [
    { id: 'source-a', name: 'a.mp4', relativeName: 'a.mp4', kind: 'video', sizeBytes: 10 },
    { id: 'source-b', name: 'b.mp4', relativeName: 'b.mp4', kind: 'video', sizeBytes: 20 },
  ],
});
const first = await claimNextAutoEditJob(batch.id, 'worker-a');
assert(first.job);
assert.equal((await claimNextAutoEditJob(batch.id, 'worker-b')).job, null, 'concurrency is enforced');
await updateAutoEditJob(batch.id, first.job.id, 'worker-a', { status: 'succeeded', outputPath: 'out/a.mp4' });
const second = await claimNextAutoEditJob(batch.id, 'worker-b');
assert(second.job);
await updateAutoEditJob(batch.id, second.job.id, 'worker-b', { status: 'failed', error: 'render failed' });
assert.equal((await getAutoEditBatch(batch.id))?.status, 'completed');
const retried = await controlAutoEditBatch(batch.id, 'retry_failed');
assert.equal(retried.status, 'running');
assert.equal(retried.jobs.filter((job) => job.status === 'queued').length, 1);
await kvSet('auto-edit-batches:v1', {
  version: 1,
  batches: [{ ...retried, format: LEGACY_PORTABLE_FORMATS.autoEditBatch }],
});
assert.equal(
  (await getAutoEditBatch(batch.id))?.format,
  'yolocut-auto-edit-batch@1',
  'historical batch records normalize to YoloCut',
);

const renderGate = await createAutoEditBatch({
  ownerProjectId: 'project-b', name: 'render gate', sourceGrantId: 'grant-b',
  workerConcurrency: 2, renderConcurrency: 1,
  sources: [
    { id: 'source-c', name: 'c.mp4', relativeName: 'c.mp4', kind: 'video', sizeBytes: 30 },
    { id: 'source-d', name: 'd.mp4', relativeName: 'd.mp4', kind: 'video', sizeBytes: 40 },
  ],
});
const renderA = (await claimNextAutoEditJob(renderGate.id, 'worker-c')).job!;
const renderB = (await claimNextAutoEditJob(renderGate.id, 'worker-d')).job!;
await updateAutoEditJob(renderGate.id, renderA.id, 'worker-c', { status: 'rendering' });
await assert.rejects(
  updateAutoEditJob(renderGate.id, renderB.id, 'worker-d', { status: 'rendering' }),
  /render concurrency limit/,
);

console.log('autoEditBatchStore.verify: durable claim/concurrency/complete/retry flow passed');
