import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  type SpawnOptionsWithStdioTuple,
  type SpawnOptionsWithoutStdio,
  type StdioNull,
  type StdioPipe,
} from 'node:child_process';
import { availableParallelism, constants, setPriority, totalmem } from 'node:os';

const GIB = 1024 ** 3;

export interface MediaCpuBudget {
  readonly logicalCores: number;
  readonly totalMemoryBytes: number;
  readonly ffmpegThreadsPerProcess: number;
  readonly backgroundProcessConcurrency: number;
}

export type MediaToolKind = 'ffmpeg' | 'ffprobe';

/**
 * Keep the editor responsive while still scaling FFmpeg across workstation
 * CPUs. Entry-level machines reserve at least one logical core and avoid two
 * memory-heavy media workers; larger hosts use more cores without creating an
 * unbounded thread pool for every child process.
 */
export function resolveMediaCpuBudget(
  cores: number = availableParallelism(),
  totalMemoryBytes: number = totalmem(),
): MediaCpuBudget {
  const logicalCores = Math.max(1, Math.floor(cores) || 1);
  const memory = Math.max(0, Math.floor(totalMemoryBytes) || 0);
  const constrained = logicalCores <= 4 || memory < 12 * GIB;
  const workstation = logicalCores >= 16 && memory >= 24 * GIB;
  const backgroundProcessConcurrency = constrained ? 1 : workstation ? 3 : 2;
  const reservedForEditor = constrained
    ? Math.max(1, Math.ceil(logicalCores * 0.5))
    : Math.max(1, Math.ceil(logicalCores * 0.25));
  const backgroundThreadPool = Math.max(1, logicalCores - reservedForEditor);
  const ffmpegThreadsPerProcess = constrained
    ? Math.min(2, backgroundThreadPool)
    : Math.min(16, Math.max(2, Math.floor(backgroundThreadPool / backgroundProcessConcurrency)));
  return {
    logicalCores,
    totalMemoryBytes: memory,
    ffmpegThreadsPerProcess,
    backgroundProcessConcurrency,
  };
}

/** Cap FFmpeg worker threads as one share of the complete background-process
 * budget. The aggregate default stays below the host's logical-core count. */
export function ffmpegThreadCount(
  cores: number = availableParallelism(),
  totalMemoryBytes: number = totalmem(),
): number {
  const override = Number(process.env.YOLOCUT_FFMPEG_THREADS);
  if (Number.isFinite(override) && override >= 1) {
    return Math.max(1, Math.min(Math.floor(override), Math.max(1, cores)));
  }
  return resolveMediaCpuBudget(cores, totalMemoryBytes).ffmpegThreadsPerProcess;
}

/** Codec-scoped thread option. Place it in each input or output option group
 * that should be capped; an option before `-i` does not limit output encoders. */
export function ffmpegThreadArgs(
  cores: number = availableParallelism(),
  totalMemoryBytes: number = totalmem(),
): string[] {
  return ['-threads', String(ffmpegThreadCount(cores, totalMemoryBytes))];
}

/** FFprobe accepts some codec options but is not an encoder. Injecting the
 * FFmpeg worker-thread option into a probe can crash specific static Linux
 * builds on transport streams, so only FFmpeg processes receive the cap. */
export function mediaProcessArgs(
  kind: MediaToolKind,
  args: readonly string[],
  cores: number = availableParallelism(),
  totalMemoryBytes: number = totalmem(),
): string[] {
  return kind === 'ffprobe'
    ? [...args]
    : [...ffmpegThreadArgs(cores, totalMemoryBytes), ...args];
}

/**
 * Spawn a media tool (ffmpeg/ffprobe) at below-normal OS priority so import,
 * normalization, preview derivatives and export never compete with the user's
 * foreground applications for CPU time. Best-effort on every platform.
 */
export function spawnMediaProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
): ChildProcessWithoutNullStreams;
export function spawnMediaProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>,
): ChildProcessWithoutNullStreams;
export function spawnMediaProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioNull, StdioPipe>,
): ChildProcessWithoutNullStreams;
export function spawnMediaProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioNull>,
): ChildProcessWithoutNullStreams;
export function spawnMediaProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithStdioTuple<StdioPipe, StdioNull, StdioNull>,
): ChildProcessWithoutNullStreams;
export function spawnMediaProcess(
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcess;
export function spawnMediaProcess(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): ChildProcess {
  const child = spawn(command, args, options);
  if (child.pid !== undefined) {
    try {
      setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // Priority adjustment is best-effort; the child still runs.
    }
  }
  return child;
}
