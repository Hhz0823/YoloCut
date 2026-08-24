import assert from 'node:assert/strict';

import { DerivativeQueue, resolveDerivativeConcurrency } from './derivative-queue.ts';

const GIB = 1024 ** 3;

assert.equal(resolveDerivativeConcurrency(4, 8 * GIB), 1);
assert.equal(resolveDerivativeConcurrency(8, 16 * GIB), 2);
assert.equal(resolveDerivativeConcurrency(16, 32 * GIB), 3);

let observedAbort = false;
const persistent = new DerivativeQueue(1, false);
const gate = Promise.withResolvers<void>();
const lease = persistent.acquire('long-4k-proxy', async (signal) => {
  signal.addEventListener('abort', () => { observedAbort = true; }, { once: true });
  await gate.promise;
  return 'ready';
});
lease.release();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(observedAbort, false, 'a detached long proxy must continue in the background');
gate.resolve();
assert.equal(await lease.promise, 'ready');

console.log('derivative-queue.verify: detached long proxy work remains alive until completion');
