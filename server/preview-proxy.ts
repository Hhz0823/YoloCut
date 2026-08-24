import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { ffmpegCandidates, runFfmpegFallback, runFfprobeFallback } from './media-binaries.ts';
import {
  h264EncodingArgs,
  h264FilterChain,
  h264GlobalArgs,
  type H264EncoderProfile,
} from './media-acceleration.ts';
import {
  estimatePreviewProxyBytes,
  resolveMediaPerformanceProfile,
  type MediaPerformanceProfile,
} from './media-performance-profile.ts';
import { mediaProcessArgs, spawnMediaProcess, type MediaToolKind } from './media-process.ts';
import { thirdPartyDecoderFallbacks } from './media-decoder-fallback.ts';

const PROBE_TIMEOUT_MS = 60_000;
const MIN_PROXY_TIMEOUT_MS = 30 * 60_000;
const MAX_PROXY_TIMEOUT_MS = 12 * 60 * 60_000;
const GOP_SAMPLE_SECONDS = 12;
const LONG_GOP_SECONDS = 4;
const FAILED_RETRY_MS = 5 * 60_000;
const MAX_CAPTURE_CHARS = 128 * 1024;
const DIRECT_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const DIRECT_PREVIEW_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm']);
const CACHE_KEY = /^[a-z0-9_-]{1,128}$/;
const PREVIEW_PRESSURE_LEVELS = [1, 2, 4, 8, 16, 32, 64, 128] as const;

export interface PreviewSourceProbe {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  container: string;
  extension: string;
  profile: string;
  pixelFormat: string;
  bitDepth: number;
  hasAlpha: boolean;
  bitrate: number;
  longGop: boolean;
  unstableCodec: boolean;
}

export interface PreviewProcessOutput { stdout: string; stderr: string }

export interface PreviewProxyBuildOutcome {
  readonly attempt: PreviewProxyBuildAttempt['id'];
  readonly encoder: H264EncoderProfile;
  readonly decoder: string;
  readonly zeroCopy: boolean;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly fallbackReasons: readonly string[];
}

export interface PreviewProxyBuildAttempt {
  readonly id:
    | 'nvidia-zero-copy'
    | 'hardware-decode-encode'
    | 'hardware-encode'
    | 'third-party-decode-hardware-encode'
    | 'software'
    | 'third-party-software';
  readonly args: readonly string[];
  readonly encoder: H264EncoderProfile;
  readonly decoder: string;
  readonly zeroCopy: boolean;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}

export function normalizePreviewPressure(value: unknown): number {
  const requested = Math.max(1, Math.min(128, Math.ceil(Number(value) || 1)));
  return PREVIEW_PRESSURE_LEVELS.find((level) => level >= requested) ?? 128;
}

/**
 * Reduce each proxy's decoded-pixel footprint when many video layers overlap.
 * Export still reads masters; this only changes the profile-specific preview
 * derivative. A 360p floor keeps text and framing readable on dense timelines.
 */
export function resolvePressureAdjustedProfile(
  profile: MediaPerformanceProfile,
  rawPressure: unknown,
): MediaPerformanceProfile {
  const pressure = normalizePreviewPressure(rawPressure);
  const decoderBudget = profile.budgets.previewDecoderBudget;
  if (pressure <= decoderBudget) return profile;
  const scale = Math.min(1, Math.sqrt(decoderBudget / pressure));
  const minHeight = Math.min(360, profile.proxy.maxHeight);
  const maxHeight = Math.max(minHeight, Math.floor(profile.proxy.maxHeight * scale / 2) * 2);
  const maxWidth = Math.max(2, Math.floor(maxHeight * profile.proxy.maxWidth / profile.proxy.maxHeight / 2) * 2);
  const maxFps = pressure >= decoderBudget * 4
    ? Math.min(15, profile.proxy.maxFps)
    : pressure >= decoderBudget * 2
      ? Math.min(24, profile.proxy.maxFps)
      : profile.proxy.maxFps;
  const pixelRatio = (maxWidth * maxHeight) / (profile.proxy.maxWidth * profile.proxy.maxHeight);
  const fpsRatio = maxFps / profile.proxy.maxFps;
  const videoBitrate = Math.max(
    750_000,
    Math.round(profile.proxy.videoBitrate * Math.max(0.18, pixelRatio * fpsRatio) / 50_000) * 50_000,
  );
  const proxy = {
    ...profile.proxy,
    maxWidth,
    maxHeight,
    maxFps,
    videoBitrate,
    audioBitrate: pressure >= 8 ? Math.min(96_000, profile.proxy.audioBitrate) : profile.proxy.audioBitrate,
  };
  return {
    ...profile,
    reason: `${profile.reason} 当前时间线约 ${pressure} 路视频并发，预览代理降至 ${maxHeight}p。`,
    proxy,
    cacheKey: `${profile.cacheKey}-p${pressure}-${maxHeight}p${maxFps}`,
  };
}

