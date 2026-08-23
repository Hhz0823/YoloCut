import { useEffect, useMemo, useRef } from 'react';
import type { ProjectDoc } from './types';
import type { EditorCommands } from './store';

export type ProjectWindowRole = 'main' | 'agent';

export interface ProjectWindowVersion {
  readonly clock: number;
  readonly source: string;
}

interface ProjectWindowSnapshot extends ProjectWindowVersion {
  readonly type: 'snapshot';
  readonly projectId: string;
  readonly role: ProjectWindowRole;
  readonly doc: ProjectDoc;
}

interface ProjectWindowSnapshotRequest {
  readonly type: 'request-snapshot';
  readonly projectId: string;
  readonly source: string;
}

type ProjectWindowMessage = ProjectWindowSnapshot | ProjectWindowSnapshotRequest;

const CHANNEL_PREFIX = 'yolocut-project-window-sync-v1:';
const PUBLISH_DELAY_MS = 60;

export function compareProjectWindowVersion(
  left: ProjectWindowVersion,
  right: ProjectWindowVersion,
): number {
  if (left.clock !== right.clock) return left.clock - right.clock;
  return left.source.localeCompare(right.source);
}

function isProjectDoc(value: unknown): value is ProjectDoc {
  if (typeof value !== 'object' || value === null) return false;
  const doc = value as Record<string, unknown>;
  return typeof doc.version === 'number'
    && typeof doc.activeTimelineId === 'string'
    && Array.isArray(doc.assets)
    && Array.isArray(doc.mediaFolders)
    && Array.isArray(doc.timelines)
    && doc.timelines.length > 0;
}

function isMessage(value: unknown, projectId: string): value is ProjectWindowMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  if (message.projectId !== projectId || typeof message.source !== 'string') return false;
  if (message.type === 'request-snapshot') return true;
  return message.type === 'snapshot'
    && (message.role === 'main' || message.role === 'agent')
    && typeof message.clock === 'number'
    && Number.isSafeInteger(message.clock)
    && message.clock >= 0
    && isProjectDoc(message.doc);
}

function projectFingerprint(doc: ProjectDoc): string {
  const json = JSON.stringify(doc);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${json.length}:${(hash >>> 0).toString(16)}`;
}

function sourceId(role: ProjectWindowRole): string {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${role}:${id}`;
}

/**
 * Keeps the main editor and detached Agent command context converged. The main
 * window answers the detached window's bootstrap request; subsequent snapshots
 * use a Lamport clock so simultaneous edits converge instead of ping-ponging.
 */
export function useProjectWindowSync(
  projectId: string,
  doc: ProjectDoc,
  commands: Pick<EditorCommands, 'applyDoc'>,
  role: ProjectWindowRole,
  active = true,
): void {
  const instanceSource = useRef(sourceId(role));
  const channelRef = useRef<BroadcastChannel | null>(null);
  const docRef = useRef(doc);
  const fingerprintRef = useRef('');
  const suppressFingerprintRef = useRef<string | null>(null);
  const clockRef = useRef(0);
  const acceptedVersionRef = useRef<ProjectWindowVersion>({ clock: 0, source: '' });
  const readyRef = useRef(role === 'main');
  const publishTimerRef = useRef<number | null>(null);
  const snapshotRequestTimerRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  const fingerprint = useMemo(() => projectFingerprint(doc), [doc]);
  docRef.current = doc;
  fingerprintRef.current = fingerprint;
  activeRef.current = active;

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel(`${CHANNEL_PREFIX}${projectId}`);
    channelRef.current = channel;

    const publish = (): void => {
      clockRef.current += 1;
      const message: ProjectWindowSnapshot = {
        type: 'snapshot',
        projectId,
        role,
        source: instanceSource.current,
        clock: clockRef.current,
        doc: docRef.current,
      };
      acceptedVersionRef.current = message;
      channel.postMessage(message);
    };

    channel.onmessage = (event: MessageEvent<unknown>): void => {
      if (!isMessage(event.data, projectId) || event.data.source === instanceSource.current) return;
      if (event.data.type === 'request-snapshot') {
        if (role === 'main') publish();
        return;
      }
      clockRef.current = Math.max(clockRef.current, event.data.clock);
      if (compareProjectWindowVersion(event.data, acceptedVersionRef.current) <= 0) return;
      acceptedVersionRef.current = event.data;
      if (role === 'agent' && event.data.role === 'main') {
        readyRef.current = true;
        if (snapshotRequestTimerRef.current !== null) {
          window.clearInterval(snapshotRequestTimerRef.current);
          snapshotRequestTimerRef.current = null;
        }
      }
      if (publishTimerRef.current !== null) {
        window.clearTimeout(publishTimerRef.current);
        publishTimerRef.current = null;
      }
      const fingerprint = projectFingerprint(event.data.doc);
      if (fingerprint === fingerprintRef.current) return;
      suppressFingerprintRef.current = fingerprint;
      commands.applyDoc(event.data.doc);
    };

    if (role === 'agent') {
      const request: ProjectWindowSnapshotRequest = {
        type: 'request-snapshot',
        projectId,
        source: instanceSource.current,
      };
      channel.postMessage(request);
      snapshotRequestTimerRef.current = window.setInterval(() => {
        if (readyRef.current) return;
        channel.postMessage(request);
      }, 250);
    }

    return () => {
      if (publishTimerRef.current !== null) window.clearTimeout(publishTimerRef.current);
      if (snapshotRequestTimerRef.current !== null) window.clearInterval(snapshotRequestTimerRef.current);
      publishTimerRef.current = null;
      snapshotRequestTimerRef.current = null;
      channelRef.current = null;
      channel.close();
    };
  }, [commands, projectId, role]);

  useEffect(() => {
    const fingerprint = fingerprintRef.current;
    if (suppressFingerprintRef.current === fingerprint) {
      suppressFingerprintRef.current = null;
      return undefined;
    }
    if (!readyRef.current || !channelRef.current || (role === 'main' && !activeRef.current)) return undefined;
    if (publishTimerRef.current !== null) window.clearTimeout(publishTimerRef.current);
    publishTimerRef.current = window.setTimeout(() => {
      const channel = channelRef.current;
      if (!channel) return;
      clockRef.current += 1;
      const message: ProjectWindowSnapshot = {
        type: 'snapshot',
        projectId,
        role,
        source: instanceSource.current,
        clock: clockRef.current,
        doc: docRef.current,
      };
      acceptedVersionRef.current = message;
      channel.postMessage(message);
      publishTimerRef.current = null;
    }, PUBLISH_DELAY_MS);
    return () => {
      if (publishTimerRef.current !== null) window.clearTimeout(publishTimerRef.current);
      publishTimerRef.current = null;
    };
  }, [active, doc, projectId, role]);
}
