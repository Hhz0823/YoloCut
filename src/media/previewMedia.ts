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
  promise: Promise<void> | null;
  controller: AbortController | null;
  listeners: Set<() => void>;
  force: boolean;
  autoQueued: boolean;
  lastAccess: number;
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
      promise: null,
      controller: null,
      listeners: new Set(),
      force: false,
      autoQueued: false,
      lastAccess: 0,
    };
    proxyEntries.set(src, entry);
  }
  touch(entry);
  return entry;
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

async function loadProxy(src: string, force: boolean, entry: ProxyEntry): Promise<void> {
  touch(entry);
  if (entry.promise) {
    await entry.promise;
    if (force && !entry.force && entry.response?.proxy.status !== 'ready') await loadProxy(src, true, entry);
    return;
  }
  if (entry.response && (!force || entry.response.proxy.status === 'ready')) {
    const retryableFailure = entry.response.proxy.status === 'failed'
      && entry.response.proxy.reason !== 'proxy-playback-failed'
      && Date.now() - entry.responseAt >= PREVIEW_PROXY_RETRY_MS;
    if (!retryableFailure) return;
  }
  entry.force = force;
  entry.response = null;
  notify(entry);
  const query = `src=${encodeURIComponent(src)}${force ? '&force=1' : ''}`;
  const controller = new AbortController();
  entry.controller = controller;
  entry.promise = fetch(`/api/preview-proxy?${query}`, { signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) throw new Error(await responseError(response));
      entry.response = await response.json() as PreviewProxyResponse;
      entry.responseAt = Date.now();
    })
    .catch((error) => {
      if (!controller.signal.aborted) {
        entry.response = failedResponse(src, error);
        entry.responseAt = Date.now();
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

export function requestPreviewProxy(src: string, force = false): Promise<void> {
  if (!isPreviewable(src)) return Promise.resolve();
  const entry = proxyEntry(src);
  if (proxyScheduler.cancel(src)) entry.autoQueued = false;
  return loadProxy(src, force, entry);
}

function queuePreviewProxy(src: string, priority: number, force: boolean): void {
  if (!isPreviewable(src)) return;
  const entry = proxyEntry(src);
  proxyScheduler.enqueue(src, priority, async () => {
    entry.autoQueued = false;
    await loadProxy(src, force, entry);
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

function useProxySources(sources: readonly string[]): number {
  const [revision, setRevision] = useState(0);
  const quality = useQualitySnapshot();
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
    const bump = () => setRevision((value) => value + 1);
    return subscribe(subscribedSources, bump);
  }, [subscribedSources]);
  useEffect(() => {
    if (shouldAutoRequestPreviewProxy(quality.mode, quality.preview)) {
      prioritySources.forEach((src, priority) => queuePreviewProxy(src, priority, quality.preview === 'proxy'));
    } else {
      for (const src of subscribedSources) {
        const entry = proxyEntries.get(src);
        if (entry?.autoQueued && proxyScheduler.cancel(src)) entry.autoQueued = false;
      }
    }
  }, [prioritySources, subscribedSources, quality.mode, quality.preview]);
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
          queuePreviewProxy(src, priority, quality.preview === 'proxy');
        }
      });
      // Recalculate the next failure's deadline. The queued request clears its
      // own failed response in a microtask before this effect runs again.
      setRevision((value) => value + 1);
    };
    const timer = window.setTimeout(retry, Math.max(0, nextRetryAt - now));
    return () => window.clearTimeout(timer);
  }, [prioritySources, subscribedSources, quality.mode, quality.preview, revision]);
  // Re-resolve preview src when quality/preview-source mode flips even if proxy cache is quiet.
  useEffect(() => {
    setRevision((value) => value + 1);
  }, [quality.mode, quality.preview]);
  return revision;
}

function orderedVideoSources(items: TimelineState['items']): string[] {
  const seen = new Set<string>();
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === 'video' && isPreviewable(item.src))
    .sort((left, right) => left.item.startFrame - right.item.startFrame || left.index - right.index)
    .flatMap(({ item }) => {
      const src = item.src!;
      if (seen.has(src)) return [];
      seen.add(src);
      return [src];
    });
}

export function orderedPreviewSourcesForTimeline(state: TimelineState): string[] {
  return orderedVideoSources(state.items);
}

export function orderedPreviewSourcesForProject(
  project: ProjectDoc,
  activeTimelineId: string,
  reachableTimelineIds: readonly string[],
): string[] {
  const timelineOrder = [activeTimelineId, ...reachableTimelineIds.filter((id) => id !== activeTimelineId)];
  const seen = new Set<string>();
  const sources: string[] = [];
  for (const id of timelineOrder) {
    const timeline = project.timelines.find((candidate) => candidate.id === id);
    if (!timeline) continue;
    for (const src of orderedVideoSources(timeline.items)) {
      if (seen.has(src)) continue;
      seen.add(src);
      sources.push(src);
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
  const revision = useProxySources(sources);
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
export function usePreviewProjectDoc(project: ProjectDoc, timelineId: string) {
  const plan = useMemo(() => resolveTimelineRenderPlan(project, timelineId), [project, timelineId]);
  const reachable = useMemo(() => new Set(plan.timelineIds), [plan.timelineIds]);
  const sources = useMemo(
    () => orderedPreviewSourcesForProject(project, timelineId, plan.timelineIds),
    [project, timelineId, plan.timelineIds],
  );
  const revision = useProxySources(sources);
  const previewProject = useMemo<ProjectDoc>(() => {
    void revision; // recompute when the proxy cache bumps (proxies live in module state)
    return resolveProjectPreviewSources(project, reachable, (src) => (
      resolvePreviewSrc(src, stateFor(src, shouldAutoRequestPreviewProxy()))
    ));
  }, [project, reachable, revision]);
  const state = previewProject.timelines.find((timeline) => timeline.id === timelineId)!;
  return {
    project: previewProject,
    state,
    plan,
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
  proxyEntries.clear();
  accessSequence = 0;
}
