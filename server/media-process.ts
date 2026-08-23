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
import { availableParallelism, constants, setPriority } from 'node:os';

/** Cap ffmpeg worker threads so a single encode cannot saturate the whole
 * machine and starve the editor. Sixty percent leaves render/UI headroom on
 * low-core hosts; the hard cap avoids oversized pools on workstation CPUs. */
export function ffmpegThreadCount(cores: number = availableParallelism()): number {
  const override = Number(process.env.YOLOCUT_FFMPEG_THREADS);
  if (Number.isFinite(override) && override >= 1) {
    return Math.max(1, Math.min(Math.floor(override), Math.max(1, cores)));
  }
  return Math.min(12, Math.max(1, Math.floor(cores * 0.6)));
}

/** Codec-scoped thread option. Place it in each input or output option group
 * that should be capped; an option before `-i` does not limit output encoders. */
export function ffmpegThreadArgs(cores: number = availableParallelism()): string[] {
  return ['-threads', String(ffmpegThreadCount(cores))];
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