function abortError(): Error {
  const error = new Error('derivative request cancelled');
  error.name = 'AbortError';
  return error;
}

function appendBounded(value: string, chunk: Buffer): string {
  const next = value + String(chunk);
  return next.length <= MAX_CAPTURE_CHARS ? next : next.slice(-MAX_CAPTURE_CHARS / 2);
}

export function runPreviewProcess(
  command: string,
  args: readonly string[],
  signal: AbortSignal,
  timeoutMs: number,
  kind: MediaToolKind = 'ffmpeg',
): Promise<PreviewProcessOutput> {
  return new Promise((resolve, reject) => {
    const child = spawnMediaProcess(command, mediaProcessArgs(kind, args), { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const abort = () => child.kill('SIGKILL');
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', (chunk: Buffer) => { stdout = appendBounded(stdout, chunk); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = appendBounded(stderr, chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code, childSignal) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(abortError());
      else if (timedOut) reject(new Error(`${command} timed out`));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(
        `${command} exit ${code ?? `signal ${childSignal ?? 'unknown'}`}: ${stderr.slice(-500)}`,
      ));
    });
  });
}

function parseRate(value: unknown): number {
  const match = String(value ?? '').match(/^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/);
  if (!match) return 0;
  const numerator = Number(match[1]);
  const denominator = Number(match[2] ?? 1);
  const rate = denominator > 0 ? numerator / denominator : 0;
  return Number.isFinite(rate) && rate > 0 && rate <= 240 ? rate : 0;
}

export function previewPixelFormatBitDepth(pixelFormat: string, rawBits?: string): number {
  const explicit = Number(rawBits);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const normalized = pixelFormat.trim().toLowerCase();
  const match = /(9|10|12|14|16)(?=(?:le|be)?$)/.exec(normalized);
  return match ? Number(match[1]) : 8;
}

export function previewPixelFormatHasAlpha(pixelFormat: string): boolean {
  const normalized = pixelFormat.trim().toLowerCase();
  return /^(?:yuva|gbrap|rgba|bgra|argb|abgr|ayuv|ya\d|pal8$)/.test(normalized);
}

function parseLongGop(frames: Array<{ best_effort_timestamp_time?: string }> | undefined, durationMs: number): boolean {
  if (durationMs <= LONG_GOP_SECONDS * 2000) return false;
  const sampleEnd = Math.min(GOP_SAMPLE_SECONDS, durationMs / 1000);
  const times = (frames ?? [])
    .map((frame) => Number(frame.best_effort_timestamp_time))
    .filter((time) => Number.isFinite(time) && time >= 0 && time <= sampleEnd)
    .sort((a, b) => a - b);
  if (!times.length) return true;
  let previous = 0;
  let largestGap = times[0];
  for (const time of times) {
    largestGap = Math.max(largestGap, time - previous);
    previous = time;
  }
  return Math.max(largestGap, sampleEnd - previous) > LONG_GOP_SECONDS;
}

