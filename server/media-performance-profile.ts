import { availableParallelism, totalmem } from 'node:os';

import type { LocalNvidiaGpuProfile } from '../shared/local-voice-hardware.ts';
import { ffmpegBin } from './media-binaries.ts';
import {
  ffmpegFilterAvailable,
  resolveH264EncoderProfile,
  resolveHwDecodeArgs,
  type H264EncoderProfile,
} from './media-acceleration.ts';
import { probeLocalVoiceHardware } from './plugins/local-voice-hardware.ts';

const GIB = 1024 ** 3;
const PROFILE_CACHE_MS = 5 * 60_000;

export type MediaPerformanceTier = 'economy' | 'balanced' | 'performance';

export interface MediaProxyPolicy {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxFps: number;
  readonly videoBitrate: number;
  readonly audioBitrate: number;
  readonly softwarePreset: 'ultrafast' | 'superfast' | 'veryfast';
  readonly cacheMaxBytes: number;
}

export interface MediaPerformanceProfile {
  readonly version: 1;
  readonly tier: MediaPerformanceTier;
  readonly label: string;
  readonly reason: string;
  readonly system: {
    readonly logicalCores: number;
    readonly totalMemoryBytes: number;
  };
  readonly nvidiaGpu?: LocalNvidiaGpuProfile;
  readonly ffmpeg: {
    readonly encoder: H264EncoderProfile;
    readonly decoder: {
      readonly id: 'cuda' | 'd3d11va' | 'qsv' | 'vaapi' | 'videotoolbox' | 'software';
      readonly hardware: boolean;
      readonly zeroCopy: boolean;
    };
  };
  readonly proxy: MediaProxyPolicy;
  /** Safe cache discriminator; never contains a path or device-provided text. */
  readonly cacheKey: string;
}

export interface MediaPerformancePolicyInput {
  readonly logicalCores: number;
  readonly totalMemoryBytes: number;
  readonly encoder: H264EncoderProfile;
  readonly nvidiaGpu?: LocalNvidiaGpuProfile;
  readonly decodeArgs?: readonly string[];
  readonly scaleCuda: boolean;
}

function tierProxy(tier: MediaPerformanceTier): MediaProxyPolicy {
  if (tier === 'economy') {
    return {
      maxWidth: 960,
      maxHeight: 540,
      maxFps: 30,
      videoBitrate: 2_000_000,
      audioBitrate: 96_000,
      softwarePreset: 'ultrafast',
      cacheMaxBytes: 8 * GIB,
    };
  }
  if (tier === 'balanced') {
    return {
      maxWidth: 1_280,
      maxHeight: 720,
      maxFps: 30,
      videoBitrate: 4_000_000,
      audioBitrate: 128_000,
      softwarePreset: 'superfast',
      cacheMaxBytes: 16 * GIB,
    };
  }
  return {
    maxWidth: 1_920,
    maxHeight: 1_080,
    maxFps: 30,
    videoBitrate: 8_000_000,
    audioBitrate: 160_000,
    softwarePreset: 'veryfast',
    cacheMaxBytes: 32 * GIB,
  };
}

function decoderId(args: readonly string[]): MediaPerformanceProfile['ffmpeg']['decoder']['id'] {
  const value = args[args.indexOf('-hwaccel') + 1];
  return value === 'cuda' || value === 'd3d11va' || value === 'qsv'
    || value === 'vaapi' || value === 'videotoolbox' ? value : 'software';
}

/** Pure policy: hardware names never decide the tier by themselves. Actual
 * RAM, logical cores and a working FFmpeg encoder probe are authoritative. */
