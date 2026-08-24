import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  MAX_AUTO_EDIT_BATCH_JOBS,
  type AutoEditSourceDescriptor,
} from '../shared/auto-edit-batch.ts';
import type {
  AutoEditSourceImportRequest,
  AutoEditSourceImportResult,
  AutoEditSourceSelection,
} from '../shared/auto-edit-source.ts';
import { LEGACY_PORTABLE_FORMATS } from '../shared/product-compat.ts';
import { VIDEO_FILE_EXTENSION_SET } from '../shared/media-file-extensions.ts';
import { canonicalCurrentUploadDirectory, importDirectoryCandidate, isPathInside } from './directory-watch-import.ts';

const GRANT_FORMAT = 'yolocut-auto-edit-source-grants@1';
const MAX_DEPTH = 24;
const MAX_GRANTS = 20;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.gif']);
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus']);

interface StoredSource extends AutoEditSourceDescriptor {
  readonly relativePath: string;
  readonly modifiedAt: number;
}

interface StoredGrant {
  readonly id: string;
  readonly root: string;
  readonly directoryName: string;
  readonly createdAt: number;
  readonly sources: readonly StoredSource[];
}

interface StoredFile {
  readonly format: typeof GRANT_FORMAT;
  readonly grants: readonly StoredGrant[];
}

function mediaKind(path: string): AutoEditSourceDescriptor['kind'] | null {
  const extension = extname(path).toLowerCase();
  if (VIDEO_FILE_EXTENSION_SET.has(extension)) return 'video';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  return null;
}

function sourceId(relativePath: string, size: number, modifiedAt: number): string {
  return createHash('sha256')
    .update(`${relativePath.replaceAll('\\', '/')}\0${size}\0${modifiedAt}`)
    .digest('base64url')
    .slice(0, 32);
}

function publicSelection(grant: StoredGrant): AutoEditSourceSelection {
  return {
    grantId: grant.id,
    directoryName: grant.directoryName,
    sources: grant.sources.map(({ relativePath: _path, modifiedAt: _modified, ...source }) => source),
  };
}

function validStoredFile(value: unknown): StoredFile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<StoredFile>;
  if ((raw.format !== GRANT_FORMAT
    && raw.format !== LEGACY_PORTABLE_FORMATS.autoEditSourceGrants)
    || !Array.isArray(raw.grants)) return null;
  const grants = raw.grants.filter((grant): grant is StoredGrant => {
    if (!grant || typeof grant !== 'object' || !/^[A-Za-z0-9_-]{1,160}$/.test(grant.id)
      || !isAbsolute(grant.root) || typeof grant.directoryName !== 'string'
      || !Number.isFinite(grant.createdAt) || !Array.isArray(grant.sources)
      || grant.sources.length < 1 || grant.sources.length > MAX_AUTO_EDIT_BATCH_JOBS) return false;
    return grant.sources.every((source: StoredSource) => source && /^[A-Za-z0-9_-]{1,160}$/.test(source.id)
      && typeof source.relativePath === 'string' && source.relativePath.length > 0
      && !isAbsolute(source.relativePath) && !source.relativePath.split(/[\\/]+/).includes('..')
      && typeof source.relativeName === 'string' && typeof source.name === 'string'
      && (source.kind === 'video' || source.kind === 'image' || source.kind === 'audio')
      && Number.isSafeInteger(source.sizeBytes) && source.sizeBytes >= 0
      && Number.isFinite(source.modifiedAt) && source.modifiedAt >= 0);
  }).slice(0, MAX_GRANTS);
  return { format: GRANT_FORMAT, grants };
}