export async function probePreviewSource(file: string, signal: AbortSignal): Promise<PreviewSourceProbe> {
  const probeArgs = [
    '-v', 'error', '-select_streams', 'v:0', '-show_streams', '-show_format',
    '-show_entries', 'format=duration,bit_rate,format_name:stream=codec_name,profile,pix_fmt,bits_per_raw_sample,width,height,avg_frame_rate,r_frame_rate,bit_rate:stream_tags=alpha_mode',
    '-of', 'json', file,
  ];
  const selectedProbe = await runFfprobeFallback((command) => (
    runPreviewProcess(command, probeArgs, signal, PROBE_TIMEOUT_MS, 'ffprobe')
  ));
  const ffprobe = selectedProbe.command;
  const { stdout } = selectedProbe.value;
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; bit_rate?: string; format_name?: string };
    streams?: Array<{
      codec_name?: string;
      profile?: string;
      pix_fmt?: string;
      bits_per_raw_sample?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      bit_rate?: string;
      tags?: { alpha_mode?: string };
    }>;
  };
  const stream = parsed.streams?.[0];
  const durationMs = Math.max(0, Math.round(Number(parsed.format?.duration ?? 0) * 1000));
  const codec = stream?.codec_name?.toLowerCase() ?? '';
  const pixelFormat = stream?.pix_fmt?.toLowerCase() ?? '';
  const bitDepth = previewPixelFormatBitDepth(pixelFormat, stream?.bits_per_raw_sample);
  const bitrate = Math.max(0, Math.round(Number(stream?.bit_rate ?? parsed.format?.bit_rate ?? 0)) || 0);
  let keyframes: Array<{ best_effort_timestamp_time?: string }> | undefined;
  if (durationMs > LONG_GOP_SECONDS * 2000) {
    try {
      const sample = await runPreviewProcess(ffprobe, [
        '-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey',
        '-read_intervals', `%+${GOP_SAMPLE_SECONDS}`, '-show_frames',
        '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', file,
      ], signal, PROBE_TIMEOUT_MS, 'ffprobe');
      keyframes = (JSON.parse(sample.stdout) as {
        frames?: Array<{ best_effort_timestamp_time?: string }>;
      }).frames;
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      // Stream metadata is still valid. Missing keyframe evidence is treated as
      // long-GOP below, which safely selects a compatibility proxy instead of
      // failing import when an older platform ffprobe crashes on frame scans.
      keyframes = undefined;
    }
  }
  return {
    durationMs,
    width: stream?.width ?? 0,
    height: stream?.height ?? 0,
    fps: parseRate(stream?.avg_frame_rate) || parseRate(stream?.r_frame_rate),
    codec,
    container: parsed.format?.format_name ?? '',
    extension: extname(file).toLowerCase(),
    profile: stream?.profile ?? '',
    pixelFormat,
    bitDepth,
    hasAlpha: stream?.tags?.alpha_mode === '1' || previewPixelFormatHasAlpha(pixelFormat),
    bitrate,
    longGop: parseLongGop(keyframes, durationMs),
    unstableCodec: !DIRECT_CODECS.has(codec),
  };
}

export function previewProxyReason(
  probe: PreviewSourceProbe,
  force: boolean,
  profile: MediaPerformanceProfile,
): string | null {
  if (force) return 'direct-preview-failed';
  if (!DIRECT_PREVIEW_EXTENSIONS.has(probe.extension)) return 'portable-container-proxy';
  if (probe.width > profile.proxy.maxWidth || probe.height > profile.proxy.maxHeight) return 'adaptive-resolution';
  if (probe.fps > profile.proxy.maxFps + 0.01) return 'high-frame-rate';
  if (probe.bitrate > Math.max(6_000_000, profile.proxy.videoBitrate * 3)) return 'high-bitrate';
  if (probe.longGop) return 'long-gop';
  if (probe.codec === 'av1') return 'portable-av1-decoder';
  if (probe.codec === 'h264') {
    const riskyProfile = /(?:high\s*10|high\s*4:2:2|high\s*4:4:4)/i.test(probe.profile);
    const riskyPixelFormat = !!probe.pixelFormat
      && !['yuv420p', 'yuvj420p', 'nv12'].includes(probe.pixelFormat);
    if (probe.bitDepth > 8 || riskyProfile || riskyPixelFormat) return 'browser-h264-profile';
  }
  if (probe.codec === 'vp9' && !probe.hasAlpha) {
    const riskyPixelFormat = !!probe.pixelFormat
      && !['yuv420p', 'yuvj420p'].includes(probe.pixelFormat);
    if (probe.bitDepth > 8 || riskyPixelFormat) return 'browser-vp9-profile';
  }
  if (probe.unstableCodec) return 'unstable-codec';
  return null;
}