export function resolveMediaPerformancePolicy(
  input: MediaPerformancePolicyInput,
): MediaPerformanceProfile {
  const logicalCores = Math.max(1, Math.floor(input.logicalCores) || 1);
  const totalMemoryBytes = Math.max(0, Math.floor(input.totalMemoryBytes) || 0);
  const constrained = logicalCores <= 4 || totalMemoryBytes < 12 * GIB;
  const strongHost = logicalCores >= 8 && totalMemoryBytes >= 24 * GIB;
  const tier: MediaPerformanceTier = constrained || !input.encoder.hardware
    ? 'economy'
    : strongHost ? 'performance' : 'balanced';
  const proxy = tierProxy(tier);
  const decodeArgs = [...(input.decodeArgs ?? [])];
  const decoder = decoderId(decodeArgs);
  const zeroCopy = input.encoder.id === 'h264_nvenc'
    && decoder === 'cuda'
    && input.scaleCuda;
  const label = tier === 'economy' ? '低配流畅档' : tier === 'balanced' ? '均衡流畅档' : '高性能流畅档';
  const reason = constrained
    ? `检测到 ${logicalCores} 线程 / ${(totalMemoryBytes / GIB).toFixed(1)} GB 内存，使用低负载代理。`
    : !input.encoder.hardware
      ? '未检测到可工作的硬件 H.264 编码器，使用低负载软件代理。'
      : strongHost
        ? 'CPU、内存和硬件编解码满足高性能代理档。'
        : '检测到硬件编码器，按中等内存/CPU预算生成均衡代理。';
  return {
    version: 1,
    tier,
    label,
    reason,
    system: { logicalCores, totalMemoryBytes },
    ...(input.nvidiaGpu ? { nvidiaGpu: input.nvidiaGpu } : {}),
    ffmpeg: {
      encoder: input.encoder,
      decoder: { id: decoder, hardware: decoder !== 'software', zeroCopy },
    },
    proxy,
    cacheKey: `v1-${tier}-${proxy.maxHeight}p${proxy.maxFps}-${input.encoder.id}-${zeroCopy ? 'zc' : 'copy'}`,
  };
}

/** Preserve two GiB of free disk and use at most one quarter of the remainder. */
export function resolvePreviewCacheBudgetBytes(
  profile: MediaPerformanceProfile,
  availableBytes: number,
): number {
  if (!Number.isFinite(availableBytes) || availableBytes < 0) return profile.proxy.cacheMaxBytes;
  const usable = Math.max(0, Math.floor(availableBytes) - 2 * GIB);
  return Math.max(0, Math.min(profile.proxy.cacheMaxBytes, Math.floor(usable * 0.25)));
}

export function estimatePreviewProxyBytes(
  durationMs: number,
  policy: MediaProxyPolicy,
): number {
  const seconds = Math.max(0, Number(durationMs) / 1_000);
  return Math.ceil(seconds * (policy.videoBitrate + policy.audioBitrate) / 8 * 1.08);
}

let cached: { expiresAt: number; value: Promise<MediaPerformanceProfile> } | null = null;

export async function resolveMediaPerformanceProfile(): Promise<MediaPerformanceProfile> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = (async () => {
    const ffmpeg = ffmpegBin();
    const encoder = await resolveH264EncoderProfile(ffmpeg);
    const [voiceHardware, decodeArgs, scaleCuda] = await Promise.all([
      probeLocalVoiceHardware(),
      resolveHwDecodeArgs(ffmpeg, encoder.id),
      encoder.id === 'h264_nvenc' ? ffmpegFilterAvailable(ffmpeg, 'scale_cuda') : Promise.resolve(false),
    ]);
    return resolveMediaPerformancePolicy({
      logicalCores: availableParallelism(),
      totalMemoryBytes: totalmem(),
      encoder,
      // FFmpeg defaults to NVIDIA device 0 unless the operator overrides its
      // device visibility. Report the first nvidia-smi row rather than a
      // voice-model ranking that could describe a different adapter.
      ...(voiceHardware.gpus[0] ? { nvidiaGpu: voiceHardware.gpus[0] } : {}),
      decodeArgs,
      scaleCuda,
    });
  })();
  cached = { expiresAt: Date.now() + PROFILE_CACHE_MS, value };
  return value;
}

export function __resetMediaPerformanceProfileForVerify(): void {
  cached = null;
}
