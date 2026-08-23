import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { ModelPackRuntimeAvailability } from '../../shared/model-packs/catalog.ts';
import { LEGACY_PORTABLE_FORMATS } from '../../shared/product-compat.ts';
import { runtimeProfile } from '../runtime-profile.ts';

export const FISH_S2_RUNTIME_FORMAT = 'yolocut-fish-s2-runtime@1';
export const FISH_S2_RUNTIME_REVISION = '2c33261938da1a41d713768b1b391b4d368d7d2c';
export const FISH_S2_LICENSE_ACCEPTANCE = 'fish-audio-research-license-2026-03-07';

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_RUNTIME_FILE_BYTES = 1024 * 1024 * 1024;
const SAFE_RUNTIME_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

interface FishS2RuntimeManifestFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

interface FishS2RuntimeManifest {
  readonly format: typeof FISH_S2_RUNTIME_FORMAT;
  readonly sourceRevision: typeof FISH_S2_RUNTIME_REVISION;
  readonly licenseAcceptanceId: typeof FISH_S2_LICENSE_ACCEPTANCE;
  readonly platform: 'win32';
  readonly arch: 'x64';
  readonly executable: 's2.exe';
  readonly files: readonly FishS2RuntimeManifestFile[];
}

export interface FishS2RuntimeDiscovery extends ModelPackRuntimeAvailability {
  readonly root?: string;
  readonly executablePath?: string;
  readonly manifest?: FishS2RuntimeManifest;
}

let cached: { root: string; expiresAt: number; value: Promise<FishS2RuntimeDiscovery> } | null = null;

export function defaultFishS2RuntimeRoot(): string {
  const configured = process.env.YOLOCUT_FISH_S2_RUNTIME_DIR?.trim();
  if (configured) return configured;
  return join(runtimeProfile().rootDir, 'runtimes', 's2.cpp', FISH_S2_RUNTIME_REVISION, 'win32-x64');
}

function contained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function executableSelfCheck(executablePath: string, root: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const inheritedPath = process.env.PATH ?? process.env.Path ?? '';
    execFile(executablePath, ['--help'], {
      cwd: root,
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      env: {
        PATH: `${root};${inheritedPath}`,
        Path: `${root};${inheritedPath}`,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
      },
    }, (error, stdout) => resolvePromise(!error && /^Usage: s2 \[options\]/m.test(stdout)));
  });
}

function parseManifest(value: unknown): FishS2RuntimeManifest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Partial<FishS2RuntimeManifest>;
  if ((raw.format !== FISH_S2_RUNTIME_FORMAT
    && raw.format !== LEGACY_PORTABLE_FORMATS.fishS2Runtime)
    || raw.sourceRevision !== FISH_S2_RUNTIME_REVISION
    || raw.licenseAcceptanceId !== FISH_S2_LICENSE_ACCEPTANCE
    || raw.platform !== 'win32' || raw.arch !== 'x64' || raw.executable !== 's2.exe'
    || !Array.isArray(raw.files) || raw.files.length < 1 || raw.files.length > 64) return null;
  const files = raw.files as readonly FishS2RuntimeManifestFile[];
  if (!files.some((file) => file.path === raw.executable)
    || files.some((file) => !file || !SAFE_RUNTIME_FILE.test(file.path)
      || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0 || file.sizeBytes > MAX_RUNTIME_FILE_BYTES
      || !/^[a-f0-9]{64}$/.test(file.sha256))
    || new Set(files.map((file) => file.path.toLowerCase())).size !== files.length) return null;
  return { ...raw, format: FISH_S2_RUNTIME_FORMAT } as FishS2RuntimeManifest;
}

async function inspectFishS2Runtime(
  root = defaultFishS2RuntimeRoot(),
  selfCheck: (executablePath: string, root: string) => Promise<boolean> = executableSelfCheck,
): Promise<FishS2RuntimeDiscovery> {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    return { available: false, reason: 'Fish S2 Pro 的首发 s2.cpp 运行组件只支持 Windows x64。' };
  }
  if (!isAbsolute(root)) return { available: false, reason: 'Fish S2 Pro 运行组件目录必须是绝对路径。' };
  try {
    const manifestPath = join(root, 'runtime-manifest.json');
    const manifestInfo = await stat(manifestPath);
    if (!manifestInfo.isFile() || manifestInfo.size <= 0 || manifestInfo.size > MAX_MANIFEST_BYTES) {
      return { available: false, reason: 'Fish S2 Pro 运行组件清单无效。' };
    }
    const manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown);
    if (!manifest) return { available: false, reason: 'Fish S2 Pro 运行组件版本或许可证确认无效。' };
    const realRoot = await realpath(root);
    for (const file of manifest.files) {
      const path = resolve(root, file.path);
      const realFile = await realpath(path);
      if (!contained(realRoot, realFile)) return { available: false, reason: 'Fish S2 Pro 运行组件包含越界文件。' };
      const info = await stat(realFile);
      if (!info.isFile() || info.size !== file.sizeBytes || await sha256(realFile) !== file.sha256) {
        return { available: false, reason: `Fish S2 Pro 运行组件文件校验失败：${file.path}` };
      }
    }
    const executablePath = await realpath(resolve(root, manifest.executable));
    if (!await selfCheck(executablePath, realRoot)) {
      return {
        available: false,
        reason: 'Fish S2 Pro 运行组件自检失败；请确认 CUDA 13.1 cublas 与 VC++ 运行库可用。',
      };
    }
    return {
      available: true,
      root: realRoot,
      executablePath,
      manifest,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      available: false,
      reason: code === 'ENOENT'
        ? '尚未安装独立的 Fish S2 Pro s2.cpp 运行组件。'
        : 'Fish S2 Pro 运行组件检查失败。',
    };
  }
}

export function discoverFishS2Runtime(
  root = defaultFishS2RuntimeRoot(),
  useCache = true,
  selfCheck: (executablePath: string, root: string) => Promise<boolean> = executableSelfCheck,
): Promise<FishS2RuntimeDiscovery> {
  const cacheable = useCache && selfCheck === executableSelfCheck;
  if (cacheable && cached?.root === root && cached.expiresAt > Date.now()) return cached.value;
  const value = inspectFishS2Runtime(root, selfCheck);
  if (cacheable) cached = { root, expiresAt: Date.now() + 30_000, value };
  return value;
}

export function __resetFishS2RuntimeDiscoveryForVerify(): void {
  cached = null;
}
