import { ffprobeBin } from './media-binaries.ts';
import { spawnMediaProcess } from './media-process.ts';

const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const MAX_PROBE_OUTPUT = 256 * 1024;

export interface MediaProbeInfo {
  readonly durationSeconds: number;
  readonly video?: {
    readonly codec: string;
    readonly width?: number;
    readonly height?: number;
  };
}

export interface MediaProbeOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly errorLabel?: string;
  readonly allowMissingDuration?: boolean;
}

function abortError(label: string): Error {
  const error = new Error(`${label} probe cancelled`);
  error.name = 'AbortError';
  return error;
}

export function probeMediaInfo(
  file: string,
  options: MediaProbeOptions = {},
): Promise<MediaProbeInfo> {
  const label = options.errorLabel?.trim() || 'media';
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError(label));
      return;
    }
    const child = spawnMediaProcess(ffprobeBin(), [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,duration',
      '-of', 'json', file,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (error?: Error, result?: MediaProbeInfo) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(result!);
    };
    const onAbort = () => child.kill('SIGKILL');
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_PROBE_OUTPUT) stdout += String(chunk).slice(0, MAX_PROBE_OUTPUT - stdout.length);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + String(chunk)).slice(-8_000);
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      if (options.signal?.aborted) {
        finish(abortError(label));
        return;
      }
      if (timedOut) {
        finish(new Error(`${label} probe timed out`));
        return;
      }
      if (code !== 0) {
        finish(new Error(`unable to probe ${label}: ${stderr.trim() || `ffprobe exited ${code}`}`));
        return;
      }
      try {
        const payload = JSON.parse(stdout) as {
          format?: { duration?: string };
          streams?: Array<{
            codec_type?: string;
            codec_name?: string;
            width?: number;
            height?: number;
            duration?: string;
          }>;
        };
        const durationSeconds = [payload.format?.duration, ...(payload.streams ?? []).map((stream) => stream.duration)]
          .map(Number)
          .filter((duration) => Number.isFinite(duration) && duration > 0)
          .reduce((longest, duration) => Math.max(longest, duration), 0);
        if ((!Number.isFinite(durationSeconds) || durationSeconds <= 0) && !options.allowMissingDuration) {
          finish(new Error(`unable to probe ${label}: invalid duration`));
          return;
        }
        const stream = payload.streams?.find((entry) => entry.codec_type === 'video');
        finish(undefined, {
          durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0,
          ...(stream ? {
            video: {
              codec: stream.codec_name?.toLowerCase() ?? '',
              ...(Number.isFinite(stream.width) && Number(stream.width) > 0 ? { width: Number(stream.width) } : {}),
              ...(Number.isFinite(stream.height) && Number(stream.height) > 0 ? { height: Number(stream.height) } : {}),
            },
          } : {}),
        });
      } catch (error) {
        finish(new Error(`unable to probe ${label}: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

export async function probeMediaDurationSeconds(
  file: string,
  options: MediaProbeOptions = {},
): Promise<number> {
  return (await probeMediaInfo(file, options)).durationSeconds;
}

export async function probeVideoInfo(
  file: string,
  options: MediaProbeOptions = {},
): Promise<MediaProbeInfo & { video: NonNullable<MediaProbeInfo['video']> }> {
  const info = await probeMediaInfo(file, options);
  if (!info.video) throw new Error(`unable to probe ${options.errorLabel?.trim() || 'video'}: no video stream`);
  return info as MediaProbeInfo & { video: NonNullable<MediaProbeInfo['video']> };
}