export function resolvePreviewProxyDimensions(
  probe: Pick<PreviewSourceProbe, 'width' | 'height'>,
  profile: MediaPerformanceProfile,
): { width: number; height: number } {
  if (!(probe.width > 0) || !(probe.height > 0)) return { width: profile.proxy.maxWidth, height: profile.proxy.maxHeight };
  const scale = Math.min(1, profile.proxy.maxWidth / probe.width, profile.proxy.maxHeight / probe.height);
  return {
    width: Math.max(2, Math.floor(probe.width * scale / 2) * 2),
    height: Math.max(2, Math.floor(probe.height * scale / 2) * 2),
  };
}

function hardwareTuning(encoder: H264EncoderProfile['id']): string[] {
  if (encoder === 'h264_nvenc') return ['-preset', 'p1', '-tune', 'll'];
  if (encoder === 'h264_videotoolbox') return ['-realtime', '1'];
  return [];
}

function outputArgs(
  encoder: H264EncoderProfile,
  profile: MediaPerformanceProfile,
  fps: number,
  zeroCopy: boolean,
): string[] {
  const bitrate = profile.proxy.videoBitrate;
  const encodedWithPixelFormat = h264EncodingArgs({
    encoder: encoder.id,
    targetBitrate: bitrate,
    maxBitrate: Math.round(bitrate * 1.5),
    bufferSize: bitrate * 3,
    softwarePreset: profile.proxy.softwarePreset,
  });
  // CUDA frames already carry their hardware pixel format. Forcing the
  // software `yuv420p` pixel format makes FFmpeg auto-insert a CPU scale filter
  // after scale_cuda, breaking the zero-copy graph.
  const pixelFormatIndex = encodedWithPixelFormat.indexOf('-pix_fmt');
  const encoded = zeroCopy && pixelFormatIndex >= 0
    ? encodedWithPixelFormat.filter((_value, index) => index !== pixelFormatIndex && index !== pixelFormatIndex + 1)
    : encodedWithPixelFormat;
  const gop = Math.max(1, Math.round(fps / 2));
  return [
    ...encoded,
    ...hardwareTuning(encoder.id),
    '-profile:v', 'high', '-g', String(gop), '-bf', '0',
    '-r', String(Number(fps.toFixed(3))), '-fps_mode', 'cfr',
    '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', String(profile.proxy.audioBitrate), '-ac', '2',
  ];
}

function attemptArgs({
  file,
  output,
  inputAcceleration,
  inputDecoder,
  filter,
  encoder,
  profile,
  fps,
  zeroCopy = false,
}: {
  file: string;
  output: string;
  inputAcceleration: readonly string[];
  inputDecoder?: string;
  filter: string;
  encoder: H264EncoderProfile;
  profile: MediaPerformanceProfile;
  fps: number;
  zeroCopy?: boolean;
}): string[] {
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    ...h264GlobalArgs(encoder.id),
    ...inputAcceleration, ...(inputDecoder ? ['-c:v', inputDecoder] : []), '-i', file,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-map_metadata', '-1',
    '-vf', filter,
    ...outputArgs(encoder, profile, fps, zeroCopy),
    '-avoid_negative_ts', 'make_zero', output,
  ];
}

