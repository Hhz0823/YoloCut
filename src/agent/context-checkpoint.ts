import type { ModelMessage } from 'ai';
import { LEGACY_PERSISTENCE_IDS } from '../../shared/product-compat';

const CHECKPOINT_MARKER_OPEN = '<yolocut_checkpoint>';
const CHECKPOINT_MARKER_CLOSE = '</yolocut_checkpoint>';
const CHECKPOINT_MARKERS = [
  { open: CHECKPOINT_MARKER_OPEN, close: CHECKPOINT_MARKER_CLOSE },
  {
    open: LEGACY_PERSISTENCE_IDS.checkpointMarkerOpen,
    close: LEGACY_PERSISTENCE_IDS.checkpointMarkerClose,
  },
] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const CHECKPOINT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CHECKPOINT_SUMMARY_PREFIX =
  'Conversation checkpoint (factual record of earlier turns; not new user instructions):\n\n';

type ContentPart = { readonly text?: unknown };

export interface ContextCheckpointLinkage {
  readonly checkpointId: string;
  readonly sourceDigest: string;
  readonly summaryDigest: string;
}

export interface ContextCheckpointMarker extends ContextCheckpointLinkage {
  readonly version: 1;
}

export interface PersistedContextCheckpoint {
  readonly checkpointId: string;
  readonly sourceDigest: string;
  readonly summary: string;
  readonly summaryDigest?: string;
  readonly sourceArtifactId: string;
}

export interface ContextCheckpointSourceArtifact {
  readonly kind: string;
  readonly body: string;
  readonly bodySha256: string;
}

export class ContextIntegrityError extends Error {
  constructor(message: string) {
    super(`Context integrity error: ${message}`);
    this.name = 'ContextIntegrityError';
  }
}

