import assert from 'node:assert/strict';

import { policyForTool } from '../execution-policy.ts';
import { isExternalRealTool } from '../external-tool-policy.ts';
import { TOOL_SCHEMAS } from '../tools.ts';
import { resetSharedKvMemory } from '../../persist/sharedKv.ts';
import { execAutoEditBatchTool } from './auto-edit-batch-tools.ts';

const schema = TOOL_SCHEMAS.find((candidate) => candidate.name === 'manage_auto_edit_batch');
assert(schema);
assert.deepEqual(policyForTool(schema.name), { effect: 'persistent_local', recovery: 'idempotent' });
assert.equal(isExternalRealTool(schema.name), true, 'connected Agents receive the same confirm-gated queue tool');
resetSharedKvMemory();
const listed = await execAutoEditBatchTool('manage_auto_edit_batch', { action: 'list' }, {} as never) as {
  ok?: boolean;
  batches?: unknown[];
};
assert.equal(listed.ok, true);
assert.deepEqual(listed.batches, []);

console.log('auto-edit-batch-tools.verify: catalog, policy and connected-Agent surface passed');
