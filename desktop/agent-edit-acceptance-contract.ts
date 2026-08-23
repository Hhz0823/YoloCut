import { createHash } from 'node:crypto';

export const AGENT_EDIT_ACCEPTANCE_MODEL = 'gemini-3.7-flash';
export const AGENT_EDIT_ACCEPTANCE_PROJECT_ID = 'agent-acceptance-fixture';
export const AGENT_EDIT_ACCEPTANCE_PROJECT_NAME = 'Agent Acceptance Fixture';
export const AGENT_EDIT_ACCEPTANCE_CLIP_ID = 'clip_acceptance_video';
export const AGENT_EDIT_ACCEPTANCE_ASSET_ID = 'asset_acceptance_video';
export const AGENT_EDIT_ACCEPTANCE_SOURCE_FRAMES = 180;

export interface AgentEditToolTrace {
  readonly round: number;
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly result: unknown;
  readonly isError?: boolean;
}

export interface AgentEditTraceSummary {
  readonly toolNames: string[];
  readonly editToolCallCount: number;
  readonly categories: string[];
  readonly reviewStatus: 'awaiting_review';
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function successful(entry: AgentEditToolTrace): boolean {
  if (entry.isError) return false;
  const result = record(entry.result);
  if (!result) return true;
  return typeof result.error !== 'string'
    && result.outcome !== 'failed'
    && result.outcome !== 'rejected'
    && result.outcome !== 'cancelled'
    && result.outcome !== 'stale';
}

function editCategories(entry: AgentEditToolTrace): string[] {
  if (!successful(entry)) return [];
  if (entry.name === 'split_item') return ['trim-or-split'];
  if (entry.name === 'edit_captions') return ['title-or-caption'];
  if (entry.name !== 'edit_item') return [];
  const categories = new Set<string>();
  const updates = Array.isArray(entry.args.updates) ? entry.args.updates : [];
  const adds = Array.isArray(entry.args.adds) ? entry.args.adds : [];
  for (const value of updates) {
    const update = record(value);
    if (!update) continue;
    if (typeof update.durationInFrames === 'number' || typeof update.srcInFrame === 'number') {
      categories.add('trim-or-split');
    }
    if (typeof update.volume === 'number') categories.add('volume-or-transition');
  }
  for (const value of adds) {
    const add = record(value);
    if (!add) continue;
    if (add.type === 'text') categories.add('title-or-caption');
    if (add.type === 'transition') categories.add('volume-or-transition');
  }
  return [...categories];
}

function statusOf(value: unknown): unknown {
  return record(value)?.status;
}

/**
 * Fail closed unless the trace proves that the model inspected assets and the
 * timeline, executed meaningful edits in at least two categories, and ended
 * with a manual proposal. Assistant prose alone can never satisfy this gate.
 */
export function validateAgentEditTrace(
  trace: readonly AgentEditToolTrace[],
): AgentEditTraceSummary {
  const assetRead = trace.findIndex((entry) => (
    entry.name === 'read_project'
    && entry.args.view === 'assets'
    && successful(entry)
  ));
  const timelineRead = trace.findIndex((entry) => entry.name === 'read_timeline' && successful(entry));
  const edits = trace
    .map((entry, index) => ({ entry, index, categories: editCategories(entry) }))
    .filter((value) => value.categories.length > 0);
  const review = trace.findIndex((entry) => (
    entry.name === 'review_edit_session'
    && successful(entry)
    && statusOf(entry.result) === 'awaiting_review'
  ));
  if (assetRead < 0) throw new Error('acceptance trace is missing a successful read_project(view=assets) call');
  if (timelineRead < 0) throw new Error('acceptance trace is missing a successful read_timeline call');
  if (!edits.length) throw new Error('acceptance trace contains no successful editing tool call');
  const firstEdit = Math.min(...edits.map((value) => value.index));
  const lastEdit = Math.max(...edits.map((value) => value.index));
  if (assetRead > firstEdit || timelineRead > firstEdit) {
    throw new Error('acceptance edits ran before the model inspected assets and timeline');
  }
  if (review < 0 || review < lastEdit) {
    throw new Error('acceptance trace did not finish with an awaiting_review proposal');
  }
  const categories = [...new Set(edits.flatMap((value) => value.categories))].sort();
  if (categories.length < 2) {
    throw new Error(`acceptance trace covered only ${categories.length} edit category`);
  }
  return {
    toolNames: trace.map((entry) => entry.name),
    editToolCallCount: edits.length,
    categories,
    reviewStatus: 'awaiting_review',
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function acceptanceDocumentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function requireAppliedSessionStatus(value: unknown): void {
  const status = statusOf(value);
  if (status !== 'applied') {
    throw new Error(`manual proposal is not applied (status=${String(status ?? 'unknown')})`);
  }
}
