import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ffmpegStatic = require('ffmpeg-static') as string | null;
const ffprobeStatic = require('@derhuerst/ffprobe-static') as string | null;

function codecPackBinary(name: 'ffmpeg' | 'ffprobe'): string | null {
  const executable = `${name}${process.platform === 'win32' ? '.exe' : ''}`;
  const directories = [
    process.env.YOLOCUT_CODEC_PACK_DIR,
    process.resourcesPath ? join(process.resourcesPath, 'codec-pack') : undefined,
  ];
  for (const directory of directories) {
    if (!directory) continue;
    const candidate = join(directory, executable);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function siblingFfprobe(ffmpeg: string | null | undefined): string | null {
  if (!ffmpeg) return null;
  const suffix = extname(ffmpeg).toLowerCase() === '.exe' ? '.exe' : '';
  const candidate = join(dirname(ffmpeg), `ffprobe${suffix}`);
  return existsSync(candidate) ? candidate : null;
}

type Exists = (path: string) => boolean;

function systemMediaBinary(
  name: 'ffmpeg' | 'ffprobe',
  platform: NodeJS.Platform = process.platform,
  fileExists: Exists = existsSync,
): string | null {
  if (platform !== 'linux') return null;
  return [`/usr/bin/${name}`, `/usr/local/bin/${name}`].find(fileExists) ?? null;
}

/** Some Linux static FFmpeg builds can terminate on otherwise valid camera
 * transport streams. Prefer the distribution binary there when present; it
 * is linked and tested against the host codec stack. Packaged builds still
 * retain the bundled static binary as their offline fallback. */
export function systemFfmpegBinary(
  platform: NodeJS.Platform = process.platform,
  fileExists: Exists = existsSync,
): string | null {
  return systemMediaBinary('ffmpeg', platform, fileExists);
}

/** Linux static FFprobe builds can terminate on valid transport streams. A
 * distribution FFprobe is ABI-compatible with its own codec stack and is the
 * safer first choice when installed; the bundled static binary remains the
 * standalone fallback. */
export function systemFfprobeBinary(
  platform: NodeJS.Platform = process.platform,
  fileExists: Exists = existsSync,
): string | null {
  return systemMediaBinary('ffprobe', platform, fileExists);
}

export function ffmpegCandidates(): string[] {
  const candidates = [
    process.env.YOLOCUT_FFMPEG,
    codecPackBinary('ffmpeg'),
    process.env.FFMPEG_PATH,
    systemFfmpegBinary(),
    ffmpegStatic,
    'ffmpeg',
  ];
  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
}

export function ffprobeCandidates(): string[] {
  const candidates = [
    process.env.YOLOCUT_FFPROBE,
    process.env.FFPROBE_PATH,
    siblingFfprobe(ffmpegBin()),
    codecPackBinary('ffprobe'),
    systemFfprobeBinary(),
    ffprobeStatic,
    'ffprobe',
  ];
  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
}

export async function runFfprobeFallback<T>(
  runner: (command: string) => Promise<T>,
): Promise<{ command: string; value: T }> {
  let firstError: unknown;
  for (const command of ffprobeCandidates()) {
    try {
      return { command, value: await runner(command) };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      firstError ??= error;
    }
  }
  throw firstError ?? new Error('no FFprobe binary is available');
}

export async function runFfmpegFallback<T>(
  runner: (command: string) => Promise<T>,
): Promise<{ command: string; value: T }> {
  let firstError: unknown;
  for (const command of ffmpegCandidates()) {
    try {
      return { command, value: await runner(command) };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      firstError ??= error;
    }
  }
  throw firstError ?? new Error('no FFmpeg binary is available');
}

/**
 * Prefer explicit overrides for developers who need a custom FFmpeg build.
 * Packaged desktop builds fall back to the platform binaries shipped through
 * production dependencies, so media import does not depend on the user's PATH.
 */
export function ffmpegBin(): string {
  return ffmpegCandidates()[0] ?? 'ffmpeg';
}

export function ffprobeBin(): string {
  return ffprobeCandidates()[0] ?? 'ffprobe';
}

/**
 * whisper.cpp CLI used by the desktop native-ASR worker (Metal/CPU). Dev and
 * packaged builds resolve from public/whisper-cli/<platform>/ (provisioned by
 * scripts/sync-whisper-cli.mjs and shipped through extraResources); an
 * explicit override wins for locally compiled binaries.
 */
export function whisperCliBin(): string {
  const override = process.env.YOLOCUT_WHISPER_CLI;
  if (override) return override;
  const platformKey = `${process.platform}-${process.arch}`;
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const relative = join('whisper-cli', platformKey, `whisper-cli${suffix}`);
  const candidates = [
    join(import.meta.dirname, '..', 'public', relative),
    join(process.resourcesPath ?? '', 'dist', relative),
    join(process.resourcesPath ?? '', relative),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return join(candidates[0]!);
}
