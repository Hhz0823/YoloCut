import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCAL_VOICE_UNAVAILABLE_MESSAGE } from '../../shared/local-voice.ts';
import {
  MODEL_PACKS,
  type FishS2ModelPackRuntime,
  type ModelPackDefinition,
} from '../../shared/model-packs/catalog.ts';
import { inspectModelPack, modelPackRoot } from './model-packs.ts';
import { parseLocalNvidiaGpus, probeLocalVoiceHardware } from './local-voice-hardware.ts';
import {
  generateFishS2Audio,
  inspectPcmWav,
  type FishS2GenerationInput,
  type FishS2GenerationResult,
} from './fish-s2-runtime.ts';
import type { LocalVoiceAudio, ValidVoiceRequest } from './voice-types.ts';
import type {
  NativeTtsBackend,
  NativeTtsWorkerRequest,
  NativeTtsWorkerSuccess,
} from '../../desktop/native-tts-worker.ts';

const MAX_LOCAL_TTS_TEXT = 2_000;
const MAX_SEGMENT_TOKENS = 200;
const MIN_MERGE_TOKENS = 40;
const MAX_SEGMENTS = 32;
const MAX_OUTPUT_SAMPLES = 2_880_000; // 120 seconds at 24 kHz
const WORKER_TIMEOUT_MS = 180_000;
const WORKER_IDLE_MS = 120_000;
const MAX_WORKER_OUTPUT_BYTES = 64 * 1024;

export class LocalVoiceRuntimeError extends Error {
  readonly status: number;
  /** Internal fixed code for diagnostics; never included in the HTTP response. */
  readonly diagnosticCode?: string;
  constructor(message: string, status = 400, diagnosticCode?: string) {
    super(message);
    this.name = 'LocalVoiceRuntimeError';
    this.status = status;
    this.diagnosticCode = diagnosticCode;
  }
}

/** Conservative estimate used only for natural chunking, never model indexing. */
export function estimateLocalTtsTokens(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinWords = (text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []).length;
  const digits = (text.match(/\d/g) ?? []).length;
  const punctuation = (text.match(/[^\s\u3400-\u9fffA-Za-z0-9]/g) ?? []).length;
  return cjk * 3 + latinWords * 2 + digits * 2 + punctuation;
}