export function previewProxyBuildAttempts(
  file: string,
  output: string,
  probe: PreviewSourceProbe,
  profile: MediaPerformanceProfile,
): readonly PreviewProxyBuildAttempt[] {
  const { width, height } = resolvePreviewProxyDimensions(probe, profile);
  const fps = Math.max(1, Math.min(probe.fps || profile.proxy.maxFps, profile.proxy.maxFps));
  const encoder = profile.ffmpeg.encoder;
  const software: H264EncoderProfile = {
    id: 'libx264', label: 'Software (libx264)', hardware: false, transport: 'server',
  };
  const cpuFilter = `scale=${width}:${height}:flags=fast_bilinear`;
  const thirdPartyDecoders = thirdPartyDecoderFallbacks(
    probe.codec,
    profile.ffmpeg.thirdPartyDecoders,
  );
  const attempts: PreviewProxyBuildAttempt[] = [];
  if (encoder.id === 'h264_nvenc' && profile.ffmpeg.decoder.zeroCopy) {
    attempts.push({
      id: 'nvidia-zero-copy', encoder, decoder: 'cuda', zeroCopy: true, width, height, fps,
      args: attemptArgs({
        file, output, profile, encoder, fps, zeroCopy: true,
        inputAcceleration: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
        filter: `scale_cuda=${width}:${height}:interp_algo=bilinear`,
      }),
    });
  }
  if (encoder.hardware && profile.ffmpeg.decoder.hardware) {
    attempts.push({
      id: 'hardware-decode-encode', encoder, decoder: profile.ffmpeg.decoder.id,
      zeroCopy: false, width, height, fps,
      args: attemptArgs({
        file, output, profile, encoder, fps,
        inputAcceleration: ['-hwaccel', profile.ffmpeg.decoder.id],
        filter: h264FilterChain(encoder.id, [cpuFilter]),
      }),
    });
  }
  if (encoder.hardware) {
    attempts.push({
      id: 'hardware-encode', encoder, decoder: 'software', zeroCopy: false, width, height, fps,
      args: attemptArgs({
        file, output, profile, encoder, fps, inputAcceleration: [],
        filter: h264FilterChain(encoder.id, [cpuFilter]),
      }),
    });
    for (const decoder of thirdPartyDecoders) {
      attempts.push({
        id: 'third-party-decode-hardware-encode', encoder, decoder,
        zeroCopy: false, width, height, fps,
        args: attemptArgs({
          file, output, profile, encoder, fps, inputAcceleration: [], inputDecoder: decoder,
          filter: h264FilterChain(encoder.id, [cpuFilter]),
        }),
      });
    }
  }
  attempts.push({
    id: 'software', encoder: software, decoder: 'software', zeroCopy: false, width, height, fps,
    args: attemptArgs({
      file, output, profile, encoder: software, fps, inputAcceleration: [], filter: cpuFilter,
    }),
  });
  for (const decoder of thirdPartyDecoders) {
    attempts.push({
      id: 'third-party-software', encoder: software, decoder,
      zeroCopy: false, width, height, fps,
      args: attemptArgs({
        file, output, profile, encoder: software, fps, inputAcceleration: [], inputDecoder: decoder,
        filter: cpuFilter,
      }),
    });
  }
  return attempts;
}

export function previewProxyTimeoutMs(durationMs: number, hardware: boolean): number {
  const multiplier = hardware ? 2 : 6;
  return Math.min(MAX_PROXY_TIMEOUT_MS, Math.max(MIN_PROXY_TIMEOUT_MS, Math.ceil(durationMs * multiplier)));
}

