export { AUTO_EDIT_BATCH_TOOL_NAMES, AUTO_EDIT_BATCH_TOOL_SCHEMAS } from './schemas/auto-edit-batch-tools';

import type { AgentContext } from '../context';
import { directoryFileToAsset } from '../../media/directoryImportAsset';
import { createProject, loadProject } from '../../persist/projectStore';
import {
  autoEditBatchSummary,
  claimNextAutoEditJob,
  controlAutoEditBatch,
  createAutoEditBatch,
  getAutoEditBatch,
  listAutoEditBatches,
  setAutoEditReferenceStyle,
  updateAutoEditJob,
} from '../../persist/autoEditBatchStore';
import { autoEditReferenceSceneMetrics, buildAutoEditBatchPrompt } from '../../../shared/auto-edit-batch';
import type { AutoEditSourceSelection } from '../../../shared/auto-edit-source';
import { emptyProjectDoc } from './project-tools';
import { renderAssetFrameEvidence } from './frames-tool';
import { execSceneDetectionTool } from './scene-detection-tools';

type Args = Record<string, unknown>;

function desktopBatchApi(): Pick<NonNullable<Window['yoloCutDesktop']>,
  'listAutoEditSources' | 'importAutoEditSource'> | null {
  return typeof window === 'undefined' ? null : window.yoloCutDesktop ?? null;
}

function requiredString(args: Args, name: string): string {
  const value = typeof args[name] === 'string' ? args[name].trim() : '';
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function createBatch(args: Args, ctx: AgentContext): Promise<unknown> {
  const api = desktopBatchApi();
  if (!api) return { error: '批量目录授权仅在 YoloCut 桌面版可用。' };
  const sourceGrantId = requiredString(args, 'sourceGrantId');
  const selection: AutoEditSourceSelection | null = await api.listAutoEditSources(sourceGrantId);
  if (!selection) return { error: '批量素材授权已失效，请在 Agent 工作台重新选择目录。' };
  const ownerProjectId = ctx.getProjectId?.();
  if (!ownerProjectId) return { error: '请先打开用于保存批次配置的工程。' };
  const batch = await createAutoEditBatch({
    ownerProjectId,
    sourceGrantId,
    sources: selection.sources,
    name: typeof args.name === 'string' ? args.name : selection.directoryName,
    editScript: typeof args.editScript === 'string' ? args.editScript : '',
    narrationScript: typeof args.narrationScript === 'string' ? args.narrationScript : '',
    referenceAssetIds: Array.isArray(args.referenceAssetIds)
      ? args.referenceAssetIds.filter((value): value is string => typeof value === 'string')
      : [],
    workerConcurrency: typeof args.workerConcurrency === 'number' ? args.workerConcurrency : 1,
    renderConcurrency: typeof args.renderConcurrency === 'number' ? args.renderConcurrency : 1,
  });
  return { ok: true, batch: autoEditBatchSummary(batch), prompt: buildAutoEditBatchPrompt(batch) };
}

async function materializeClaim(
  batchId: string,
  workerId: string,
): Promise<unknown> {
  const api = desktopBatchApi();
  if (!api) return { error: '批量任务素材只可在 YoloCut 桌面版中实例化。' };
  const claimed = await claimNextAutoEditJob(batchId, workerId);
  if (!claimed.job) return { ok: true, job: null, reason: claimed.reason, batch: autoEditBatchSummary(claimed.batch) };
  const job = claimed.job;
  try {
    if (job.projectId && job.sourceAssetId) {
      return {
        ok: true, job, batch: autoEditBatchSummary(claimed.batch),
        editingPrompt: buildAutoEditBatchPrompt(claimed.batch),
      };
    }
    const imported = await api.importAutoEditSource({
      grantId: claimed.batch.sourceGrantId,
      sourceId: job.sourceId,
      projectId: claimed.batch.ownerProjectId,
      knownHashes: [],
    });
    if (!imported.file) throw new Error('素材已存在但没有可用于新工程的导入回执，请重新扫描批次目录');
    const owner = await loadProject(claimed.batch.ownerProjectId);
    const base = emptyProjectDoc();
    const sourceAsset = await directoryFileToAsset(
      { ...imported.file, importId: crypto.randomUUID() },
      base.timelines[0]?.fps ?? 30,
    );
    const references = (owner?.assets ?? [])
      .filter((asset) => claimed.batch.referenceAssetIds.includes(asset.id))
      .filter((asset) => asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'gif')
      .map((asset) => ({ ...asset, folderId: undefined }));
    const doc = { ...base, assets: [sourceAsset, ...references] };
    const meta = await createProject(`${claimed.batch.name} · ${job.sourceName}`, doc, {
      description: `Auto-edit ${claimed.batch.id} / ${job.id}`,
    });
    const next = await updateAutoEditJob(batchId, job.id, workerId, {
      status: 'editing', projectId: meta.id, sourceAssetId: sourceAsset.id,
    });
    return {
      ok: true,
      job: next.jobs.find((candidate) => candidate.id === job.id),
      batch: autoEditBatchSummary(next),
      editorProjectId: meta.id,
      sourceAsset: { id: sourceAsset.id, name: sourceAsset.name, kind: sourceAsset.kind },
      referenceAssetIds: references.map((asset) => asset.id),
      editingPrompt: buildAutoEditBatchPrompt(next),
      nextStep: 'Call target_project with editorProjectId, execute the edit, export, then complete/fail this lease.',
    };
  } catch (error) {
    await updateAutoEditJob(batchId, job.id, workerId, {
      status: 'failed', error: error instanceof Error ? error.message : String(error),
    });
    return { error: error instanceof Error ? error.message : String(error), jobId: job.id };
  }
}

async function analyzeReference(args: Args, ctx: AgentContext): Promise<unknown> {
  const batchId = requiredString(args, 'batchId');
  const batch = await getAutoEditBatch(batchId);
  if (!batch) return { error: `auto-edit batch not found: ${batchId}` };
  const assetId = typeof args.assetId === 'string' && args.assetId.trim()
    ? args.assetId.trim()
    : batch.referenceAssetIds[0];
  if (!assetId) return { error: 'batch has no reference video asset' };
  const evidence = await renderAssetFrameEvidence({ assetId, count: 12 }, ctx) as {
    error?: string;
    __images?: Array<{ base64?: string }>;
  };
  if (evidence.error) return { error: evidence.error };
  const images = (evidence.__images ?? []).map((image) => image.base64).filter((value): value is string => !!value);
  if (!images.length) return { error: 'reference frame extraction returned no images' };
  const sceneResult = await execSceneDetectionTool('detect_scenes', {
    assetId, apply: 'report', threshold: 0.3, minSceneSeconds: 0.5, maxScenes: 500,
  }, ctx) as {
    error?: string;
    durationMs?: number | null;
    scenes?: Array<{ sourceTimeMs?: number }>;
  };
  const sceneMetrics = !sceneResult.error && typeof sceneResult.durationMs === 'number'
    ? autoEditReferenceSceneMetrics(
        sceneResult.durationMs,
        (sceneResult.scenes ?? []).flatMap((scene) => typeof scene.sourceTimeMs === 'number' ? [scene.sourceTimeMs] : []),
      )
    : undefined;
  const response = await fetch('/api/auto-edit/vlm/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      images,
      instruction: [
        typeof args.instruction === 'string' ? args.instruction : '',
        sceneMetrics ? `Measured scene cadence: ${JSON.stringify(sceneMetrics)}` : '',
      ].filter(Boolean).join('\n'),
    }),
  });
  const body = await response.json().catch(() => ({})) as {
    error?: string;
    profile?: Parameters<typeof setAutoEditReferenceStyle>[1];
    modelId?: string;
    inferenceBackend?: string;
    runtimeBuild?: number;
  };
  if (!response.ok || !body.profile) return { error: body.error ?? `local VLM HTTP ${response.status}` };
  const profile = { ...body.profile, ...(sceneMetrics ? { sceneMetrics } : {}) };
  await setAutoEditReferenceStyle(batchId, profile);
  return {
    ok: true,
    profile,
    modelId: body.modelId,
    inferenceBackend: body.inferenceBackend,
    runtimeBuild: body.runtimeBuild,
    policy: 'structure-only; no source media copied',
    sceneDetectionError: sceneResult.error,
  };
}

