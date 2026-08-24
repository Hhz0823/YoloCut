import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  getPreviewSourceMode,
  getQualityMode,
  shouldAutoRequestPreviewProxy,
  shouldPreferMasterPreview,
  subscribeQualityMode,
} from './qualityPolicy';
import type { ProjectDoc, Timeline, TimelineState } from '../editor/types';
import { resolveTimelineRenderPlan } from '../editor/sequenceGraph';
import { isPreviewable } from './clipPreview';
import { PreviewProxyScheduler } from './previewProxyScheduler';

export interface PreviewProxySource {
  src: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  container?: string;
  extension?: string;
  profile?: string;
  pixelFormat?: string;
  bitDepth?: number;
  hasAlpha?: boolean;
  bitrate?: number;
  longGop: boolean;
}

export type PreviewProxyReadiness =
  | { status: 'not-needed'; reason: string }
  | { status: 'ready'; reason: string; previewSrc: string; acceleration?: {
      encoder: { id: string; label: string; hardware: boolean };
      decoder: string;
      zeroCopy: boolean;
      width: number;
      height: number;
      fps: number;
    } }
  | { status: 'failed'; reason: string; error: string };

export interface PreviewProxyResponse {
  source: PreviewProxySource;
  performance?: { tier: string; label: string };
  proxy: PreviewProxyReadiness;
}

export type PreviewProxyState = PreviewProxyReadiness
  | { status: 'loading'; reason: string }
  | { status: 'unavailable'; reason: string };

interface ProxyEntry {
  response: PreviewProxyResponse | null;
  responseAt: number;
  responsePressure: number;
  requestedPressure: number;
  promise: Promise<void> | null;
  controller: AbortController | null;
  listeners: Set<() => void>;
  autoQueued: boolean;
  lastAccess: number;
}

export interface PreviewProxyPlanningOptions {
  readonly focusFrame?: number;
  readonly beforeFrames?: number;
  readonly afterFrames?: number;
  readonly maxSources?: number;
  readonly prefetchSources?: number;
  readonly proxyConcurrency?: number;
  readonly pressure?: number;
}

export const PREVIEW_PROXY_RETRY_MS = 5 * 60 * 1_000;
export const PREVIEW_PROXY_CACHE_LIMIT = 256;

const proxyEntries = new Map<string, ProxyEntry>();
const proxyScheduler = new PreviewProxyScheduler(1);
let accessSequence = 0;

function touch(entry: ProxyEntry): void {
  entry.lastAccess = ++accessSequence;
}

function proxyEntry(src: string): ProxyEntry {
  let entry = proxyEntries.get(src);
  if (!entry) {
    entry = {
      response: null,
      responseAt: 0,
      responsePressure: 0,
      requestedPressure: 1,
      promise: null,
      controller: null,
      listeners: new Set(),
      autoQueued: false,
      lastAccess: 0,
    };
    proxyEntries.set(src, entry);
  }
  touch(entry);
  return entry;
}

function normalizedPressure(value: unknown): number {
  const requested = Math.max(1, Math.min(128, Math.ceil(Number(value) || 1)));
  return [1, 2, 4, 8, 16, 32, 64, 128].find((level) => level >= requested) ?? 128;
}

function proxyResponseSatisfies(
  entry: ProxyEntry,
  force: boolean,
  pressure: number,
  now = Date.now(),
): boolean {
  if (!entry.response || entry.responsePressure < pressure) return false;
  if (force && entry.response.proxy.status !== 'ready') return false;
  if (entry.response.proxy.status !== 'failed') return true;
  if (entry.response.proxy.reason === 'proxy-playback-failed') return true;
  return now - entry.responseAt < PREVIEW_PROXY_RETRY_MS;
}

function pruneProxyEntries(): void {
  if (proxyEntries.size <= PREVIEW_PROXY_CACHE_LIMIT) return;
  const evictable = [...proxyEntries.entries()]
    .filter(([, entry]) => !entry.listeners.size && !entry.promise && !entry.autoQueued)
    .sort((left, right) => left[1].lastAccess - right[1].lastAccess);
  for (const [src, entry] of evictable) {
    if (proxyEntries.size <= PREVIEW_PROXY_CACHE_LIMIT) break;
    if (proxyEntries.get(src) === entry) proxyEntries.delete(src);
  }
}

