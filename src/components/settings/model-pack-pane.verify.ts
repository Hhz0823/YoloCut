import assert from 'node:assert/strict';
import { executeModelPackMutation } from './model-pack-actions';

try {
  let receivedId: string | null = null;
  const receivedHeaders: Headers[] = [];
  let receivedAcceptance: string | undefined;
  await executeModelPackMutation('music-semantics-lite', async (id, headers, options) => {
    receivedId = id;
    receivedHeaders.push(new Headers(headers));
    receivedAcceptance = options?.licenseAcceptance;
  }, { licenseAcceptance: 'fixture-license' });

  assert.equal(receivedId, 'music-semantics-lite');
  assert.equal(receivedHeaders.length, 1);
  for (const name of receivedHeaders[0]?.keys() ?? []) {
    assert.ok(!/x-yolocut/i.test(name),
      `model-pack mutations must not carry credential headers (found ${name})`);
  }
  assert.equal(receivedHeaders[0]?.get('x-yolocut-editor-credential'), null,
    'no editor credential header may be attached');
  assert.equal(receivedAcceptance, 'fixture-license');
} finally {
  // Nothing else to restore: the mutation helper is pure now.
}

console.log('model-pack-pane.verify: loopback trust forwarded');
