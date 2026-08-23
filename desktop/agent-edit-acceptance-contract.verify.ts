import assert from 'node:assert/strict';
import { CURRENT_PROJECT_VERSION } from '../shared/project-version.ts';
import { historyReduce, type History } from '../src/editor/reduce.ts';
import type { ProjectDoc } from '../src/editor/types.ts';
import {
  acceptanceDocumentHash,
  requireAppliedSessionStatus,
  validateAgentEditTrace,
  type AgentEditToolTrace,
} from './agent-edit-acceptance-contract.ts';

const ok = (round: number, name: string, args: Record<string, unknown>, result: unknown): AgentEditToolTrace => ({
  round, name, args, result,
});

const trace = [
  ok(1, 'read_project', { view: 'assets' }, { assets: [{ id: 'asset' }] }),
  ok(1, 'read_timeline', {}, { items: [{ id: 'clip' }] }),
  ok(2, 'edit_item', {
    updates: [{ type: 'video', itemId: 'clip', durationInFrames: 120, volume: 0.65 }],
    adds: [{ type: 'text', text: 'Fixture Cut', track: 'V2', durationInFrames: 60 }],
  }, { ok: true }),
  ok(3, 'review_edit_session', {}, { status: 'awaiting_review' }),
];

const summary = validateAgentEditTrace(trace);
assert.deepEqual(summary.categories, ['title-or-caption', 'trim-or-split', 'volume-or-transition']);
assert.equal(summary.editToolCallCount, 1);
assert.equal(summary.reviewStatus, 'awaiting_review');
assert.throws(
  () => validateAgentEditTrace([ok(1, 'review_edit_session', {}, { status: 'awaiting_review' })]),
  /missing a successful read_project/,
  'assistant text or a bare review cannot masquerade as an edit pass',
);
assert.throws(
  () => validateAgentEditTrace([
    trace[0]!, trace[1]!,
    ok(2, 'edit_item', { updates: [{ type: 'video', durationInFrames: 120 }] }, { ok: true }),
    trace[3]!,
  ]),
  /only 1 edit category/,
  'one edit category is insufficient',
);
assert.throws(() => requireAppliedSessionStatus({ status: 'awaiting_review' }), /not applied/);
assert.doesNotThrow(() => requireAppliedSessionStatus({ status: 'applied' }));

const base: ProjectDoc = {
  version: CURRENT_PROJECT_VERSION,
  assets: [],
  mediaFolders: [],
  activeTimelineId: 'timeline',
  timelines: [{
    id: 'timeline', name: 'Fixture', order: 0, fps: 30, width: 640, height: 360,
    selectedId: null, items: [{
      id: 'clip', name: 'Fixture', kind: 'video', track: 'track_v1',
      startFrame: 0, durationInFrames: 180, volume: 1,
    }],
  }],
};
const edited: ProjectDoc = {
  ...base,
  timelines: [{
    ...base.timelines[0]!,
    items: [
      { ...base.timelines[0]!.items[0]!, durationInFrames: 120, volume: 0.65 },
      {
        id: 'title', name: 'Fixture Cut', kind: 'text', track: 'track_v2',
        startFrame: 0, durationInFrames: 60,
      },
    ],
  }],
};
const initial: History = { past: [], present: base, future: [] };
const committed = historyReduce(initial, { type: 'tl.setDoc', doc: edited });
assert.equal(committed.past.length, 1, 'a complete proposal is one history action');
const rolledBack = historyReduce(committed, { type: 'undo' });
assert.equal(acceptanceDocumentHash(rolledBack.present), acceptanceDocumentHash(base));

console.log('agent-edit-acceptance-contract.verify: tool proof, manual status, atomic rollback OK');