function notify(entry: ProxyEntry): void {
  for (const listener of entry.listeners) listener();
}

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : `preview proxy request failed (${response.status})`;
}

function failedResponse(src: string, error: unknown): PreviewProxyResponse {
  return {
    source: { src, durationMs: 0, width: 0, height: 0, fps: 0, codec: '', longGop: false },
    proxy: {
      status: 'failed',
      reason: 'proxy-request-failed',
      error: error instanceof Error ? error.message : String(error),
    },
  };
}

async function loadProxy(src: string, force: boolean, entry: ProxyEntry, rawPressure = 1): Promise<void> {
  touch(entry);
  entry.requestedPressure = Math.max(entry.requestedPressure, normalizedPressure(rawPressure));
  const pressure = entry.requestedPressure;
  if (entry.promise) {
    await entry.promise;
    return loadProxy(src, force, entry, pressure);
  }
  if (proxyResponseSatisfies(entry, force, pressure)) return;
  const previousResponse = entry.response;
  const previousPressure = entry.responsePressure;
  const keepReadyWhileUpgrading = previousResponse?.proxy.status === 'ready'
    && previousPressure > 0 && previousPressure < pressure;
  if (!keepReadyWhileUpgrading) {
    entry.response = null;
    notify(entry);
  }
  const query = `src=${encodeURIComponent(src)}&pressure=${pressure}${force ? '&force=1' : ''}`;
  const controller = new AbortController();
  entry.controller = controller;
  entry.promise = fetch(`/api/preview-proxy?${query}`, { signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) throw new Error(await responseError(response));
      entry.response = await response.json() as PreviewProxyResponse;
      entry.responseAt = Date.now();
      entry.responsePressure = pressure;
    })
    .catch((error) => {
      if (!controller.signal.aborted) {
        if (keepReadyWhileUpgrading) {
          entry.response = previousResponse;
          entry.responsePressure = previousPressure;
        } else {
          entry.response = failedResponse(src, error);
          entry.responseAt = Date.now();
          entry.responsePressure = pressure;
        }
      }
    })
    .finally(() => {
      if (entry.controller === controller) entry.controller = null;
      entry.promise = null;
      touch(entry);
      notify(entry);
      pruneProxyEntries();
    });
  await entry.promise;
}

export function requestPreviewProxy(src: string, force = false, pressure = 1): Promise<void> {
  if (!isPreviewable(src)) return Promise.resolve();
  const entry = proxyEntry(src);
  if (proxyScheduler.cancel(src)) entry.autoQueued = false;
  return loadProxy(src, force, entry, pressure);
}

function queuePreviewProxy(src: string, priority: number, force: boolean, pressure: number): void {
  if (!isPreviewable(src)) return;
  const entry = proxyEntry(src);
  entry.requestedPressure = Math.max(entry.requestedPressure, normalizedPressure(pressure));
  proxyScheduler.enqueue(src, priority, async () => {
    entry.autoQueued = false;
    await loadProxy(src, force, entry, pressure);
  });
  entry.autoQueued = proxyScheduler.isQueued(src);
}

export function reportPreviewPlaybackFailure(src: string, error = 'preview media failed to play'): void {
  if (!isPreviewable(src)) return;
  const entry = proxyEntry(src);
  if (entry.response?.proxy.status !== 'ready') {
    if (entry.response?.proxy.status !== 'failed') void requestPreviewProxy(src, true);
    return;
  }
  entry.response = {
    ...entry.response,
    proxy: { status: 'failed', reason: 'proxy-playback-failed', error },
  };
  entry.responseAt = Date.now();
  touch(entry);
  notify(entry);
}

export function mediaPosterUrl(src: string | undefined): string | undefined {
  return isPreviewable(src) ? `/api/media-poster?src=${encodeURIComponent(src)}` : undefined;
}

