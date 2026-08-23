import { execFile } from 'node:child_process';

import {
  recommendLocalVoiceHardware,
  type LocalNvidiaGpuProfile,
  type LocalVoiceHardwareSnapshot,
} from '../../shared/local-voice-hardware.ts';

const NVIDIA_SMI_TIMEOUT_MS = 4_000;
const MAX_NVIDIA_SMI_BYTES = 64 * 1024;

export function parseLocalNvidiaGpus(output: string): readonly LocalNvidiaGpuProfile[] {
  return output.split(/\r?\n/).flatMap((line): LocalNvidiaGpuProfile[] => {
    const columns = line.split(',').map((value) => value.trim());
    if (columns.length < 3) return [];
    const name = columns.slice(0, -2).join(', ').slice(0, 160);
    const memoryMiB = Number(columns.at(-2));
    const computeCapability = Number(columns.at(-1));
    if (!name || !Number.isFinite(memoryMiB) || memoryMiB <= 0
      || !Number.isFinite(computeCapability) || computeCapability <= 0) return [];
    return [{ name, memoryMiB, computeCapability }];
  });
}

function queryNvidiaSmi(): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('nvidia-smi', [
      '--query-gpu=name,memory.total,compute_cap',
      '--format=csv,noheader,nounits',
    ], { timeout: NVIDIA_SMI_TIMEOUT_MS, windowsHide: true, maxBuffer: MAX_NVIDIA_SMI_BYTES }, (error, stdout) => {
      if (error) reject(error);
      else resolvePromise(stdout);
    });
  });
}

function recommendationRank(gpu: LocalNvidiaGpuProfile): number {
  const tier = recommendLocalVoiceHardware(gpu).tier;
  return tier === 'performance' ? 3 : tier === 'recommended' ? 2 : tier === 'minimum' ? 1 : 0;
}

export function selectLocalVoiceGpu(
  gpus: readonly LocalNvidiaGpuProfile[],
): LocalNvidiaGpuProfile | null {
  return [...gpus].sort((left, right) => (
    recommendationRank(right) - recommendationRank(left)
    || right.memoryMiB - left.memoryMiB
    || right.computeCapability - left.computeCapability
  ))[0] ?? null;
}

let cached: { expiresAt: number; value: Promise<LocalVoiceHardwareSnapshot> } | null = null;

export async function probeLocalVoiceHardware(
  load: () => Promise<string> = queryNvidiaSmi,
): Promise<LocalVoiceHardwareSnapshot> {
  if (load === queryNvidiaSmi && cached && cached.expiresAt > Date.now()) return cached.value;
  const value = (async (): Promise<LocalVoiceHardwareSnapshot> => {
    let gpus: readonly LocalNvidiaGpuProfile[] = [];
    if (process.platform === 'win32' && process.arch === 'x64') {
      try { gpus = parseLocalNvidiaGpus(await load()); } catch { gpus = []; }
    }
    const selectedGpu = selectLocalVoiceGpu(gpus);
    return { gpus, selectedGpu, recommendation: recommendLocalVoiceHardware(selectedGpu) };
  })();
  if (load === queryNvidiaSmi) cached = { expiresAt: Date.now() + 30_000, value };
  return value;
}

export function __resetLocalVoiceHardwareForVerify(): void {
  cached = null;
}