export async function execAutoEditBatchTool(name: string, args: Args, ctx: AgentContext): Promise<unknown> {
  if (name !== 'manage_auto_edit_batch') return { error: `unknown tool ${name}` };
  const action = String(args.action ?? '');
  if (action === 'create') return createBatch(args, ctx);
  if (action === 'list') return {
    ok: true,
    batches: (await listAutoEditBatches()).map(autoEditBatchSummary),
  };
  if (action === 'status') {
    const batch = await getAutoEditBatch(requiredString(args, 'batchId'));
    if (!batch) return { error: 'auto-edit batch not found' };
    const offset = typeof args.offset === 'number' ? args.offset : 0;
    const limit = typeof args.limit === 'number' ? Math.min(200, args.limit) : 50;
    return { ok: true, batch: autoEditBatchSummary(batch), jobs: batch.jobs.slice(offset, offset + limit), offset, limit };
  }
  if (action === 'claim') return materializeClaim(requiredString(args, 'batchId'), requiredString(args, 'workerId'));
  if (action === 'analyze_reference') return analyzeReference(args, ctx);
  if (action === 'pause' || action === 'resume' || action === 'cancel' || action === 'retry_failed') {
    const batch = await controlAutoEditBatch(requiredString(args, 'batchId'), action);
    return { ok: true, batch: autoEditBatchSummary(batch) };
  }
  if (action === 'heartbeat' || action === 'editing' || action === 'rendering'
    || action === 'complete' || action === 'fail') {
    const status = action === 'heartbeat' ? undefined
      : action === 'complete' ? 'succeeded'
        : action === 'fail' ? 'failed'
          : action;
    const batch = await updateAutoEditJob(
      requiredString(args, 'batchId'), requiredString(args, 'jobId'), requiredString(args, 'workerId'),
      {
        ...(status ? { status } : { heartbeat: true }),
        projectId: typeof args.projectId === 'string' ? args.projectId : undefined,
        sourceAssetId: typeof args.sourceAssetId === 'string' ? args.sourceAssetId : undefined,
        outputPath: typeof args.outputPath === 'string' ? args.outputPath : undefined,
        error: typeof args.error === 'string' ? args.error : undefined,
      },
    );
    return { ok: true, batch: autoEditBatchSummary(batch), job: batch.jobs.find((job) => job.id === args.jobId) };
  }
  return { error: `unknown auto-edit batch action: ${action}` };
}