function stateFor(src: string | undefined, autoRequest: boolean): PreviewProxyState {
  if (!isPreviewable(src)) return { status: 'unavailable', reason: 'non-local-source' };
  const entry = proxyEntry(src);
  if (!entry.response) {
    return autoRequest
      ? { status: 'loading', reason: 'checking-source' }
      : { status: 'not-needed', reason: 'preview-source-original' };
  }
  return entry.response.proxy;
}

function subscribe(sources: readonly string[], listener: () => void): () => void {
  for (const src of sources) {
    const entry = proxyEntry(src);
    entry.listeners.add(listener);
  }
  return () => {
    for (const src of sources) {
      const entry = proxyEntries.get(src);
      if (!entry) continue;
      entry.listeners.delete(listener);
      touch(entry);
      if (entry.listeners.size) continue;
      // React runs effect cleanup before subscribing the replacement source
      // set. Deferring one microtask preserves common in-flight proxies across
      // ordinary clip moves/additions while still releasing genuinely unused
      // work immediately after the effect cycle.
      void Promise.resolve().then(() => {
        if (entry.listeners.size || proxyEntries.get(src) !== entry) return;
        if (entry.autoQueued && proxyScheduler.cancel(src)) entry.autoQueued = false;
        if (entry.promise) {
          entry.controller?.abort();
          if (proxyEntries.get(src) === entry) proxyEntries.delete(src);
        }
        pruneProxyEntries();
      });
    }
  };
}

function useQualitySnapshot() {
  // Separate stable snapshots: getSnapshot must return a cached value, or
  // useSyncExternalStore re-renders forever on every new object literal.
  const mode = useSyncExternalStore(subscribeQualityMode, getQualityMode, getQualityMode);
  const preview = useSyncExternalStore(subscribeQualityMode, getPreviewSourceMode, getPreviewSourceMode);
  return { mode, preview };
}