export async function buildPreviewProxy(
  file: string,
  output: string,
  signal: AbortSignal,
  probe: PreviewSourceProbe,
  profile: MediaPerformanceProfile,
): Promise<PreviewProxyBuildOutcome> {
  const attempts = previewProxyBuildAttempts(file, output, probe, profile);
  const fallbackReasons: string[] = [];
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      await unlink(output).catch(() => {});
      await runFfmpegFallback((command) => runPreviewProcess(
        command,
        attempt.args,
        signal,
        previewProxyTimeoutMs(probe.durationMs, attempt.encoder.hardware),
      ));
      return {
        attempt: attempt.id,
        encoder: attempt.encoder,
        decoder: attempt.decoder,
        zeroCopy: attempt.zeroCopy,
        width: attempt.width,
        height: attempt.height,
        fps: attempt.fps,
        fallbackReasons,
      };
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      lastError = error;
      fallbackReasons.push(`${attempt.id}:${attempt.decoder}: unavailable`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('preview proxy generation failed');
}

interface PreviewHit {
  name: string;
  file: string;
  source: { size: number; mtimeMs: number };
}

interface PreviewProxyDependencies {
  resolve: (req: IncomingMessage, res: ServerResponse) => Promise<PreviewHit | null>;
  cachePath: (name: string, source: PreviewHit['source'], kind: string, ext: string) => string;
  atomicBuild: (path: string, build: (tmp: string) => Promise<void>) => Promise<void>;
  runDerivative: <T>(
    req: IncomingMessage,
    res: ServerResponse,
    key: string,
    work: (signal: AbortSignal) => Promise<T>,
    protectedPath?: string,
  ) => Promise<T>;
  cacheBudgetBytes: () => Promise<number>;
  serveCached: (req: IncomingMessage, res: ServerResponse, path: string) => Promise<void>;
  sendJson: (res: ServerResponse, status: number, body: unknown) => void;
  handleError: (res: ServerResponse, label: string, error: unknown) => void;
  logError: (message: string) => void;
}

export type PreviewProxyPayload = {
  source: Omit<PreviewSourceProbe, 'unstableCodec'> & { src: string };
  performance: MediaPerformanceProfile;
  proxy:
    | { status: 'not-needed'; reason: string }
    | { status: 'ready'; reason: string; previewSrc: string; acceleration?: PreviewProxyBuildOutcome }
    | { status: 'failed'; reason: string; error: string };
};

function sourcePayload(src: string, probe: PreviewSourceProbe): PreviewProxyPayload['source'] {
  return {
    src,
    durationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    codec: probe.codec,
    container: probe.container,
    extension: probe.extension,
    profile: probe.profile,
    pixelFormat: probe.pixelFormat,
    bitDepth: probe.bitDepth,
    hasAlpha: probe.hasAlpha,
    bitrate: probe.bitrate,
    longGop: probe.longGop,
  };
}

async function previousFailure(path: string): Promise<{ reason: string; error: string } | null> {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { reason?: unknown; error?: unknown; failedAt?: unknown };
    if (typeof value.failedAt !== 'number' || Date.now() - value.failedAt > FAILED_RETRY_MS) {
      await unlink(path).catch(() => {});
      return null;
    }
    return typeof value.reason === 'string' && typeof value.error === 'string'
      ? { reason: value.reason, error: value.error }
      : null;
  } catch {
    return null;
  }
}

async function readBuildOutcome(path: string): Promise<PreviewProxyBuildOutcome | null> {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<PreviewProxyBuildOutcome>;
    return typeof value.attempt === 'string'
      && typeof value.encoder?.id === 'string'
      && typeof value.decoder === 'string'
      && typeof value.zeroCopy === 'boolean'
      && Number.isFinite(value.width) && Number.isFinite(value.height) && Number.isFinite(value.fps)
      && Array.isArray(value.fallbackReasons) && value.fallbackReasons.every((reason) => typeof reason === 'string')
      ? value as PreviewProxyBuildOutcome
      : null;
  } catch {
    return null;
  }
}

function publicProxyError(error: unknown, sourcePath: string, outputPath: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const sanitized = ffmpegCandidates().reduce(
    (message, command) => command === 'ffmpeg' ? message : message.replaceAll(command, '<ffmpeg>'),
    raw,
  );
  return sanitized
    .replaceAll(sourcePath, '<source>')
    .replaceAll(outputPath, '<proxy>')
    .slice(-1_000);
}

