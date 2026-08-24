import { dirname } from 'node:path';
import { spawnMediaProcess } from './media-process.ts';

const MAX_DECODER_OUTPUT = 2 * 1024 * 1024;
const DECODER_PROBE_TIMEOUT_MS = 10_000;

export type VideoDecodeAttemptKind = 'hardware' | 'software' | 'third-party';

export interface VideoDecodeAttempt {
  readonly kind: VideoDecodeAttemptKind;
  readonly decoder: string;
  readonly inputArgs: readonly string[];
}

export interface VideoDecodeFallbackRunOptions {
  readonly signal?: AbortSignal;
  readonly cleanup?: (attempt: VideoDecodeAttempt, error: unknown) => void | Promise<void>;
  readonly onFailure?: (attempt: VideoDecodeAttempt, error: unknown) => void;
}

const THIRD_PARTY_DECODERS: Readonly<Record<string, readonly string[]>> = {
  av1: ['libdav1d', 'libaom-av1'],
  vp9: ['libvpx-vp9'],
  vp8: ['libvpx'],
  avs2: ['libdavs2'],
  avs3: ['libuavs3d'],
  evc: ['libxevd'],
  jpeg2000: ['libopenjpeg'],
};

const decoderCatalogCache = new Map<string, Promise<ReadonlySet<string>>>();

function canonicalCodec(codec: string): string {
  const value = codec.trim().toLowerCase();
  if (value === 'av01') return 'av1';
  if (value === 'vp09') return 'vp9';
  if (value === 'h265' || value === 'hev1' || value === 'hvc1') return 'hevc';
  if (value === 'avc' || value === 'avc1') return 'h264';
  return value;
}

export function parseVideoDecoderNames(output: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*V[.A-Z]{5}\s+([^\s]+)/.exec(line);
    if (match?.[1]) names.add(match[1]);
  }
  return names;
}

function probeDecoderCatalog(ffmpeg: string): Promise<ReadonlySet<string>> {
  return new Promise((resolve) => {
    const child = spawnMediaProcess(ffmpeg, ['-hide_banner', '-decoders'], {
      cwd: dirname(ffmpeg),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk: Buffer) => {
      if (output.length < MAX_DECODER_OUTPUT) output += String(chunk).slice(0, MAX_DECODER_OUTPUT - output.length);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGKILL'), DECODER_PROBE_TIMEOUT_MS);
    let settled = false;
    const finish = (names: ReadonlySet<string>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(names);
    };
    child.once('error', () => finish(new Set()));
    child.once('close', (code) => finish(code === 0 ? parseVideoDecoderNames(output) : new Set()));
  });
}

export function resolveVideoDecoderCatalog(ffmpeg: string): Promise<ReadonlySet<string>> {
  const cached = decoderCatalogCache.get(ffmpeg);
  if (cached) return cached;
  const probing = probeDecoderCatalog(ffmpeg);
  decoderCatalogCache.set(ffmpeg, probing);
  return probing;
}

export function thirdPartyDecoderFallbacks(
  codec: string,
  availableDecoders: ReadonlySet<string> | readonly string[],
): string[] {
  const available = availableDecoders instanceof Set
    ? availableDecoders
    : new Set(availableDecoders);
  return [...(THIRD_PARTY_DECODERS[canonicalCodec(codec)] ?? [])]
    .filter((decoder) => available.has(decoder));
}

export async function resolveThirdPartyVideoDecoders(ffmpeg: string): Promise<string[]> {
  const available = await resolveVideoDecoderCatalog(ffmpeg);
  return [...new Set(Object.values(THIRD_PARTY_DECODERS).flat())]
    .filter((decoder) => available.has(decoder));
}

/** Ordered input options shared by import normalization and preview proxies.
 * Hardware failure never contaminates the software attempts. FFmpeg's native
 * auto decoder stays ahead of optional libraries; explicit third-party
 * decoders are the final compatibility layer for malformed or unusual files. */
export function videoDecodeAttempts(
  hardwareArgs: readonly string[],
  codec: string,
  availableThirdPartyDecoders: ReadonlySet<string> | readonly string[],
): VideoDecodeAttempt[] {
  const attempts: VideoDecodeAttempt[] = [];
  if (hardwareArgs.length) {
    attempts.push({
      kind: 'hardware',
      decoder: hardwareArgs[hardwareArgs.indexOf('-hwaccel') + 1] ?? 'hardware',
      inputArgs: [...hardwareArgs],
    });
  }
  attempts.push({ kind: 'software', decoder: 'auto', inputArgs: [] });
  for (const decoder of thirdPartyDecoderFallbacks(codec, availableThirdPartyDecoders)) {
    attempts.push({ kind: 'third-party', decoder, inputArgs: ['-c:v', decoder] });
  }
  return attempts;
}

/** Execute one decode-dependent operation against the shared ordered fallback
 * contract. Consumers keep ownership of their FFmpeg arguments and result
 * type, while cancellation and retry ordering stay identical everywhere. */
export async function runVideoDecodeFallback<T>(
  attempts: readonly VideoDecodeAttempt[],
  execute: (attempt: VideoDecodeAttempt) => Promise<T>,
  options: VideoDecodeFallbackRunOptions = {},
): Promise<T> {
  if (!attempts.length) throw new Error('video decoder fallback requires at least one attempt');
  let lastError: unknown;
  for (const attempt of attempts) {
    if (options.signal?.aborted) {
      const error = new Error('video decode cancelled');
      error.name = 'AbortError';
      throw error;
    }
    try {
      return await execute(attempt);
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      lastError = error;
      options.onFailure?.(attempt, error);
      await Promise.resolve(options.cleanup?.(attempt, error)).catch(() => undefined);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('all video decoder attempts failed');
}

export function __resetVideoDecoderCatalogForVerify(): void {
  decoderCatalogCache.clear();
}
