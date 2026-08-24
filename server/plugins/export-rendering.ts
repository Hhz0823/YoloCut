import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  resolveH264RenderOptions,
  resolveH264TargetBitrate,
  type H264EncoderOutcome,
} from '../media-acceleration.ts';
import { ffmpegBin } from '../media-binaries.ts';
import {
  createExportFailure,
  exportFailureFrom,
  ExportFailureError,
  type ExportCleanupStatus,
  type ExportFailureStage,
} from '../../src/export/exportFailure.ts';
import type { ExportPlan } from './export-plan.ts';
import {
  createRenderProgress,
  exportOutputSize,
  finalH264EncoderOutcome,
  resizeVideo,
  retimeFps,
} from './export-runtime.ts';
import type { UpdateGenerationJob } from './generation-jobs.ts';
import { ensureRenderRuntimeReady } from '../render-runtime-readiness.ts';

type RemotionRenderModule = {
  currentRenderConcurrency(): number;
  remotionFfmpegPath(): string;
  renderTimeline(options: Record<string, unknown>): Promise<unknown>;
  renderTimelineStills(options: Record<string, unknown>): Promise<unknown>;
  renderClip(options: Record<string, unknown>): Promise<unknown>;
  setUploadsDirProvider(provider: () => string): void;
};

let remotionRenderPromise: Promise<RemotionRenderModule> | null = null;
let uploadsDirProvider: (() => string) | null = null;

function remotionRenderModuleUrl(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDirectory, 'remotion-render.mjs'),
    resolve(moduleDirectory, '../../remotion/render.mjs'),
    resolve(moduleDirectory, '../remotion/render.mjs'),
    resolve(process.cwd(), 'remotion/render.mjs'),
  ];
  const renderModule = candidates.find(existsSync);
  if (!renderModule) throw new Error('Remotion render runtime is unavailable');
  return pathToFileURL(renderModule).href;
}

async function loadRemotionRender(): Promise<RemotionRenderModule> {
  if (!remotionRenderPromise) {
    const moduleUrl = remotionRenderModuleUrl();
    remotionRenderPromise = ensureRenderRuntimeReady()
      .then(async () => import(moduleUrl) as Promise<RemotionRenderModule>)
      .then((module) => {
        if (uploadsDirProvider) module.setUploadsDirProvider(uploadsDirProvider);
        return module;
      })
      .catch((error) => {
        remotionRenderPromise = null;
        throw error;
      });
  }
  return remotionRenderPromise;
}

export function setUploadsDirProvider(provider: () => string): void {
  uploadsDirProvider = provider;
  if (remotionRenderPromise) {
    void remotionRenderPromise
      .then((module) => module.setUploadsDirProvider(provider))
      .catch(() => undefined);
  }
}

export async function renderTimeline(options: Record<string, unknown>): Promise<unknown> {
  return (await loadRemotionRender()).renderTimeline(options);
}

export async function renderTimelineStills(options: Record<string, unknown>): Promise<unknown> {
  return (await loadRemotionRender()).renderTimelineStills(options);
}

export async function renderClip(options: Record<string, unknown>): Promise<unknown> {
  return (await loadRemotionRender()).renderClip(options);
}

export async function cleanupExportOutputs(paths: Array<string | null>): Promise<ExportCleanupStatus> {
  let cleanupStatus: ExportCleanupStatus = 'succeeded';
  await Promise.all(paths.filter((path): path is string => path !== null).map(async (path) => {
    try {
      await unlink(path);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) cleanupStatus = 'failed';
    }
  }));
  return cleanupStatus;
}

export async function h264RenderOptions(codec: string) {
  if (codec !== 'h264') return {};
  const remotionRender = await loadRemotionRender();
  return resolveH264RenderOptions(ffmpegBin(), remotionRender.remotionFfmpegPath());
}