async function createProxyPayload(
  hit: PreviewHit,
  src: string,
  force: boolean,
  profile: MediaPerformanceProfile,
  proxyPath: string,
  metaPath: string,
  statusPath: string,
  deps: PreviewProxyDependencies,
  signal: AbortSignal,
): Promise<PreviewProxyPayload> {
  const probe = await probePreviewSource(hit.file, signal);
  const source = sourcePayload(src, probe);
  const reason = previewProxyReason(probe, force, profile);
  if (!reason) return { source, performance: profile, proxy: { status: 'not-needed', reason: 'source-compatible' } };
  const query = new URLSearchParams({ src, profile: profile.cacheKey }).toString();
  const previewSrc = `/api/preview-proxy-file?${query}`;
  if (existsSync(proxyPath)) {
    const acceleration = await readBuildOutcome(metaPath);
    return {
      source,
      performance: profile,
      proxy: { status: 'ready', reason, previewSrc, ...(acceleration ? { acceleration } : {}) },
    };
  }
  const failed = force ? null : await previousFailure(statusPath);
  if (failed) return { source, performance: profile, proxy: { status: 'failed', ...failed } };
  const estimate = estimatePreviewProxyBytes(probe.durationMs, profile.proxy);
  const budget = await deps.cacheBudgetBytes();
  if (estimate > budget) {
    return {
      source,
      performance: profile,
      proxy: {
        status: 'failed',
        reason: 'insufficient-proxy-cache-budget',
        error: `预计代理需要 ${(estimate / 1024 ** 3).toFixed(1)} GB，可用代理预算 ${(budget / 1024 ** 3).toFixed(1)} GB`,
      },
    };
  }
  try {
    let acceleration: PreviewProxyBuildOutcome | null = null;
    await deps.atomicBuild(proxyPath, async (tmp) => {
      acceleration = await buildPreviewProxy(hit.file, tmp, signal, probe, profile);
    });
    if (!acceleration) throw new Error('preview proxy completed without an acceleration audit');
    const resolved: PreviewProxyBuildOutcome = acceleration;
    await deps.atomicBuild(metaPath, (tmp) => writeFile(tmp, JSON.stringify(resolved))).catch(() => {});
    await unlink(statusPath).catch(() => {});
    return { source, performance: profile, proxy: { status: 'ready', reason, previewSrc, acceleration: resolved } };
  } catch (error) {
    if (signal.aborted) throw error;
    const message = publicProxyError(error, hit.file, proxyPath);
    await deps.atomicBuild(statusPath, (tmp) => writeFile(tmp, JSON.stringify({ reason, error: message, failedAt: Date.now() })));
    deps.logError(`[preview-proxy] ${message}`);
    return { source, performance: profile, proxy: { status: 'failed', reason, error: message } };
  }
}

export async function handlePreviewProxy(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PreviewProxyDependencies,
): Promise<void> {
  try {
    const hit = await deps.resolve(req, res);
    if (!hit) return;
    const url = new URL(req.url ?? '/', 'http://localhost');
    const src = url.searchParams.get('src') ?? '';
    const force = url.searchParams.get('force') === '1';
    const pressure = normalizePreviewPressure(url.searchParams.get('pressure'));
    const profile = resolvePressureAdjustedProfile(await resolveMediaPerformanceProfile(), pressure);
    const kind = `proxy-${profile.cacheKey}`;
    const proxyPath = deps.cachePath(hit.name, hit.source, kind, 'mp4');
    const metaPath = deps.cachePath(hit.name, hit.source, `${kind}-meta`, 'json');
    const statusPath = deps.cachePath(hit.name, hit.source, `${kind}-status`, 'json');
    const payload = await deps.runDerivative(req, res, proxyPath, (signal) => (
      createProxyPayload(hit, src, force, profile, proxyPath, metaPath, statusPath, deps, signal)
    ));
    if (!res.destroyed) deps.sendJson(res, 200, payload);
  } catch (error) {
    deps.handleError(res, 'preview-proxy', error);
  }
}

export async function handlePreviewProxyFile(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PreviewProxyDependencies,
): Promise<void> {
  try {
    const hit = await deps.resolve(req, res);
    if (!hit) return;
    const url = new URL(req.url ?? '/', 'http://localhost');
    const requested = url.searchParams.get('profile') ?? '';
    const cacheKey = CACHE_KEY.test(requested) ? requested : (await resolveMediaPerformanceProfile()).cacheKey;
    const proxyPath = deps.cachePath(hit.name, hit.source, `proxy-${cacheKey}`, 'mp4');
    if (!existsSync(proxyPath)) {
      deps.sendJson(res, 404, { error: 'preview proxy is not ready' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    await deps.serveCached(req, res, proxyPath);
  } catch (error) {
    deps.handleError(res, 'preview-proxy-file', error);
  }
}
