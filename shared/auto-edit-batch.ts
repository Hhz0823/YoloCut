import type { DesktopHardwareCapabilities } from './desktop-inference.ts';

export const AUTO_EDIT_BATCH_FORMAT = 'yolocut-auto-edit-batch@1' as const;
export const MAX_AUTO_EDIT_BATCH_JOBS = 10_000;
export const AUTO_EDIT_JOB_LEASE_MS = 15 * 60_000;

export type AutoEditAttachmentRole =
  | 'source-media'
  | 'edit-script'
  | 'narration-script'
  | 'reference-video';

export type AutoEditJobStatus =
  | 'queued'
  | 'preparing'
  | 'editing'
  | 'rendering'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type AutoEditBatchStatus = 'draft' | 'running' | 'paused' | 'completed' | 'cancelled';

export interface AutoEditSourceDescriptor {
  readonly id: string;
  readonly name: string;
  readonly kind: 'video' | 'image' | 'audio';
  readonly sizeBytes: number;
  /** Display-only relative name. The absolute source path never crosses IPC. */
  readonly relativeName: string;
}

export interface AutoEditReferenceStyle {
  readonly summary: string;
  readonly shotRhythm: string;
  readonly visualStyle: string;
  readonly captionStyle: string;
  readonly transitionStyle: string;
  readonly colorStyle: string;
  readonly audioStyle: string;
  readonly sceneMetrics?: {
    readonly durationMs: number;
    readonly detectedCuts: number;
    readonly medianShotMs: number;
    readonly p25ShotMs: number;
    readonly p75ShotMs: number;
    readonly cutsPerMinute: number;
  };
  /** Always true: the profile can copy structure, never copyrighted media bytes. */
  readonly structureOnly: true;
}

export function autoEditReferenceSceneMetrics(
  durationMs: number,
  sourceTimesMs: readonly number[],
): NonNullable<AutoEditReferenceStyle['sceneMetrics']> {
  const duration = Math.max(1, Math.round(durationMs));
  const cuts = [...new Set(sourceTimesMs
    .map((value) => Math.round(value))
    .filter((value) => value > 0 && value < duration))].sort((left, right) => left - right);
  const boundaries = [0, ...cuts, duration];
  const shots = boundaries.slice(1).map((end, index) => end - boundaries[index]!).sort((left, right) => left - right);
  const percentile = (ratio: number): number => shots[Math.min(shots.length - 1, Math.floor((shots.length - 1) * ratio))] ?? duration;
  return {
    durationMs: duration,
    detectedCuts: cuts.length,
    medianShotMs: percentile(0.5),
    p25ShotMs: percentile(0.25),
    p75ShotMs: percentile(0.75),
    cutsPerMinute: Math.round((cuts.length / duration) * 60_000 * 10) / 10,
  };
}

export interface AutoEditJob {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceKind: AutoEditSourceDescriptor['kind'];
  readonly status: AutoEditJobStatus;
  readonly attempts: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: number;
  readonly projectId?: string;
  readonly sourceAssetId?: string;
  readonly outputPath?: string;
  readonly error?: string;
}

export interface AutoEditBatch {
  readonly format: typeof AUTO_EDIT_BATCH_FORMAT;
  readonly id: string;
  readonly ownerProjectId: string;
  readonly name: string;
  readonly sourceGrantId: string;
  readonly status: AutoEditBatchStatus;
  readonly editScript: string;
  readonly narrationScript: string;
  readonly referenceAssetIds: readonly string[];
  readonly referenceStyle?: AutoEditReferenceStyle;
  readonly plannerModelId: string;
  readonly workerConcurrency: number;
  readonly renderConcurrency: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly jobs: readonly AutoEditJob[];
}

export interface AutoEditHardwarePlan {
  readonly tier: 'low' | 'rtx2060' | 'rtx4060' | 'rtx5060plus';
  readonly workerConcurrency: number;
  readonly renderConcurrency: number;
  readonly proxyResolution: '540p' | '720p' | '1080p';
  readonly decoder: 'hardware-preferred';
  readonly encoder: 'nvenc-preferred' | 'hardware-preferred';
  readonly note: string;
}

export const OPEN_SOURCE_AUTO_EDIT_MODEL = {
  packId: 'smolvlm2-500m-q8-local',
  modelId: 'ggml-org/SmolVLM2-500M-Video-Instruct-GGUF',
  revision: 'ccd7aae53bcb1997355c2f094959e72b3642ce17',
  runtime: 'llama.cpp',
  license: 'Apache-2.0',
  languageNote: 'Reference analysis prompts are sent in English; the returned profile is usable by Chinese editing prompts.',
} as const;

const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const MAX_SCRIPT_CHARS = 200_000;

function compactText(value: unknown, max = MAX_SCRIPT_CHARS): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function gpuDescription(hardware: DesktopHardwareCapabilities | null | undefined): string {
  return (hardware?.gpus ?? []).map((gpu) => gpu.description ?? '').join(' ').toLowerCase();
}