export async function renderExportPlan(
  plan: ExportPlan,
  filepath: string,
  update: UpdateGenerationJob,
  signal?: AbortSignal,
): Promise<H264EncoderOutcome | undefined> {
  signal?.throwIfAborted();
  const retimed = plan.retimeFps ? `${filepath}.retimed.${plan.media.ext}` : null;
  const outputSize = exportOutputSize(plan.state, plan.scale);
  const renderSize = exportOutputSize(plan.state, plan.renderScale);
  const needsResize = plan.format === 'video'
    && (renderSize.width !== outputSize.width || renderSize.height !== outputSize.height);
  const resized = needsResize ? `${filepath}.resized.${plan.media.ext}` : null;
  let failureStage: ExportFailureStage = 'render';
  try {
    update({ phase: 'preparing', progress: 4, processedFrames: 0, totalFrames: plan.totalFrames });
    await mkdir(dirname(filepath), { recursive: true });
    signal?.throwIfAborted();
    update({ phase: 'rendering', progress: 8 });
    const rendered = await renderTimeline({
      state: plan.state,
      project: plan.project,
      timelineId: plan.timelineId,
      outputLocation: filepath,
      codec: plan.media.codec,
      frameRange: plan.frameRange,
      scale: plan.renderScale,
      videoBitrate: plan.videoBitrate,
      ...await h264RenderOptions(plan.media.codec),
      onProgress: createRenderProgress(update, plan.totalFrames, plan.retimeFps || needsResize ? 80 : 90),
      signal,
    }) as Partial<H264EncoderOutcome>;
    signal?.throwIfAborted();
    let outcome = rendered.encoder ? { encoder: rendered.encoder, ...(rendered.encoderFallbackReason ? { encoderFallbackReason: rendered.encoderFallbackReason } : {}) } : undefined;
    if (resized) {
      failureStage = 'encode';
      update({ phase: 'finalizing', progress: 90, processedFrames: plan.totalFrames });
      outcome = finalH264EncoderOutcome(outcome, await resizeVideo(
        filepath,
        resized,
        outputSize.width,
        outputSize.height,
        plan.media.codec as 'h264' | 'vp8' | 'prores',
        plan.videoBitrate ?? resolveH264TargetBitrate({ ...outputSize, fps: plan.state.fps }),
        signal,
      ));
      signal?.throwIfAborted();
      await unlink(filepath).catch(() => {});
      await rename(resized, filepath);
      signal?.throwIfAborted();
    }
    if (retimed && plan.retimeFps) {
      failureStage = 'encode';
      update({ phase: 'finalizing', progress: 93, processedFrames: plan.totalFrames });
      outcome = finalH264EncoderOutcome(outcome, await retimeFps(
        filepath,
        retimed,
        plan.retimeFps,
        plan.media.codec as 'h264' | 'vp8',
        plan.videoBitrate ?? resolveH264TargetBitrate({ ...outputSize, fps: plan.retimeFps }),
        signal,
      ));
      signal?.throwIfAborted();
      await unlink(filepath).catch(() => {});
      await rename(retimed, filepath);
      signal?.throwIfAborted();
    }
    update({ phase: 'finalizing', progress: 99, processedFrames: plan.totalFrames });
    return outcome;
  } catch (error) {
    const cleanupStatus = await cleanupExportOutputs([filepath, resized, retimed]);
    const existing = exportFailureFrom(error);
    if (existing) {
      throw new ExportFailureError({ ...existing, cleanupStatus, targetPath: filepath });
    }
    const aborted = signal?.aborted === true;
    const timedOut = error instanceof Error && /(?:timed?\s*out|timeout)/i.test(error.message);
    const message = error instanceof Error ? error.message : String(error);
    const oom = /(?:out of memory|heap|insufficient memory|memory)/i.test(message);
    throw new ExportFailureError(createExportFailure({
      stage: aborted ? 'cancel' : timedOut ? 'timeout' : failureStage,
      code: aborted ? 'export_cancelled' : timedOut ? 'export_timeout'
        : failureStage === 'encode' ? 'export_encode_failed' : 'export_render_failed',
      retryable: !aborted && !oom,
      cleanupStatus,
      targetPath: filepath,
      message: oom
        ? '导出时内存不足。请关闭其他程序、缩短导出范围或降低分辨率后重试；若仍失败，重启应用后再试。'
        : message,
    }));
  }
}

export async function exportCapabilities() {
  const remotionRender = await loadRemotionRender();
  const { h264Profile } = await resolveH264RenderOptions(
    ffmpegBin(),
    remotionRender.remotionFfmpegPath(),
  );
  return { h264: h264Profile, renderConcurrency: remotionRender.currentRenderConcurrency() };
}
