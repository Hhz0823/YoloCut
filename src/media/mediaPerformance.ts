import { useEffect, useState } from 'react';

export type ClientMediaPerformanceTier = 'economy' | 'balanced' | 'performance';

export interface ClientMediaRuntimeBudgets {
  readonly ffmpegThreadsPerProcess: number;
  readonly mediaProcessConcurrency: number;
  readonly derivativeConcurrency: number;
  readonly normalizeConcurrency: number;
  readonly proxyConcurrency: number;
  readonly proxyPrefetchSources: number;
  readonly proxyLookBehindSeconds: number;
  readonly proxyLookAheadSeconds: number;
  readonly previewDecoderBudget: number;
  readonly decodedVideoMemoryBytes: number;
  readonly lutCacheMaxEntries: number;
  readonly lutCacheMaxBytes: number;
}

export interface ClientMediaPerformanceProfile {
  readonly version: 1 | 2;
  readonly tier: ClientMediaPerformanceTier;
  readonly label: string;
  readonly reason: string;
  readonly nvidiaGpu?: { readonly name: string; readonly memoryMiB: number };
  readonly ffmpeg: {
    readonly encoder: { readonly id: string; readonly label: string; readonly hardware: boolean };
    readonly decoder: { readonly id: string; readonly hardware: boolean; readonly zeroCopy: boolean };
    readonly thirdPartyDecoders?: readonly string[];
  };
  readonly proxy: { readonly maxWidth: number; readonly maxHeight: number; readonly maxFps: number };
  readonly budgets?: ClientMediaRuntimeBudgets;
}

const MIB = 1024 ** 2;
const ECONOMY_CLIENT_BUDGETS: ClientMediaRuntimeBudgets = {
  ffmpegThreadsPerProcess: 1,
  mediaProcessConcurrency: 1,
  derivativeConcurrency: 1,
  normalizeConcurrency: 1,
  proxyConcurrency: 1,
  proxyPrefetchSources: 4,
  proxyLookBehindSeconds: 10,
  proxyLookAheadSeconds: 45,
  previewDecoderBudget: 4,
  decodedVideoMemoryBytes: 256 * MIB,
  lutCacheMaxEntries: 8,
  lutCacheMaxBytes: 16 * MIB,
};

export function mediaRuntimeBudgets(
  profile: ClientMediaPerformanceProfile | null | undefined,
): ClientMediaRuntimeBudgets {
  return profile?.budgets ?? ECONOMY_CLIENT_BUDGETS;
}

export function previewProxyPlanning(
  fps: number,
  profile: ClientMediaPerformanceProfile | null | undefined,
): {
  beforeFrames: number;
  afterFrames: number;
  prefetchSources: number;
  maxSources: number;
  decoderBudget: number;
  proxyConcurrency: number;
} {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const budgets = mediaRuntimeBudgets(profile);
  const bytesPerBufferedDecoder = Math.max(1, profile?.proxy.maxWidth ?? 960)
    * Math.max(1, profile?.proxy.maxHeight ?? 540) * 4 * 3;
  const memoryDecoderBudget = Math.max(1, Math.floor(
    budgets.decodedVideoMemoryBytes / bytesPerBufferedDecoder,
  ));
  const decoderBudget = Math.max(1, Math.min(budgets.previewDecoderBudget, memoryDecoderBudget));
  return {
    beforeFrames: Math.max(1, Math.round(budgets.proxyLookBehindSeconds * safeFps)),
    afterFrames: Math.max(1, Math.round(budgets.proxyLookAheadSeconds * safeFps)),
    prefetchSources: budgets.proxyPrefetchSources,
    maxSources: Math.max(budgets.proxyPrefetchSources, budgets.proxyPrefetchSources * 4),
    decoderBudget,
    proxyConcurrency: budgets.proxyConcurrency,
  };
}

/**
 * Keep decoder overlap small on entry-level machines while retaining a full
 * second of warm-up on systems that can comfortably decode parallel sources.
 */