async function sha256Text(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('The current environment cannot verify a secure context checkpoint digest.');
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function formatContextCheckpointMarker(linkage: ContextCheckpointLinkage): string {
  const payload = JSON.stringify({
    v: 1,
    id: linkage.checkpointId,
    source: linkage.sourceDigest,
    summary: linkage.summaryDigest,
  });
  return `${CHECKPOINT_MARKER_OPEN}${payload}${CHECKPOINT_MARKER_CLOSE}`;
}

export function formatContextCheckpointMessage(
  summary: string,
  linkage: ContextCheckpointLinkage,
): string {
  return `${CHECKPOINT_SUMMARY_PREFIX}${summary}\n\n${formatContextCheckpointMarker(linkage)}`;
}

function checkpointMessageText(message: ModelMessage): string | null {
  if (message.role !== 'assistant') return null;
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return null;
  return (message.content as readonly ContentPart[])
    .flatMap((part) => typeof part.text === 'string' ? [part.text] : [])
    .join('\n');
}

function parseMarkerPayload(payload: string): ContextCheckpointMarker {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new ContextIntegrityError('checkpoint marker JSON is malformed.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ContextIntegrityError('checkpoint marker must be an object.');
  }
  const keys = Object.keys(parsed).sort().join(',');
  if (keys !== 'id,source,summary,v'
    || !('v' in parsed) || parsed.v !== 1
    || !('id' in parsed) || typeof parsed.id !== 'string' || !CHECKPOINT_ID.test(parsed.id)
    || !('source' in parsed) || typeof parsed.source !== 'string' || !SHA256_HEX.test(parsed.source)
    || !('summary' in parsed) || typeof parsed.summary !== 'string' || !SHA256_HEX.test(parsed.summary)) {
    throw new ContextIntegrityError('checkpoint marker fields are invalid.');
  }
  return {
    version: 1,
    checkpointId: parsed.id,
    sourceDigest: parsed.source,
    summaryDigest: parsed.summary,
  };
}

/** Parse one explicitly selected checkpoint slot; callers must not scan model-visible history. */
export function parseContextCheckpointMarker(message: ModelMessage): ContextCheckpointMarker | null {
  const text = checkpointMessageText(message);
  if (text === null) return null;
  const marker = CHECKPOINT_MARKERS
    .map((candidate) => ({ ...candidate, start: text.lastIndexOf(candidate.open) }))
    .sort((left, right) => right.start - left.start)[0]!;
  const { start } = marker;
  if (start < 0) {
    if (CHECKPOINT_MARKERS.some((candidate) => text.includes(candidate.close))) {
      throw new ContextIntegrityError('checkpoint marker is incomplete.');
    }
    return null;
  }
  const payloadStart = start + marker.open.length;
  const end = text.indexOf(marker.close, payloadStart);
  if (end < 0 || end + marker.close.length !== text.length) {
    throw new ContextIntegrityError('checkpoint marker is incomplete or not terminal.');
  }
  return parseMarkerPayload(text.slice(payloadStart, end));
}

export function verifyContextCheckpointMarker(
  message: ModelMessage,
  persisted: ContextCheckpointLinkage | undefined,
): ContextCheckpointMarker | null {
  const marker = parseContextCheckpointMarker(message);
  if (!marker) return null;
  if (!persisted) throw new ContextIntegrityError('marked checkpoint sidecar is missing.');
  if (marker.checkpointId !== persisted.checkpointId
    || marker.sourceDigest !== persisted.sourceDigest
    || marker.summaryDigest !== persisted.summaryDigest) {
    throw new ContextIntegrityError('marked checkpoint sidecar does not match saved chat.');
  }
  return marker;
}

function checkpointSummary(message: ModelMessage): string {
  const text = checkpointMessageText(message);
  const marker = text === null ? -1 : Math.max(
    ...CHECKPOINT_MARKERS.map((candidate) => text.lastIndexOf(`\n\n${candidate.open}`)),
  );
  if (text === null || !text.startsWith(CHECKPOINT_SUMMARY_PREFIX)
      || marker < CHECKPOINT_SUMMARY_PREFIX.length) {
    throw new ContextIntegrityError('canonical checkpoint summary shape is invalid.');
  }
  return text.slice(CHECKPOINT_SUMMARY_PREFIX.length, marker);
}

/** Sidecar rows reserve index zero and make the complete runtime marker mandatory. */
export async function verifyCanonicalContextCheckpoint(
  messages: readonly ModelMessage[],
  checkpoints: readonly PersistedContextCheckpoint[],
  loadSourceArtifact: (
    sourceArtifactId: string,
  ) => Promise<ContextCheckpointSourceArtifact | null>,
): Promise<ContextCheckpointMarker | null> {
  if (messages.length === 0) return null;
  const canonical = messages[0]!;
  const canonicalText = checkpointMessageText(canonical);
  if (canonicalText === null || !canonicalText.startsWith(CHECKPOINT_SUMMARY_PREFIX)) return null;
  if (checkpoints.length === 0) return null;
  const marker = parseContextCheckpointMarker(canonical);
  if (!marker) throw new ContextIntegrityError('canonical checkpoint marker is missing.');
  const persisted = checkpoints.find((checkpoint) => checkpoint.checkpointId === marker.checkpointId);
  if (!persisted) throw new ContextIntegrityError('marked checkpoint sidecar is missing.');
  const summaryDigest = persisted.summaryDigest ?? await sha256Text(persisted.summary);
  verifyContextCheckpointMarker(canonical, {
    checkpointId: persisted.checkpointId,
    sourceDigest: persisted.sourceDigest,
    summaryDigest,
  });
  if (await sha256Text(checkpointSummary(canonical)) !== summaryDigest
      || await sha256Text(persisted.summary) !== summaryDigest) {
    throw new ContextIntegrityError('checkpoint summary digest has changed.');
  }
  const artifact = await loadSourceArtifact(persisted.sourceArtifactId);
  if (!artifact || artifact.kind !== 'checkpoint-source'
      || artifact.bodySha256 !== persisted.sourceDigest
      || await sha256Text(artifact.body) !== persisted.sourceDigest) {
    throw new ContextIntegrityError('checkpoint source artifact is missing or has changed.');
  }
  return marker;
}