function useProxySources(
  sources: readonly string[],
  options: Pick<PreviewProxyPlanningOptions, 'prefetchSources' | 'proxyConcurrency' | 'pressure'> = {},
): number {
  const [revision, setRevision] = useState(0);
  const quality = useQualitySnapshot();
  const pressure = normalizedPressure(options.pressure);
  const prefetchSources = Math.max(1, Math.min(64, Math.floor(options.prefetchSources ?? 4)));
  const proxyConcurrency = options.proxyConcurrency === undefined
    ? null
    : Math.max(1, Math.min(4, Math.floor(options.proxyConcurrency) || 1));
  // Timeline edits create new arrays. Keep ordering stable for priority updates
  // and membership stable for subscriptions, so moving clips can reprioritize
  // queued work without tearing down an in-flight multi-hour 4K proxy.
  const stablePriorityRef = useRef<readonly string[]>(sources);
  if (stablePriorityRef.current.length !== sources.length
    || stablePriorityRef.current.some((source, index) => source !== sources[index])) {
    stablePriorityRef.current = [...sources];
  }
  const prioritySources = stablePriorityRef.current;
  const sortedSources = [...sources].sort();
  const stableMembershipRef = useRef<readonly string[]>(sortedSources);
  if (stableMembershipRef.current.length !== sortedSources.length
    || stableMembershipRef.current.some((source, index) => source !== sortedSources[index])) {
    stableMembershipRef.current = sortedSources;
  }
  const subscribedSources = stableMembershipRef.current;
  useEffect(() => {
    if (proxyConcurrency !== null) proxyScheduler.setConcurrency(proxyConcurrency);
  }, [proxyConcurrency]);
  useEffect(() => {
    const bump = () => setRevision((value) => value + 1);
    return subscribe(subscribedSources, bump);
  }, [subscribedSources]);
  useEffect(() => {
    if (shouldAutoRequestPreviewProxy(quality.mode, quality.preview)) {
      const force = quality.preview === 'proxy';
      let occupied = 0;
      for (const src of prioritySources) {
        const entry = proxyEntry(src);
        entry.requestedPressure = Math.max(entry.requestedPressure, pressure);
        if (entry.promise || entry.autoQueued) occupied += 1;
      }
      let remaining = Math.max(0, prefetchSources - occupied);
      for (let priority = 0; priority < prioritySources.length && remaining > 0; priority += 1) {
        const src = prioritySources[priority]!;
        const entry = proxyEntry(src);
        if (entry.promise || entry.autoQueued || proxyResponseSatisfies(entry, force, pressure)) continue;
        queuePreviewProxy(src, priority, force, pressure);
        remaining -= 1;
      }
    } else {
      for (const src of subscribedSources) {
        const entry = proxyEntries.get(src);
        if (entry?.autoQueued && proxyScheduler.cancel(src)) entry.autoQueued = false;
      }
    }
  }, [prefetchSources, pressure, prioritySources, quality.mode, quality.preview, revision, subscribedSources]);
  useEffect(() => {
    if (!shouldAutoRequestPreviewProxy(quality.mode, quality.preview)) return undefined;
    const now = Date.now();
    let nextRetryAt = Number.POSITIVE_INFINITY;
    for (const src of subscribedSources) {
      const entry = proxyEntries.get(src);
      if (entry?.response?.proxy.status !== 'failed'
        || entry.response.proxy.reason === 'proxy-playback-failed') continue;
      nextRetryAt = Math.min(nextRetryAt, entry.responseAt + PREVIEW_PROXY_RETRY_MS);
    }
    if (!Number.isFinite(nextRetryAt)) return undefined;
    const retry = () => {
      const retryNow = Date.now();
      prioritySources.forEach((src, priority) => {
        const entry = proxyEntries.get(src);
        if (entry?.response?.proxy.status === 'failed'
          && entry.response.proxy.reason !== 'proxy-playback-failed'
          && entry.responseAt + PREVIEW_PROXY_RETRY_MS <= retryNow) {
          queuePreviewProxy(src, priority, quality.preview === 'proxy', pressure);
        }
      });
      // Recalculate the next failure's deadline. The queued request clears its
      // own failed response in a microtask before this effect runs again.
      setRevision((value) => value + 1);
    };
    const timer = window.setTimeout(retry, Math.max(0, nextRetryAt - now));
    return () => window.clearTimeout(timer);
  }, [pressure, prioritySources, subscribedSources, quality.mode, quality.preview, revision]);
  // Re-resolve preview src when quality/preview-source mode flips even if proxy cache is quiet.
  useEffect(() => {
    setRevision((value) => value + 1);
  }, [quality.mode, quality.preview]);
  return revision;
}

function orderedVideoSources(
  items: TimelineState['items'],
  options: Pick<PreviewProxyPlanningOptions, 'focusFrame' | 'beforeFrames' | 'afterFrames'> = {},
): string[] {
  const seen = new Set<string>();
  const focus = Number.isFinite(options.focusFrame) ? Math.max(0, Number(options.focusFrame)) : null;
  const from = focus === null ? Number.NEGATIVE_INFINITY : focus - Math.max(0, Number(options.beforeFrames) || 0);
  const to = focus === null ? Number.POSITIVE_INFINITY : focus + Math.max(1, Number(options.afterFrames) || 1);
  const distance = (item: TimelineState['items'][number]): number => {
    if (focus === null) return item.startFrame;
    const end = item.startFrame + item.durationInFrames;
    if (focus >= item.startFrame && focus < end) return 0;
    return item.startFrame > focus ? item.startFrame - focus : focus - end + 0.5;
  };
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === 'video' && isPreviewable(item.src)
      && item.startFrame < to && item.startFrame + item.durationInFrames > from)
    .sort((left, right) => distance(left.item) - distance(right.item)
      || left.item.startFrame - right.item.startFrame || left.index - right.index)
    .flatMap(({ item }) => {
      const src = item.src!;
      if (seen.has(src)) return [];
      seen.add(src);
      return [src];
    });
}