function sentencePieces(text: string): string[] {
  return text.match(/[^。！？!?；;\n]+[。！？!?；;]*|[^\n]+/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
}

function hardSplit(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const character of text) {
    if (current && estimateLocalTtsTokens(current + character) > MAX_SEGMENT_TOKENS) {
      parts.push(current.trim());
      current = '';
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitOversized(text: string): string[] {
  if (estimateLocalTtsTokens(text) <= MAX_SEGMENT_TOKENS) return [text];
  const clauses = text.match(/[^，,、：:]+[，,、：:]*/g)?.map((part) => part.trim()).filter(Boolean) ?? [text];
  const result: string[] = [];
  let current = '';
  for (const clause of clauses) {
    if (estimateLocalTtsTokens(clause) > MAX_SEGMENT_TOKENS) {
      if (current) { result.push(current); current = ''; }
      result.push(...hardSplit(clause));
      continue;
    }
    const candidate = current ? `${current}${clause}` : clause;
    if (current && estimateLocalTtsTokens(candidate) > MAX_SEGMENT_TOKENS) {
      result.push(current);
      current = clause;
    } else current = candidate;
  }
  if (current) result.push(current);
  return result;
}

/** Merge very short neighboring sentences and split long clauses into 100–200-token chunks. */
export function segmentLocalTtsText(text: string): readonly string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').trim();
  if (!normalized) throw new LocalVoiceRuntimeError('text is required');
  if (normalized.length > MAX_LOCAL_TTS_TEXT) {
    throw new LocalVoiceRuntimeError(`Local TTS text must be at most ${MAX_LOCAL_TTS_TEXT} characters`);
  }
  const pieces = sentencePieces(normalized).flatMap(splitOversized);
  const merged: string[] = [];
  for (const piece of pieces) {
    const previous = merged.at(-1);
    if (previous && (estimateLocalTtsTokens(previous) < MIN_MERGE_TOKENS
      || estimateLocalTtsTokens(piece) < MIN_MERGE_TOKENS)
      && estimateLocalTtsTokens(previous + piece) <= MAX_SEGMENT_TOKENS) {
      merged[merged.length - 1] = previous + piece;
    } else merged.push(piece);
  }
  if (merged.length < 1 || merged.length > MAX_SEGMENTS) {
    throw new LocalVoiceRuntimeError(`Local TTS text requires too many segments (maximum ${MAX_SEGMENTS})`);
  }
  return merged;
}

export interface LocalWebGpuProbe {
  readonly eligible: boolean;
  readonly reason?: string;
}

export function parseEligibleNvidiaGpu(output: string): boolean {
  return parseLocalNvidiaGpus(output).some((gpu) => (
    gpu.memoryMiB >= 6_144 && gpu.computeCapability >= 7.5
  ));
}

export async function probeLocalWebGpu(): Promise<LocalWebGpuProbe> {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    return { eligible: false, reason: 'WebGPU acceleration requires Windows x64; local TTS used CPU fallback.' };
  }
  try {
    const hardware = await probeLocalVoiceHardware();
    return hardware.selectedGpu && hardware.recommendation.tier !== 'unsupported'
      ? { eligible: true }
      : { eligible: false, reason: 'No eligible NVIDIA GPU (compute capability 7.5+ and 6144 MiB VRAM); local TTS used CPU fallback.' };
  } catch {
    return { eligible: false, reason: 'GPU capability probe was unavailable; local TTS used CPU fallback.' };
  }
}

interface WorkerReplyError { readonly id: string; readonly ok: false; readonly error: string }
type WorkerReply = NativeTtsWorkerSuccess | WorkerReplyError;

interface PendingWorkerRequest {
  readonly id: string;
  readonly resolve: (value: NativeTtsWorkerSuccess) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
  readonly abort?: () => void;
}

function workerLaunch(): { executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
  const electronNode = Boolean(process.versions.electron);
  const worker = electronNode
    ? fileURLToPath(new URL('./native-tts-worker.mjs', import.meta.url))
    : resolve(process.cwd(), 'desktop', 'native-tts-worker.ts');
  if (!existsSync(worker)) throw new LocalVoiceRuntimeError('Local TTS worker is not packaged', 503);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    Path: process.env.Path,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    USERPROFILE: process.env.USERPROFILE,
    HOMEDRIVE: process.env.HOMEDRIVE,
    HOMEPATH: process.env.HOMEPATH,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    APPDATA: process.env.APPDATA,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    YOLOCUT_NATIVE_TTS_WORKER: '1',
    ...(electronNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  };
  return {
    executable: process.execPath,
    args: electronNode ? [worker] : ['--import', 'tsx', worker],
    cwd: electronNode ? dirname(worker) : process.cwd(),
    env,
  };
}

function workerFailure(code: string): LocalVoiceRuntimeError {
  if (code === 'audio_too_long') return new LocalVoiceRuntimeError('Local TTS output exceeded the 120 second limit', 400, code);
  if (code === 'token_count_out_of_range') return new LocalVoiceRuntimeError('A local TTS segment exceeded the Kokoro token limit', 400, code);
  if (code === 'unsupported_language') return new LocalVoiceRuntimeError('The selected local voice supports zh-CN only', 400, code);
  if (code === 'invalid_voices_layout' || code === 'model_pack_incomplete') {
    return new LocalVoiceRuntimeError('The installed local TTS model is damaged; reinstall the model pack', 400, code);
  }
  return new LocalVoiceRuntimeError('Local TTS inference failed; retry with CPU or reinstall the model pack', 503, code);
}

class NativeTtsWorkerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: PendingWorkerRequest | null = null;
  private stdout = '';
  private stderrBytes = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;
    const launch = workerLaunch();
    const child = spawn(launch.executable, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    this.stdout = '';
    this.stderrBytes = 0;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderrBytes += chunk.length;
      if (this.stderrBytes > MAX_WORKER_OUTPUT_BYTES) this.terminate(new Error('Local TTS worker diagnostics exceeded the safe limit'));
    });
    child.once('error', (error) => this.terminate(error));
    child.once('close', () => this.terminate(new Error('Local TTS worker stopped')));
    return child;
  }

  private onStdout(chunk: string): void {
    this.stdout += chunk;
    if (this.stdout.length > MAX_WORKER_OUTPUT_BYTES) {
      this.terminate(new Error('Local TTS worker output exceeded the safe limit'));
      return;
    }
    for (;;) {
      const newline = this.stdout.indexOf('\n');
      if (newline < 0) return;
      const line = this.stdout.slice(0, newline);
      this.stdout = this.stdout.slice(newline + 1);
      if (!line.trim()) continue;
      let reply: WorkerReply;
      try {
        reply = JSON.parse(line) as WorkerReply;
      } catch {
        this.terminate(new Error('Local TTS worker returned invalid JSON'));
        return;
      }
      const pending = this.pending;
      if (!pending || reply.id !== pending.id) {
        this.terminate(new Error('Local TTS worker returned an unexpected request id'));
        return;
      }
      this.pending = null;
      clearTimeout(pending.timer);
      if (pending.abort) pending.abort();
      if (reply.ok) pending.resolve(reply);
      else pending.reject(workerFailure(reply.error));
      this.scheduleIdle();
    }
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.terminate(), WORKER_IDLE_MS);
    this.idleTimer.unref();
  }

  run(input: NativeTtsWorkerRequest, signal?: AbortSignal): Promise<NativeTtsWorkerSuccess> {
    if (this.pending) throw new LocalVoiceRuntimeError('Another local TTS job is already running', 429);
    if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Local TTS cancelled'));
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const child = this.ensureChild();
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => this.terminate(new Error('Local TTS worker timed out')), WORKER_TIMEOUT_MS);
      const onAbort = () => this.terminate(signal?.reason instanceof Error ? signal.reason : new Error('Local TTS cancelled'));
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending = {
        id: input.id,
        resolve: resolvePromise,
        reject,
        timer,
        ...(signal ? { abort: () => signal.removeEventListener('abort', onAbort) } : {}),
      };
      child.stdin.write(`${JSON.stringify(input)}\n`, (error) => {
        if (error) this.terminate(error);
      });
    });
  }

  terminate(reason?: Error): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      if (pending.abort) pending.abort();
      pending.reject(reason ?? new Error('Local TTS worker stopped'));
    }
    const child = this.child;
    this.child = null;
    this.stdout = '';
    this.stderrBytes = 0;
    if (child && !child.killed) child.kill();
  }
}

