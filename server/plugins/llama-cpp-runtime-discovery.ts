import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';

import type { ModelPackRuntimeAvailability } from '../../shared/model-packs/catalog.ts';

export const LLAMA_CPP_MINIMUM_BUILD = 6500;

export interface LlamaCppRuntimeDiscovery extends ModelPackRuntimeAvailability {
  readonly executablePath?: string;
  readonly build?: number;
  readonly versionText?: string;
}

let cached: { expiresAt: number; value: Promise<LlamaCppRuntimeDiscovery> } | null = null;

function parseBuild(output: string): number | null {
  const match = /(?:\bversion:\s*|\bbuild:\s*|\bb)(\d{3,})\b/i.exec(output);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

function inspectCandidate(executablePath: string): Promise<LlamaCppRuntimeDiscovery> {
  return new Promise((resolvePromise) => {
    execFile(executablePath, ['--version'], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 128 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        resolvePromise({ available: false, reason: 'llama.cpp 运行组件自检失败。' });
        return;
      }
      const versionText = `${stdout}\n${stderr}`.trim().slice(0, 2_048);
      const build = parseBuild(versionText);
      if (build === null || build < LLAMA_CPP_MINIMUM_BUILD) {
        resolvePromise({
          available: false,
          reason: `llama.cpp 版本过旧或无法识别；需要 build ${LLAMA_CPP_MINIMUM_BUILD} 以上。`,
        });
        return;
      }
      resolvePromise({ available: true, executablePath, build, versionText });
    });
  });
}

async function inspectRuntime(
  candidates?: readonly string[],
): Promise<LlamaCppRuntimeDiscovery> {
  const configured = process.env.YOLOCUT_LLAMA_SERVER_PATH?.trim();
  if (configured && !isAbsolute(configured)) {
    return { available: false, reason: 'YOLOCUT_LLAMA_SERVER_PATH 必须是绝对路径。' };
  }
  const paths = candidates ?? (configured
    ? [configured]
    : process.platform === 'win32'
      ? ['llama-server.exe', 'llama-server']
      : ['llama-server']);
  for (const candidate of paths) {
    const result = await inspectCandidate(candidate);
    if (result.available) return result;
  }
  return {
    available: false,
    reason: process.platform === 'win32'
      ? '尚未检测到 llama.cpp。请先执行 winget install llama.cpp，或设置 YOLOCUT_LLAMA_SERVER_PATH。'
      : '尚未检测到 llama-server；请安装官方 llama.cpp 并确保它位于 PATH。',
  };
}

export function discoverLlamaCppRuntime(
  candidates?: readonly string[],
  useCache = true,
): Promise<LlamaCppRuntimeDiscovery> {
  if (useCache && !candidates && cached && cached.expiresAt > Date.now()) return cached.value;
  const value = inspectRuntime(candidates);
  if (useCache && !candidates) cached = { expiresAt: Date.now() + 30_000, value };
  return value;
}

export function __resetLlamaCppRuntimeDiscoveryForVerify(): void {
  cached = null;
}