export function orderedPreviewSourcesForTimeline(
  state: TimelineState,
  options: Pick<PreviewProxyPlanningOptions, 'focusFrame' | 'beforeFrames' | 'afterFrames'> = {},
): string[] {
  return orderedVideoSources(state.items, options);
}

export function previewDecodePressure(
  state: TimelineState,
  options: Pick<PreviewProxyPlanningOptions, 'focusFrame' | 'beforeFrames' | 'afterFrames'> = {},
): number {
  const events: Array<{ frame: number; delta: number }> = [];
  const focus = Number.isFinite(options.focusFrame) ? Math.max(0, Number(options.focusFrame)) : null;
  const from = focus === null ? Number.NEGATIVE_INFINITY : focus - Math.max(0, Number(options.beforeFrames) || 0);
  const to = focus === null ? Number.POSITIVE_INFINITY : focus + Math.max(1, Number(options.afterFrames) || 1);
  for (const item of state.items) {
    if ((item.kind !== 'video' || !item.src) && item.kind !== 'sequence') continue;
    if (state.tracks?.[item.track]?.hidden) continue;
    const startFrame = Math.max(item.startFrame, from);
    const endFrame = Math.min(item.startFrame + item.durationInFrames, to);
    if (endFrame <= startFrame) continue;
    const weight = item.kind === 'sequence' ? 2 : 1;
    events.push({ frame: startFrame, delta: weight });
    events.push({ frame: endFrame, delta: -weight });
  }
  events.sort((left, right) => left.frame - right.frame || left.delta - right.delta);
  let active = 0;
  let peak = 0;
  for (const event of events) {
    active += event.delta;
    peak = Math.max(peak, active);
  }
  return normalizedPressure(Math.max(1, peak));
}

export function orderedPreviewSourcesForProject(
  project: ProjectDoc,
  activeTimelineId: string,
  reachableTimelineIds: readonly string[],
  options: PreviewProxyPlanningOptions = {},
): string[] {
  const timelineOrder = [activeTimelineId, ...reachableTimelineIds.filter((id) => id !== activeTimelineId)];
  const seen = new Set<string>();
  const sources: string[] = [];
  for (const id of timelineOrder) {
    const timeline = project.timelines.find((candidate) => candidate.id === id);
    if (!timeline) continue;
    const sourceOptions = id === activeTimelineId ? options : {};
    for (const src of orderedVideoSources(timeline.items, sourceOptions)) {
      if (seen.has(src)) continue;
      seen.add(src);
      sources.push(src);
      if (sources.length >= Math.max(1, Math.floor(options.maxSources ?? Number.MAX_SAFE_INTEGER))) {
        return sources;
      }
    }
  }
  return sources;
}

export function resolveTimelinePreviewSources<T extends TimelineState>(
  state: T,
  previewSrcFor: (src: string) => string | undefined,
): T {
  let items: TimelineState['items'] | null = null;
  state.items.forEach((item, index) => {
    if (item.kind !== 'video' || !item.src) return;
    const previewSrc = previewSrcFor(item.src);
    if (!previewSrc || previewSrc === item.src) return;
    items ??= [...state.items];
    items[index] = { ...item, src: previewSrc };
  });
  return items ? { ...state, items } : state;
}

export function resolveProjectPreviewSources(
  project: ProjectDoc,
  reachableTimelineIds: ReadonlySet<string>,
  previewSrcFor: (src: string) => string | undefined,
): ProjectDoc {
  let timelines: Timeline[] | null = null;
  project.timelines.forEach((timeline, index) => {
    if (!reachableTimelineIds.has(timeline.id)) return;
    const resolved = resolveTimelinePreviewSources(timeline, previewSrcFor);
    if (resolved === timeline) return;
    timelines ??= [...project.timelines];
    timelines[index] = resolved;
  });
  return timelines ? { ...project, timelines } : project;
}

function resolvePreviewSrc(src: string | undefined, proxy: PreviewProxyState): string | undefined {
  if (shouldPreferMasterPreview() && src) return src;
  return proxy.status === 'ready' ? proxy.previewSrc : src;
}

