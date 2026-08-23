import {
  AUTO_EDIT_BATCH_FORMAT,
  AUTO_EDIT_JOB_LEASE_MS,
  MAX_AUTO_EDIT_BATCH_JOBS,
  OPEN_SOURCE_AUTO_EDIT_MODEL,
  autoEditJobCounts,
  normalizeAutoEditSources,
  sanitizeAutoEditBatchScripts,
  type AutoEditBatch,
  type AutoEditBatchStatus,
  type AutoEditJob,
  type AutoEditJobStatus,
  type AutoEditReferenceStyle,
  type AutoEditSourceDescriptor,
} from '../../shared/auto-edit-batch.ts';
import { LEGACY_PORTABLE_FORMATS } from '../../shared/product-compat';
import { kvGet, kvSet } from './sharedKv';

const STORE_KEY = 'auto-edit-batches:v1';
const MAX_BATCHES = 100;
const MAX_PERSISTED_JOBS = 25_000;
const MAX_ERROR_CHARS = 4_000;
const MAX_OUTPUT_PATH_CHARS = 4_096;
const ACTIVE_JOB_STATUSES = new Set<AutoEditJobStatus>(['preparing', 'editing', 'rendering']);
let mutationQueue: Promise<unknown> = Promise.resolve();

interface StoredAutoEditBatches {
  readonly version: 1;
  readonly batches: readonly AutoEditBatch[];
}

export interface CreateAutoEditBatchInput {
  readonly ownerProjectId: string;
  readonly name: string;
  readonly sourceGrantId: string;
  readonly sources: readonly AutoEditSourceDescriptor[];
  readonly editScript?: string;
  readonly narrationScript?: string;
  readonly referenceAssetIds?: readonly string[];
  readonly plannerModelId?: string;
  readonly workerConcurrency?: number;
  readonly renderConcurrency?: number;
}

function id(prefix: string): string {
  const value = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? Math.max(1, Math.min(max, value))
    : fallback;
}

function validBatchStatus(value: unknown): value is AutoEditBatchStatus {
  return value === 'draft' || value === 'running' || value === 'paused'
    || value === 'completed' || value === 'cancelled';
}

function validJobStatus(value: unknown): value is AutoEditJobStatus {
  return value === 'queued' || value === 'preparing' || value === 'editing'
    || value === 'rendering' || value === 'succeeded' || value === 'failed'
    || value === 'cancelled';
}

function validJob(value: unknown): value is AutoEditJob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const job = value as Partial<AutoEditJob>;
  return typeof job.id === 'string' && job.id.length > 0 && job.id.length <= 200
    && typeof job.sourceId === 'string' && typeof job.sourceName === 'string'
    && (job.sourceKind === 'video' || job.sourceKind === 'image' || job.sourceKind === 'audio')
    && validJobStatus(job.status)
    && Number.isSafeInteger(job.attempts) && (job.attempts ?? -1) >= 0
    && Number.isFinite(job.createdAt) && Number.isFinite(job.updatedAt);
}

function validReferenceStyle(value: unknown): value is AutoEditReferenceStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const style = value as Partial<AutoEditReferenceStyle>;
  const metrics = style.sceneMetrics;
  const validMetrics = metrics === undefined || (metrics !== null && typeof metrics === 'object'
    && ['durationMs', 'detectedCuts', 'medianShotMs', 'p25ShotMs', 'p75ShotMs', 'cutsPerMinute']
      .every((key) => typeof Reflect.get(metrics, key) === 'number' && Number.isFinite(Reflect.get(metrics, key))));
  return validMetrics && style.structureOnly === true
    && ['summary', 'shotRhythm', 'visualStyle', 'captionStyle', 'transitionStyle', 'colorStyle', 'audioStyle']
      .every((key) => typeof Reflect.get(style, key) === 'string');
}

type StoredAutoEditBatch = Omit<AutoEditBatch, 'format'> & { readonly format: string };