export function adaptivePreviewPremountFrames(
  fps: number,
  tier: ClientMediaPerformanceTier | null | undefined,
  pressure = 1,
  decoderBudget = Number.POSITIVE_INFINITY,
): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  if (pressure >= decoderBudget * 2) return 0;
  const seconds = tier === 'economy' ? 0.25 : tier === 'performance' ? 1 : 0.5;
  const pressureScale = pressure > decoderBudget ? 0.5 : 1;
  return Math.max(1, Math.round(safeFps * seconds * pressureScale));
}

let cached: ClientMediaPerformanceProfile | null = null;
let loading: Promise<ClientMediaPerformanceProfile | null> | null = null;

function isProfile(value: unknown): value is ClientMediaPerformanceProfile {
  if (typeof value !== 'object' || value === null) return false;
  const profile = value as Partial<ClientMediaPerformanceProfile>;
  const validBase = (profile.version === 1 || profile.version === 2)
    && (profile.tier === 'economy' || profile.tier === 'balanced' || profile.tier === 'performance')
    && typeof profile.label === 'string'
    && typeof profile.reason === 'string'
    && typeof profile.ffmpeg?.encoder?.id === 'string'
    && typeof profile.ffmpeg?.encoder?.hardware === 'boolean'
    && typeof profile.ffmpeg?.decoder?.id === 'string'
    && typeof profile.ffmpeg?.decoder?.hardware === 'boolean'
    && typeof profile.ffmpeg?.decoder?.zeroCopy === 'boolean'
    && Number.isFinite(profile.proxy?.maxWidth)
    && Number.isFinite(profile.proxy?.maxHeight)
    && Number.isFinite(profile.proxy?.maxFps);
  if (!validBase) return false;
  if (profile.version === 1) return true;
  const budgets = profile.budgets;
  return !!budgets
    && Number.isInteger(budgets.ffmpegThreadsPerProcess) && budgets.ffmpegThreadsPerProcess >= 1
    && Number.isInteger(budgets.mediaProcessConcurrency) && budgets.mediaProcessConcurrency >= 1
    && Number.isInteger(budgets.derivativeConcurrency) && budgets.derivativeConcurrency >= 1
    && Number.isInteger(budgets.normalizeConcurrency) && budgets.normalizeConcurrency >= 1
    && Number.isInteger(budgets.proxyConcurrency) && budgets.proxyConcurrency >= 1
    && Number.isInteger(budgets.proxyPrefetchSources) && budgets.proxyPrefetchSources >= 1
    && Number.isFinite(budgets.proxyLookBehindSeconds) && budgets.proxyLookBehindSeconds >= 0
    && Number.isFinite(budgets.proxyLookAheadSeconds) && budgets.proxyLookAheadSeconds > 0
    && Number.isInteger(budgets.previewDecoderBudget) && budgets.previewDecoderBudget >= 1
    && Number.isFinite(budgets.decodedVideoMemoryBytes) && budgets.decodedVideoMemoryBytes > 0
    && Number.isInteger(budgets.lutCacheMaxEntries) && budgets.lutCacheMaxEntries >= 1
    && Number.isFinite(budgets.lutCacheMaxBytes) && budgets.lutCacheMaxBytes > 0;
}

export function loadMediaPerformanceProfile(): Promise<ClientMediaPerformanceProfile | null> {
  if (cached) return Promise.resolve(cached);
  if (loading) return loading;
  loading = fetch('/api/media-performance-profile')
    .then(async (response) => response.ok ? response.json() : null)
    .then((value) => {
      cached = isProfile(value) ? value : null;
      return cached;
    })
    .catch(() => null)
    .finally(() => { loading = null; });
  return loading;
}

export function useMediaPerformanceProfile(): ClientMediaPerformanceProfile | null {
  const [profile, setProfile] = useState<ClientMediaPerformanceProfile | null>(cached);
  useEffect(() => {
    let active = true;
    void loadMediaPerformanceProfile().then((value) => { if (active) setProfile(value); });
    return () => { active = false; };
  }, []);
  return profile;
}