/** Conservative defaults protect decode, inference and NVENC from competing for VRAM. */
export function autoEditHardwarePlan(
  hardware: DesktopHardwareCapabilities | null | undefined,
): AutoEditHardwarePlan {
  const description = gpuDescription(hardware);
  const nvidia = hardware?.gpus.some((gpu) => gpu.vendor === 'nvidia') === true;
  if (nvidia && /(?:rtx\s*)?(?:50[6-9]0|5[1-9]\d{2})/.test(description)) {
    return {
      tier: 'rtx5060plus', workerConcurrency: 3, renderConcurrency: 1,
      proxyResolution: '1080p', decoder: 'hardware-preferred', encoder: 'nvenc-preferred',
      note: 'RTX 5060+：最多 3 路分析，渲染保持单路以保护 NVENC 与显存峰值。',
    };
  }
  if (nvidia && /(?:rtx\s*)?40[6-9]0/.test(description)) {
    return {
      tier: 'rtx4060', workerConcurrency: 2, renderConcurrency: 1,
      proxyResolution: '720p', decoder: 'hardware-preferred', encoder: 'nvenc-preferred',
      note: 'RTX 4060：2 路分析、1 路渲染，长 4K 素材优先代理剪辑。',
    };
  }
  if (nvidia && /(?:rtx\s*)?20[6-9]0/.test(description)) {
    return {
      tier: 'rtx2060', workerConcurrency: 1, renderConcurrency: 1,
      proxyResolution: '540p', decoder: 'hardware-preferred', encoder: 'nvenc-preferred',
      note: 'RTX 2060 最低档：单路分析/渲染，4K 长视频使用 540p 代理并保留原片最终导出。',
    };
  }
  return {
    tier: 'low', workerConcurrency: 1, renderConcurrency: 1,
    proxyResolution: '540p', decoder: 'hardware-preferred',
    encoder: nvidia ? 'nvenc-preferred' : 'hardware-preferred',
    note: '未识别到目标 NVIDIA 型号：使用单路安全配置，不宣称 CUDA/NVENC 已实际启用。',
  };
}

export function autoEditJobCounts(batch: AutoEditBatch): Record<AutoEditJobStatus, number> {
  const counts: Record<AutoEditJobStatus, number> = {
    queued: 0, preparing: 0, editing: 0, rendering: 0,
    succeeded: 0, failed: 0, cancelled: 0,
  };
  for (const job of batch.jobs) counts[job.status] += 1;
  return counts;
}

export function normalizeAutoEditSources(value: unknown): AutoEditSourceDescriptor[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_AUTO_EDIT_BATCH_JOBS) return [];
  const seen = new Set<string>();
  const sources: AutoEditSourceDescriptor[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const source = raw as Partial<AutoEditSourceDescriptor>;
    if (!SAFE_ID.test(source.id ?? '') || seen.has(source.id ?? '')
      || typeof source.name !== 'string' || !source.name.trim() || source.name.length > 512
      || typeof source.relativeName !== 'string' || !source.relativeName.trim() || source.relativeName.length > 1_024
      || (source.kind !== 'video' && source.kind !== 'image' && source.kind !== 'audio')
      || !Number.isSafeInteger(source.sizeBytes) || (source.sizeBytes ?? -1) < 0) return [];
    seen.add(source.id!);
    sources.push({
      id: source.id!, name: source.name.trim(), kind: source.kind,
      sizeBytes: source.sizeBytes!, relativeName: source.relativeName.trim(),
    });
  }
  return sources;
}

export function buildAutoEditBatchPrompt(batch: AutoEditBatch): string {
  const counts = autoEditJobCounts(batch);
  return [
    `请执行批量自动剪辑任务 ${batch.id}（${batch.name}）。`,
    `任务共 ${batch.jobs.length} 条，当前排队 ${counts.queued} 条；调用 manage_auto_edit_batch 获取/领取任务。`,
    '每次只领取队列允许的并发数；为每条任务建立独立工程，先生成可审阅剪辑方案，再剪辑、质检、导出并回写任务结果。',
    batch.editScript ? `[剪辑脚本]\n${batch.editScript}` : '[剪辑脚本] 未提供，按素材内容生成结构。',
    batch.narrationScript ? `[口播脚本]\n${batch.narrationScript}` : '[口播脚本] 未提供，不要擅自生成或替换口播。',
    batch.referenceAssetIds.length
      ? `[成片参考] ${batch.referenceAssetIds.join(', ')}。只提取节奏、镜头结构、字幕、转场和调色规律；禁止复制参考片素材、人物、商标或受版权保护的独特表达。`
      : '[成片参考] 未提供。',
    batch.referenceAssetIds.length && !batch.referenceStyle
      ? `领取首个任务前，先调用 manage_auto_edit_batch action=analyze_reference、batchId=${batch.id}；本地模型不可用时必须明确报告，不得伪造分析结果。`
      : '',
    batch.referenceStyle
      ? `[参考结构档案]\n${JSON.stringify(batch.referenceStyle, null, 2)}`
      : '',
    `本地参考分析模型：${batch.plannerModelId}；必须报告实际运行后端，不能从用户偏好推断 CUDA。`,
  ].filter(Boolean).join('\n\n');
}

export function sanitizeAutoEditBatchScripts(input: {
  editScript?: unknown;
  narrationScript?: unknown;
}): { editScript: string; narrationScript: string } {
  return {
    editScript: compactText(input.editScript),
    narrationScript: compactText(input.narrationScript),
  };
}