function validBatch(value: unknown): value is StoredAutoEditBatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const batch = value as Partial<AutoEditBatch>;
  return (batch.format === AUTO_EDIT_BATCH_FORMAT
    || batch.format === LEGACY_PORTABLE_FORMATS.autoEditBatch)
    && typeof batch.id === 'string' && typeof batch.ownerProjectId === 'string'
    && typeof batch.name === 'string' && typeof batch.sourceGrantId === 'string'
    && validBatchStatus(batch.status)
    && typeof batch.editScript === 'string' && typeof batch.narrationScript === 'string'
    && Array.isArray(batch.referenceAssetIds) && batch.referenceAssetIds.every((item) => typeof item === 'string')
    && (batch.referenceStyle === undefined || validReferenceStyle(batch.referenceStyle))
    && typeof batch.plannerModelId === 'string'
    && Number.isSafeInteger(batch.workerConcurrency) && (batch.workerConcurrency ?? 0) >= 1
    && Number.isSafeInteger(batch.renderConcurrency) && (batch.renderConcurrency ?? 0) >= 1
    && Number.isFinite(batch.createdAt) && Number.isFinite(batch.updatedAt)
    && Array.isArray(batch.jobs) && batch.jobs.length <= MAX_AUTO_EDIT_BATCH_JOBS
    && batch.jobs.every(validJob);
}

async function readAll(): Promise<AutoEditBatch[]> {
  const stored = await kvGet<unknown>(STORE_KEY);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];
  const value = stored as Partial<StoredAutoEditBatches>;
  return value.version === 1 && Array.isArray(value.batches)
    ? value.batches
      .filter(validBatch)
      .slice(0, MAX_BATCHES)
      .map((batch): AutoEditBatch => ({ ...batch, format: AUTO_EDIT_BATCH_FORMAT }))
    : [];
}

function mutate<T>(operation: (batches: AutoEditBatch[]) => Promise<T> | T): Promise<T> {
  const current = mutationQueue.catch(() => undefined).then(async () => {
    const batches = await readAll();
    const result = await operation(batches);
    await kvSet(STORE_KEY, { version: 1, batches } satisfies StoredAutoEditBatches);
    return result;
  });
  mutationQueue = current;
  return current;
}

function replaceBatch(batches: AutoEditBatch[], next: AutoEditBatch): void {
  const index = batches.findIndex((batch) => batch.id === next.id);
  if (index < 0) throw new Error(`auto-edit batch not found: ${next.id}`);
  batches[index] = next;
}

function deriveStatus(batch: AutoEditBatch, jobs: readonly AutoEditJob[]): AutoEditBatchStatus {
  if (batch.status === 'cancelled') return 'cancelled';
  if (batch.status === 'paused') return 'paused';
  return jobs.every((job) => job.status === 'succeeded' || job.status === 'cancelled' || job.status === 'failed')
    ? 'completed'
    : batch.status;
}

function recoverExpiredJobs(batch: AutoEditBatch, now: number): AutoEditBatch {
  let changed = false;
  const jobs = batch.jobs.map((job) => {
    if (!ACTIVE_JOB_STATUSES.has(job.status) || !job.leaseExpiresAt || job.leaseExpiresAt > now) return job;
    changed = true;
    return {
      ...job,
      status: 'queued' as const,
      updatedAt: now,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      error: '上一次工作进程租约超时，任务已安全回到队列。',
    };
  });
  return changed ? { ...batch, jobs, updatedAt: now } : batch;
}