async function scan(root: string): Promise<StoredSource[]> {
  const canonicalRoot = await realpath(root);
  const pending: Array<{ path: string; depth: number }> = [{ path: canonicalRoot, depth: 0 }];
  const sources: StoredSource[] = [];
  while (pending.length) {
    const current = pending.shift()!;
    if (current.depth > MAX_DEPTH) throw new Error(`素材目录超过最大递归深度 ${MAX_DEPTH}`);
    const entries = await readdir(current.path, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(current.path, entry.name);
      if (entry.isDirectory()) {
        pending.push({ path, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const kind = mediaKind(entry.name);
      if (!kind) continue;
      if (sources.length >= MAX_AUTO_EDIT_BATCH_JOBS) {
        throw new Error(`单个批次最多 ${MAX_AUTO_EDIT_BATCH_JOBS} 条素材，请拆分目录后重试。`);
      }
      const canonicalFile = await realpath(path);
      if (!isPathInside(canonicalRoot, canonicalFile)) throw new Error('素材目录包含越界文件');
      const info = await stat(canonicalFile);
      const relativePath = relative(canonicalRoot, canonicalFile);
      const modifiedAt = Math.max(0, info.mtimeMs);
      sources.push({
        id: sourceId(relativePath, info.size, modifiedAt),
        name: entry.name,
        relativeName: relativePath.replaceAll('\\', '/'),
        relativePath,
        kind,
        sizeBytes: info.size,
        modifiedAt,
      });
    }
  }
  if (!sources.length) throw new Error('所选目录中没有支持的视频、图片或音频素材');
  return sources;
}

export class AutoEditSourceGrantStore {
  private readonly storagePath: string;
  private loaded = false;
  private grants: StoredGrant[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = validStoredFile(JSON.parse(await readFile(this.storagePath, 'utf8')) as unknown);
      this.grants = parsed?.grants ? [...parsed.grants] : [];
    } catch {
      this.grants = [];
    }
  }

  private persist(): Promise<void> {
    const snapshot: StoredFile = { format: GRANT_FORMAT, grants: this.grants.slice(0, MAX_GRANTS) };
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.storagePath), { recursive: true });
      const temporary = `${this.storagePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, 'utf8');
      await rename(temporary, this.storagePath);
    });
    return this.writeQueue;
  }

  async grantDirectory(root: string): Promise<AutoEditSourceSelection> {
    await this.load();
    const canonicalRoot = await realpath(root);
    const sources = await scan(canonicalRoot);
    const grant: StoredGrant = {
      id: randomUUID(),
      root: canonicalRoot,
      directoryName: basename(canonicalRoot),
      createdAt: Date.now(),
      sources,
    };
    this.grants = [grant, ...this.grants].slice(0, MAX_GRANTS);
    await this.persist();
    return publicSelection(grant);
  }

  async selection(grantId: string): Promise<AutoEditSourceSelection | null> {
    await this.load();
    const grant = this.grants.find((candidate) => candidate.id === grantId);
    return grant ? publicSelection(grant) : null;
  }

  async importSource(request: AutoEditSourceImportRequest): Promise<AutoEditSourceImportResult> {
    await this.load();
    const grant = this.grants.find((candidate) => candidate.id === request.grantId);
    const source = grant?.sources.find((candidate) => candidate.id === request.sourceId);
    if (!grant || !source) throw new Error('批量素材授权已失效，请在 Agent 工作台重新选择目录');
    const canonicalRoot = await realpath(grant.root);
    const candidate = await realpath(resolve(canonicalRoot, source.relativePath));
    if (!isPathInside(canonicalRoot, candidate)) throw new Error('批量素材越过授权目录');
    const info = await stat(candidate);
    if (!info.isFile() || info.size !== source.sizeBytes || info.mtimeMs !== source.modifiedAt) {
      throw new Error(`源素材已变化，请重新扫描目录：${source.relativeName}`);
    }
    const pinnedUploadDirectory = await canonicalCurrentUploadDirectory();
    const result = await importDirectoryCandidate({
      sourcePath: candidate,
      root: canonicalRoot,
      name: source.name,
      pinnedUploadDirectory,
      knownHashes: new Set(request.knownHashes),
      cancelled: () => false,
      signal: new AbortController().signal,
    });
    if (result.status === 'imported') return { file: result.prepared.file, duplicate: false };
    if (result.status === 'duplicate' || result.status === 'unchanged') return { file: null, duplicate: true };
    if (result.status === 'unsupported') throw new Error(`不支持的素材格式：${source.name}`);
    throw new Error(`素材导入失败，可重试：${source.name}`);
  }
}
