import {
  normalizeAutoEditSources,
  type AutoEditSourceDescriptor,
} from './auto-edit-batch.ts';
import { isDirectoryImportedFile, type DirectoryImportedFile } from './directory-import.ts';

export const AUTO_EDIT_SOURCE_CHANNELS = {
  select: 'yolocut:auto-edit-source-select',
  list: 'yolocut:auto-edit-source-list',
  import: 'yolocut:auto-edit-source-import',
} as const;

export interface AutoEditSourceSelection {
  readonly grantId: string;
  readonly directoryName: string;
  readonly sources: readonly AutoEditSourceDescriptor[];
}

export interface AutoEditSourceImportRequest {
  readonly grantId: string;
  readonly sourceId: string;
  readonly projectId: string;
  readonly knownHashes: readonly string[];
}

export interface AutoEditSourceImportResult {
  readonly file: Omit<DirectoryImportedFile, 'importId'> | null;
  readonly duplicate: boolean;
}

const OPAQUE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export function isAutoEditSourceSelection(value: unknown): value is AutoEditSourceSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Partial<AutoEditSourceSelection>;
  const sources = normalizeAutoEditSources(raw.sources);
  return OPAQUE_ID.test(raw.grantId ?? '')
    && typeof raw.directoryName === 'string'
    && raw.directoryName.length > 0
    && raw.directoryName.length <= 512
    && sources.length > 0
    && sources.length === raw.sources?.length;
}

export function isAutoEditSourceImportRequest(value: unknown): value is AutoEditSourceImportRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Partial<AutoEditSourceImportRequest>;
  return OPAQUE_ID.test(raw.grantId ?? '')
    && OPAQUE_ID.test(raw.sourceId ?? '')
    && OPAQUE_ID.test(raw.projectId ?? '')
    && Array.isArray(raw.knownHashes)
    && raw.knownHashes.length <= 20_000
    && raw.knownHashes.every((hash) => typeof hash === 'string' && SHA256_HEX.test(hash));
}

export function isAutoEditSourceImportResult(value: unknown): value is AutoEditSourceImportResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Partial<AutoEditSourceImportResult>;
  return typeof raw.duplicate === 'boolean'
    && (raw.file === null || (raw.file !== undefined
      && isDirectoryImportedFile({ ...raw.file, importId: 'auto-edit-import' })));
}