const workerClient = new NativeTtsWorkerClient();
let activeGeneration = false;

export interface LocalVoiceRuntimeOverrides {
  readonly inspect?: (pack: ModelPackDefinition) => Promise<{ installed: boolean; error?: string }>;
  readonly root?: (pack: ModelPackDefinition) => string;
  readonly probe?: () => Promise<LocalWebGpuProbe>;
  readonly runWorker?: (input: NativeTtsWorkerRequest, signal?: AbortSignal) => Promise<NativeTtsWorkerSuccess>;
  readonly runFishS2?: (input: FishS2GenerationInput, signal?: AbortSignal) => Promise<FishS2GenerationResult>;
}

function voicePack(modelId: string): ModelPackDefinition | undefined {
  return MODEL_PACKS.find((pack) => pack.kind === 'voice' && pack.modelId === modelId);
}

function validWav(bytes: Buffer, expectedBytes: number): boolean {
  return bytes.length === expectedBytes && bytes.length >= 44
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WAVE'
    && bytes.readUInt32LE(24) === 24_000
    && bytes.readUInt16LE(22) === 1;
}

export async function generateLocalVoiceAudio(
  input: ValidVoiceRequest,
  overrides: LocalVoiceRuntimeOverrides = {},
  signal?: AbortSignal,
): Promise<LocalVoiceAudio> {
  if (activeGeneration) throw new LocalVoiceRuntimeError('Another local TTS job is already running', 429);
  activeGeneration = true;
  let workDir: string | undefined;
  try {
    workDir = await mkdtemp(join(tmpdir(), 'yolocut-local-tts-'));
    if (input.provider !== 'local') throw new LocalVoiceRuntimeError('unsupported local voice provider');
    const pack = voicePack(String(input.modelId ?? ''));
    if (!pack || !pack.runtime) throw new LocalVoiceRuntimeError(LOCAL_VOICE_UNAVAILABLE_MESSAGE);
    const voice = pack.voices?.find((entry) => entry.id === input.voiceId);
    if (!voice) throw new LocalVoiceRuntimeError('The selected voiceId is not available in the installed local model');
    if (String(input.languageCode).toLowerCase() !== voice.languageCode.toLowerCase()) {
      throw new LocalVoiceRuntimeError('The selected local voice supports zh-CN only');
    }
    const inspection = await (overrides.inspect ?? inspectModelPack)(pack);
    if (!inspection.installed) throw new LocalVoiceRuntimeError(
      inspection.error
        ? 'The installed local TTS model is damaged; reinstall the model pack'
        : LOCAL_VOICE_UNAVAILABLE_MESSAGE,
    );
    const segments = segmentLocalTtsText(input.text);
    const root = (overrides.root ?? modelPackRoot)(pack);
    if (pack.runtime.engine === 's2.cpp') {
      const requested = input.devicePreference ?? 'auto';
      if (requested !== 'auto' && requested !== 'cuda') {
        throw new LocalVoiceRuntimeError('Fish S2 Pro requires CUDA; select Kokoro for WebGPU or CPU execution');
      }
      if ((input.speed ?? 1) !== 1) {
        throw new LocalVoiceRuntimeError('Fish S2 Pro s2.cpp currently supports speed=1 only');
      }
      const reply = await (overrides.runFishS2 ?? generateFishS2Audio)({
        pack: pack as ModelPackDefinition & { readonly runtime: FishS2ModelPackRuntime },
        modelRoot: root,
        text: segments.join('\n'),
        voiceId: voice.id,
        languageCode: voice.languageCode,
        speed: 1,
        devicePreference: requested,
      }, signal);
      if (!Buffer.isBuffer(reply.bytes) || reply.bytes.length > 24 * 1024 * 1024 || !inspectPcmWav(reply.bytes)) {
        throw new LocalVoiceRuntimeError('Fish S2 Pro returned an invalid WAV file', 503);
      }
      return {
        bytes: reply.bytes,
        codec: 'wav',
        sampleRate: reply.sampleRate,
        modelId: pack.modelId,
        modelRevision: pack.revision,
        voiceId: voice.id,
        languageCode: voice.languageCode,
        speed: 1,
        inferenceBackend: reply.inferenceBackend,
        ...(reply.fallbackReason ? { fallbackReason: reply.fallbackReason } : {}),
      };
    }
    const requested = input.devicePreference ?? 'auto';
    if (requested === 'cuda') {
      throw new LocalVoiceRuntimeError('Kokoro uses WebGPU or CPU; CUDA is reserved for Fish S2 Pro');
    }
    const probe = requested === 'cpu' ? { eligible: false } : await (overrides.probe ?? probeLocalWebGpu)();
    const devicePreference: NativeTtsBackend = requested !== 'cpu' && probe.eligible ? 'webgpu' : 'cpu';
    if (!Number.isInteger(voice.speakerId)) throw new LocalVoiceRuntimeError('The selected Kokoro voice is missing its speaker mapping');
    const outputPath = join(workDir, 'output.wav');
    const reply = await (overrides.runWorker ?? ((request, requestSignal) => workerClient.run(request, requestSignal)))({
      id: randomUUID(),
      modelRoot: root,
      modelPath: pack.runtime.modelPath,
      voicesPath: pack.runtime.voicesPath,
      tokenizerDir: pack.runtime.tokenizerDir,
      workDir,
      outputPath,
      segments,
      speakerId: voice.speakerId!,
      languageCode: 'zh-CN',
      speed: input.speed ?? 1,
      devicePreference,
      silenceMs: 120,
      maxOutputSamples: MAX_OUTPUT_SAMPLES,
    }, signal);
    const info = await stat(outputPath);
    if (info.size > MAX_OUTPUT_SAMPLES * 2 + 44 || info.size !== reply.wavBytes) {
      throw new LocalVoiceRuntimeError('Local TTS worker returned an invalid WAV size', 503);
    }
    const bytes = await readFile(outputPath);
    if (!validWav(bytes, reply.wavBytes)) throw new LocalVoiceRuntimeError('Local TTS worker returned an invalid WAV file', 503);
    const fallbackReason = reply.fallbackReason ?? (devicePreference === 'cpu' && requested !== 'cpu' ? probe.reason : undefined);
    return {
      bytes,
      codec: 'wav',
      sampleRate: 24_000,
      modelId: pack.modelId,
      modelRevision: pack.revision,
      voiceId: voice.id,
      languageCode: voice.languageCode,
      speed: input.speed ?? 1,
      inferenceBackend: reply.inferenceBackend,
      ...(fallbackReason ? { fallbackReason } : {}),
    };
  } catch (error) {
    if (error instanceof LocalVoiceRuntimeError) throw error;
    if (signal?.aborted) throw new LocalVoiceRuntimeError('Local TTS generation was cancelled', 499);
    throw new LocalVoiceRuntimeError('Local TTS runtime is unavailable', 503);
  } finally {
    activeGeneration = false;
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function __resetLocalVoiceRuntimeForVerify(): void {
  activeGeneration = false;
  workerClient.terminate();
}