export async function listAutoEditBatches(): Promise<AutoEditBatch[]> {
  return (await readAll()).sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getAutoEditBatch(batchId: string): Promise<AutoEditBatch | null> {
  return (await readAll()).find((batch) => batch.id === batchId) ?? null;
}

export function createAutoEditBatch(input: CreateAutoEditBatchInput): Promise<AutoEditBatch> {
  const sources = normalizeAutoEditSources(input.sources);
  if (!sources.length || sources.length !== input.sources.length) {
    return Promise.reject(new Error(`批量素材必须包含 1-${MAX_AUTO_EDIT_BATCH_JOBS} 个有效文件`));
  }
  if (!input.ownerProjectId.trim() || !input.sourceGrantId.trim()) {
    return Promise.reject(new Error('ownerProjectId and sourceGrantId are required'));
  }
  const scripts = sanitizeAutoEditBatchScripts(input);
  return mutate((batches) => {
    let persistedJobs = batches.reduce((sum, batch) => sum + batch.jobs.length, 0);
    for (let index = batches.length - 1;
      persistedJobs + sources.length > MAX_PERSISTED_JOBS && index >= 0;
      index -= 1) {
      const candidate = batches[index]!;
      if (candidate.status !== 'completed' && candidate.status !== 'cancelled') continue;
      persistedJobs -= candidate.jobs.length;
      batches.splice(index, 1);
    }
    if (persistedJobs + sources.length > MAX_PERSISTED_JOBS) {
      throw new Error(`已有运行中的批次占用 ${persistedJobs} 条任务；请完成或取消旧批次后再建立新批次`);
    }
    const now = Date.now();
    const batch: AutoEditBatch = {
      format: AUTO_EDIT_BATCH_FORMAT,
      id: id('batch'),
      ownerProjectId: input.ownerProjectId.trim(),
      name: input.name.trim().slice(0, 200) || `批量自动剪辑 ${new Date(now).toLocaleString()}`,
      sourceGrantId: input.sourceGrantId.trim(),
      status: 'running',
      ...scripts,
      referenceAssetIds: [...new Set(input.referenceAssetIds ?? [])].filter(Boolean).slice(0, 16),
      plannerModelId: input.plannerModelId?.trim() || OPEN_SOURCE_AUTO_EDIT_MODEL.packId,
      workerConcurrency: boundedInteger(input.workerConcurrency, 1, 4),
      renderConcurrency: boundedInteger(input.renderConcurrency, 1, 2),
      createdAt: now,
      updatedAt: now,
      jobs: sources.map((source): AutoEditJob => ({
        id: id('job'),
        sourceId: source.id,
        sourceName: source.name,
        sourceKind: source.kind,
        status: 'queued',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      })),
    };
    batches.unshift(batch);
    if (batches.length > MAX_BATCHES) batches.length = MAX_BATCHES;
    return batch;
  });
}

export function controlAutoEditBatch(
  batchId: string,
  action: 'pause' | 'resume' | 'cancel' | 'retry_failed',
): Promise<AutoEditBatch> {
  return mutate((batches) => {
    const current = batches.find((batch) => batch.id === batchId);
    if (!current) throw new Error(`auto-edit batch not found: ${batchId}`);
    const now = Date.now();
    let jobs = current.jobs;
    let status = current.status;
    if (action === 'pause') status = current.status === 'completed' ? current.status : 'paused';
    if (action === 'resume') status = current.status === 'completed' ? current.status : 'running';
    if (action === 'cancel') {
      status = 'cancelled';
      jobs = current.jobs.map((job) => job.status === 'succeeded' || job.status === 'failed'
        ? job
        : { ...job, status: 'cancelled' as const, leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: now });
    }
    if (action === 'retry_failed') {
      status = 'running';
      jobs = current.jobs.map((job) => job.status === 'failed'
        ? { ...job, status: 'queued' as const, error: undefined, leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: now }
        : job);
    }
    const next = { ...current, jobs, status, updatedAt: now };
    replaceBatch(batches, next);
    return next;
  });
}

export function claimNextAutoEditJob(batchId: string, workerId: string): Promise<{
  batch: AutoEditBatch;
  job: AutoEditJob | null;
  reason?: string;
}> {
  return mutate((batches) => {
    const raw = batches.find((batch) => batch.id === batchId);
    if (!raw) throw new Error(`auto-edit batch not found: ${batchId}`);
    const now = Date.now();
    const current = recoverExpiredJobs(raw, now);
    if (current.status !== 'running') {
      replaceBatch(batches, current);
      return { batch: current, job: null, reason: `batch is ${current.status}` };
    }
    const active = current.jobs.filter((job) => ACTIVE_JOB_STATUSES.has(job.status)
      && (job.leaseExpiresAt ?? 0) > now).length;
    if (active >= current.workerConcurrency) {
      replaceBatch(batches, current);
      return { batch: current, job: null, reason: 'worker concurrency limit reached' };
    }
    const index = current.jobs.findIndex((job) => job.status === 'queued');
    if (index < 0) {
      const status = deriveStatus(current, current.jobs);
      const next = status === current.status ? current : { ...current, status, updatedAt: now };
      replaceBatch(batches, next);
      return { batch: next, job: null, reason: 'no queued jobs' };
    }
    const claimed: AutoEditJob = {
      ...current.jobs[index]!,
      status: 'preparing',
      attempts: current.jobs[index]!.attempts + 1,
      leaseOwner: workerId.slice(0, 160),
      leaseExpiresAt: now + AUTO_EDIT_JOB_LEASE_MS,
      error: undefined,
      updatedAt: now,
    };
    const jobs = [...current.jobs];
    jobs[index] = claimed;
    const next = { ...current, jobs, updatedAt: now };
    replaceBatch(batches, next);
    return { batch: next, job: claimed };
  });
}

export function updateAutoEditJob(
  batchId: string,
  jobId: string,
  workerId: string,
  update: {
    status?: 'preparing' | 'editing' | 'rendering' | 'succeeded' | 'failed';
    projectId?: string;
    sourceAssetId?: string;
    outputPath?: string;
    error?: string;
    heartbeat?: boolean;
  },
): Promise<AutoEditBatch> {
  return mutate((batches) => {
    const batch = batches.find((candidate) => candidate.id === batchId);
    if (!batch) throw new Error(`auto-edit batch not found: ${batchId}`);
    const index = batch.jobs.findIndex((job) => job.id === jobId);
    if (index < 0) throw new Error(`auto-edit job not found: ${jobId}`);
    const current = batch.jobs[index]!;
    if (current.leaseOwner !== workerId) throw new Error('auto-edit job lease owner mismatch');
    if (update.status === 'rendering') {
      const activeRenders = batch.jobs.filter((job) => job.id !== jobId
        && job.status === 'rendering'
        && (job.leaseExpiresAt ?? 0) > Date.now()).length;
      if (activeRenders >= batch.renderConcurrency) {
        throw new Error('render concurrency limit reached; keep this job in editing and retry later');
      }
    }
    const now = Date.now();
    const terminal = update.status === 'succeeded' || update.status === 'failed';
    const nextJob: AutoEditJob = {
      ...current,
      ...(update.status ? { status: update.status } : {}),
      ...(update.projectId ? { projectId: update.projectId.slice(0, 160) } : {}),
      ...(update.sourceAssetId ? { sourceAssetId: update.sourceAssetId.slice(0, 200) } : {}),
      ...(update.outputPath ? { outputPath: update.outputPath.slice(0, MAX_OUTPUT_PATH_CHARS) } : {}),
      ...(update.error ? { error: update.error.slice(0, MAX_ERROR_CHARS) } : {}),
      leaseOwner: terminal ? undefined : current.leaseOwner,
      leaseExpiresAt: terminal ? undefined : now + AUTO_EDIT_JOB_LEASE_MS,
      updatedAt: now,
    };
    const jobs = [...batch.jobs];
    jobs[index] = nextJob;
    const next = {
      ...batch,
      jobs,
      status: deriveStatus(batch, jobs),
      updatedAt: now,
    };
    replaceBatch(batches, next);
    return next;
  });
}

export function setAutoEditReferenceStyle(
  batchId: string,
  style: AutoEditReferenceStyle,
): Promise<AutoEditBatch> {
  if (!validReferenceStyle(style)) return Promise.reject(new Error('invalid reference style'));
  return mutate((batches) => {
    const batch = batches.find((candidate) => candidate.id === batchId);
    if (!batch) throw new Error(`auto-edit batch not found: ${batchId}`);
    const next = { ...batch, referenceStyle: style, updatedAt: Date.now() };
    replaceBatch(batches, next);
    return next;
  });
}

export function autoEditBatchSummary(batch: AutoEditBatch): Record<string, unknown> {
  return {
    id: batch.id,
    name: batch.name,
    status: batch.status,
    jobs: batch.jobs.length,
    counts: autoEditJobCounts(batch),
    workerConcurrency: batch.workerConcurrency,
    renderConcurrency: batch.renderConcurrency,
    plannerModelId: batch.plannerModelId,
    hasEditScript: Boolean(batch.editScript),
    hasNarrationScript: Boolean(batch.narrationScript),
    referenceAssetIds: batch.referenceAssetIds,
    referenceStyle: batch.referenceStyle ?? null,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}
