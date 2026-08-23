import { useEffect, useState } from 'react';

export type ClientMediaPerformanceTier = 'economy' | 'balanced' | 'performance';

export interface ClientMediaPerformanceProfile {
  readonly version: 1;
  readonly tier: ClientMediaPerformanceTier;
  readonly label: string;
  readonly reason: string;
  readonly nvidiaGpu?: { readonly name: string; readonly memoryMiB: number };
  readonly ffmpeg: {
    readonly encoder: { readonly id: string; readonly label: string; readonly hardware: boolean };
    readonly decoder: { readonly id: string; readonly hardware: boolean; readonly zeroCopy: boolean };
  };
  readonly proxy: { readonly maxWidth: number; readonly maxHeight: number; readonly maxFps: number };
}

/**
 * Keep decoder overlap small on entry-level machines while retaining a full
 * second of warm-up on systems that can comfortably decode parallel sources.
 */
export function adaptivePreviewPremountFrames(
  fps: number,
  tier: ClientMediaPerformanceTier | null | undefined,
): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const seconds = tier === 'economy' ? 0.25 : tier === 'performance' ? 1 : 0.5;
  return Math.max(1, Math.round(safeFps * seconds));
}

let cached: ClientMediaPerformanceProfile | null = null;
let loading: Promise<ClientMediaPerformanceProfile | null> | null = null;

function isProfile(value: unknown): value is ClientMediaPerformanceProfile {
  if (typeof value !== 'object' || value === null) return false;
  const profile = value as Partial<ClientMediaPerformanceProfile>;
  return profile.version === 1
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