export function usePreviewMediaSource(src: string | undefined, enabled = true) {
  const source = enabled && isPreviewable(src) ? src : '';
  const sources = useMemo(() => source ? [source] : [], [source]);
  const revision = useProxySources(sources);
  const proxy = stateFor(source || undefined, shouldAutoRequestPreviewProxy());
  const previewSrc = resolvePreviewSrc(src, proxy);
  return {
    sourceSrc: src,
    previewSrc,
    posterSrc: mediaPosterUrl(source || undefined),
    proxy,
    requestFallback: useCallback(() => {
      if (source) reportPreviewPlaybackFailure(source);
    }, [source]),
    revision,
  };
}

export function usePreviewTimelineState(state: TimelineState) {
  const sources = useMemo(() => orderedPreviewSourcesForTimeline(state), [state]);
  const pressure = previewDecodePressure(state);
  const revision = useProxySources(sources, { pressure });
  const previewState = useMemo<TimelineState>(() => {
    void revision; // recompute when the proxy cache bumps (proxies live in module state)
    return resolveTimelinePreviewSources(state, (src) => (
      resolvePreviewSrc(src, stateFor(src, shouldAutoRequestPreviewProxy()))
    ));
  }, [state, revision]);
  const proxies = sources.map((src) => ({ src, proxy: stateFor(src, shouldAutoRequestPreviewProxy()) }));
  return {
    state: previewState,
    proxies,
    requestFallback: (src: string) => { reportPreviewPlaybackFailure(src); },
  };
}

/** Resolve preview proxies across the complete reachable nested-sequence graph. */
export function usePreviewProjectDoc(
  project: ProjectDoc,
  timelineId: string,
  options: PreviewProxyPlanningOptions = {},
) {
  const plan = useMemo(() => resolveTimelineRenderPlan(project, timelineId), [project, timelineId]);
  const reachable = useMemo(() => new Set(plan.timelineIds), [plan.timelineIds]);
  const activeState = project.timelines.find((timeline) => timeline.id === timelineId)!;
  const focusFrame = options.focusFrame;
  const beforeFrames = options.beforeFrames;
  const afterFrames = options.afterFrames;
  const maxSources = options.maxSources;
  const prefetchSources = options.prefetchSources;
  const proxyConcurrency = options.proxyConcurrency;
  const pressure = normalizedPressure(options.pressure ?? previewDecodePressure(activeState, {
    focusFrame, beforeFrames, afterFrames,
  }));
  const sources = useMemo(
    () => orderedPreviewSourcesForProject(project, timelineId, plan.timelineIds, {
      focusFrame, beforeFrames, afterFrames, maxSources,
    }),
    [afterFrames, beforeFrames, focusFrame, maxSources, project, timelineId, plan.timelineIds],
  );
  const sourceSet = useMemo(() => new Set(sources), [sources]);
  const revision = useProxySources(sources, { prefetchSources, proxyConcurrency, pressure });
  const previewProject = useMemo<ProjectDoc>(() => {
    void revision; // recompute when the proxy cache bumps (proxies live in module state)
    return resolveProjectPreviewSources(project, reachable, (src) => (
      sourceSet.has(src)
        ? resolvePreviewSrc(src, stateFor(src, shouldAutoRequestPreviewProxy()))
        : src
    ));
  }, [project, reachable, revision, sourceSet]);
  const state = previewProject.timelines.find((timeline) => timeline.id === timelineId)!;
  return {
    project: previewProject,
    state,
    plan,
    pressure,
    proxies: sources.map((src) => ({ src, proxy: stateFor(src, shouldAutoRequestPreviewProxy()) })),
    requestFallback: (src: string) => { reportPreviewPlaybackFailure(src); },
  };
}

export function __previewProxyCacheStatsForVerify() {
  return { entries: proxyEntries.size, ...proxyScheduler.stats() };
}

export function __resetPreviewProxyStateForVerify(): void {
  for (const entry of proxyEntries.values()) entry.controller?.abort();
  proxyScheduler.clear();
  proxyScheduler.setConcurrency(1);
  proxyEntries.clear();
  accessSequence = 0;
}
