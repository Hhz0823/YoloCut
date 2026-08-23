// Long-lived, single-concurrency Kokoro worker. It keeps one dynamic-shape ORT
// session warm across segments/jobs and never opens a network socket.
import { createRequire } from 'node:module';
import { open, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

type MutableModule = Record<string, unknown>;
type Ort = typeof import('onnxruntime-node');
type OrtSession = import('onnxruntime-node').InferenceSession;

export interface OfflineNetworkTargets {
  readonly global: MutableModule;
  readonly http: MutableModule;
  readonly https: MutableModule;
  readonly net: MutableModule;
  readonly tls: MutableModule;
  readonly dns: MutableModule;
  readonly dnsPromises?: MutableModule;
  readonly dgram: MutableModule;
}

const blockedNetwork = (): never => {
  throw new Error('network access is disabled for local TTS inference');
};

function replaceFunctions(target: MutableModule | undefined, names: readonly string[]): void {
  if (!target) return;
  for (const name of names) {
    if (name in target) Object.defineProperty(target, name, { configurable: true, writable: true, value: blockedNetwork });
  }
}

/** Install before loading the tokenizer or ORT runtime. */
export function installOfflineNetworkGuards(targets: OfflineNetworkTargets): void {
  Object.defineProperty(targets.global, 'fetch', { configurable: true, writable: true, value: blockedNetwork });
  replaceFunctions(targets.http, ['request', 'get']);
  replaceFunctions(targets.https, ['request', 'get']);
  replaceFunctions(targets.net, ['connect', 'createConnection']);
  replaceFunctions(targets.tls, ['connect']);
  replaceFunctions(targets.dns, ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']);
  replaceFunctions(targets.dnsPromises, ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']);
  replaceFunctions(targets.dgram, ['createSocket']);
}

export type NativeTtsBackend = 'webgpu' | 'cpu';

export interface NativeTtsWorkerRequest {
  readonly id: string;
  readonly modelRoot: string;
  readonly modelPath: string;
  readonly voicesPath: string;
  readonly tokenizerDir: string;
  readonly workDir: string;
  readonly outputPath: string;
  readonly segments: readonly string[];
  readonly speakerId: number;
  readonly languageCode: 'zh-CN';
  readonly speed: number;
  readonly devicePreference: 'webgpu' | 'cpu';
  readonly silenceMs: number;
  readonly maxOutputSamples: number;
}

export interface NativeTtsWorkerSuccess {
  readonly id: string;
  readonly ok: true;
  readonly sampleRate: 24_000;
  readonly sampleCount: number;
  readonly segmentCount: number;
  readonly wavBytes: number;
  readonly inferenceBackend: NativeTtsBackend;
  readonly fallbackReason?: string;
}

interface TokenTensor {
  readonly data: BigInt64Array | Int32Array | readonly bigint[] | readonly number[];
  readonly dims: readonly number[];
}

interface KokoroFrontend {
  generate(text: string, options: { voice: 'zf_001'; speed: number }): Promise<unknown>;
  generate_from_ids(ids: TokenTensor, options?: unknown): Promise<unknown>;
}

interface LoadedRuntime {
  readonly ort: Ort;
  readonly frontend: KokoroFrontend;
  readonly voices: Float32Array;
  readonly modelPath: string;
}

interface SessionState {
  session: OrtSession | null;
  backend: NativeTtsBackend | null;
  profilingPrefix: string | null;
}

let loadedRoot = '';
let runtime: LoadedRuntime | null = null;
const webGpu: SessionState = { session: null, backend: null, profilingPrefix: null };
const cpu: SessionState = { session: null, backend: 'cpu', profilingPrefix: null };

function isContained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function catalogPath(root: string, path: string): string {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).some((part) => !part || part === '.' || part === '..')) {
    throw new Error('invalid_catalog_path');
  }
  const candidate = resolve(root, path);
  if (!isContained(root, candidate)) throw new Error('invalid_catalog_path');
  return candidate;
}

async function validateRequest(input: NativeTtsWorkerRequest): Promise<void> {
  if (!/^[a-f0-9-]{8,64}$/.test(input.id)) throw new Error('invalid_request_id');
  if (!isAbsolute(input.modelRoot) || !isAbsolute(input.workDir) || !isAbsolute(input.outputPath)) {
    throw new Error('invalid_worker_path');
  }
  const realWork = await realpath(input.workDir);
  const realTmp = await realpath(tmpdir());
  // Compare the two caller-supplied paths lexically after the work directory's
  // real target is proven to be inside TEMP. Windows may spell TEMP with an 8.3
  // alias while realpath() expands it, so mixing those forms rejects a safe path.
  if (!isContained(realTmp, realWork) || resolve(input.outputPath) !== resolve(input.workDir, 'output.wav')) {
    throw new Error('invalid_worker_path');
  }
  if (!Array.isArray(input.segments) || input.segments.length < 1 || input.segments.length > 32
    || input.segments.some((segment) => typeof segment !== 'string' || !segment.trim() || segment.length > 800)) {
    throw new Error('invalid_segments');
  }
  if (!Number.isInteger(input.speakerId) || input.speakerId < 45 || input.speakerId > 52) {
    throw new Error('invalid_speaker');
  }
  if (input.languageCode !== 'zh-CN') throw new Error('unsupported_language');
  if (!Number.isFinite(input.speed) || input.speed < 0.5 || input.speed > 2) throw new Error('invalid_speed');
  if (input.devicePreference !== 'webgpu' && input.devicePreference !== 'cpu') throw new Error('invalid_backend');
  if (!Number.isInteger(input.silenceMs) || input.silenceMs < 0 || input.silenceMs > 1_000) throw new Error('invalid_silence');
  if (!Number.isInteger(input.maxOutputSamples) || input.maxOutputSamples < 24_000
    || input.maxOutputSamples > 2_880_000) throw new Error('invalid_output_limit');
  const root = resolve(input.modelRoot);
  for (const [path, directory] of [
    [input.modelPath, false], [input.voicesPath, false], [input.tokenizerDir, true],
  ] as const) {
    const info = await stat(catalogPath(root, path));
    if (directory ? !info.isDirectory() : !info.isFile()) throw new Error('model_pack_incomplete');
  }
}

async function releaseSession(state: SessionState): Promise<void> {
  const session = state.session;
  state.session = null;
  state.profilingPrefix = null;
  if (state !== cpu) state.backend = null;
  if (session) await Promise.resolve(session.release()).catch(() => undefined);
}

async function releaseRuntime(): Promise<void> {
  await Promise.all([releaseSession(webGpu), releaseSession(cpu)]);
  runtime = null;
  loadedRoot = '';
}

async function loadRuntime(input: NativeTtsWorkerRequest): Promise<LoadedRuntime> {
  const root = resolve(input.modelRoot);
  if (runtime && loadedRoot === root) return runtime;
  await releaseRuntime();
  const require = createRequire(import.meta.url);
  const uzenEntry = require.resolve('@uzen/kokoro-js');
  const scopedRequire = createRequire(uzenEntry);
  const uzen = scopedRequire(uzenEntry) as {
    KokoroTTS: new (model: unknown, tokenizer: unknown) => KokoroFrontend;
  };
  const transformers = scopedRequire('@huggingface/transformers') as {
    AutoTokenizer: { from_pretrained(path: string, options: unknown): Promise<unknown> };
    env: { allowRemoteModels: boolean; allowLocalModels: boolean };
  };
  transformers.env.allowRemoteModels = false;
  transformers.env.allowLocalModels = true;
  const tokenizer = await transformers.AutoTokenizer.from_pretrained(
    catalogPath(root, input.tokenizerDir),
    { local_files_only: true },
  );
  const frontend = new uzen.KokoroTTS(null, tokenizer);
  const voiceBytes = await readFile(catalogPath(root, input.voicesPath));
  if (voiceBytes.byteLength !== 53 * 510 * 256 * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error('invalid_voices_layout');
  }
  const voiceBuffer = voiceBytes.buffer.slice(voiceBytes.byteOffset, voiceBytes.byteOffset + voiceBytes.byteLength);
  const voices = new Float32Array(voiceBuffer);
  const ort = require('onnxruntime-node') as Ort;
  runtime = { ort, frontend, voices, modelPath: catalogPath(root, input.modelPath) };
  loadedRoot = root;
  return runtime;
}

async function tokenize(frontend: KokoroFrontend, text: string): Promise<BigInt64Array> {
  const capture: { value?: TokenTensor } = {};
  const original = frontend.generate_from_ids;
  frontend.generate_from_ids = async (ids) => {
    capture.value = ids;
    return Object.freeze({});
  };
  try {
    await frontend.generate(text, { voice: 'zf_001', speed: 1 });
  } finally {
    frontend.generate_from_ids = original;
  }
  const captured = capture.value;
  if (!captured || captured.dims.length !== 2 || captured.dims[0] !== 1) throw new Error('tokenization_failed');
  const source = captured.data as ArrayLike<number | bigint>;
  const values = BigInt64Array.from(Array.from(source, (value) => BigInt(value)));
  if (values.length < 3 || values.length > 510 || captured.dims[1] !== values.length) {
    throw new Error('token_count_out_of_range');
  }
  return values;
}

export function kokoroStyleOffset(speakerId: number, tokenCount: number): number {
  const lengthIndex = Math.min(Math.max(tokenCount - 2, 0), 509);
  return ((speakerId * 510) + lengthIndex) * 256;
}

function styleFor(voices: Float32Array, speakerId: number, tokenCount: number): Float32Array {
  const offset = kokoroStyleOffset(speakerId, tokenCount);
  const style = voices.slice(offset, offset + 256);
  if (style.length !== 256) throw new Error('invalid_voice_style');
  return style;
}

function profileProviders(value: unknown): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  if (!Array.isArray(value)) return counts;
  for (const event of value) {
    if (!event || typeof event !== 'object') continue;
    const args = (event as { args?: unknown }).args;
    if (!args || typeof args !== 'object') continue;
    const provider = (args as { provider?: unknown }).provider;
    if (typeof provider === 'string') counts.set(provider, (counts.get(provider) ?? 0) + 1);
  }
  return counts;
}

export function backendFromProfile(value: unknown): NativeTtsBackend {
  return (profileProviders(value).get('WebGpuExecutionProvider') ?? 0) > 0 ? 'webgpu' : 'cpu';
}

async function findProfile(prefix: string): Promise<string | null> {
  const directory = resolve(prefix, '..');
  const basename = prefix.slice(directory.length + 1);
  const matches = (await readdir(directory)).filter((name) => name.startsWith(basename));
  return matches.length ? join(directory, matches.toSorted().at(-1)!) : null;
}

async function finishWebGpuProfile(state: SessionState): Promise<NativeTtsBackend> {
  const prefix = state.profilingPrefix;
  if (!state.session || !prefix) return state.backend ?? 'cpu';
  await state.session.endProfiling();
  const path = await findProfile(prefix);
  state.profilingPrefix = null;
  if (!path) return 'cpu';
  try {
    return backendFromProfile(JSON.parse(await readFile(path, 'utf8')) as unknown);
  } finally {
    await rm(path, { force: true }).catch(() => undefined);
  }
}

async function createSession(
  loaded: LoadedRuntime,
  backend: NativeTtsBackend,
  profilePrefix: string,
): Promise<SessionState> {
  const state = backend === 'webgpu' ? webGpu : cpu;
  if (state.session) return state;
  const supported = loaded.ort.listSupportedBackends();
  if (backend === 'webgpu' && !supported.some((entry) => entry.name === 'webgpu' && entry.bundled)) {
    throw new Error('webgpu_not_bundled');
  }
  const enableProfiling = backend === 'webgpu' && state.backend === null;
  state.profilingPrefix = enableProfiling ? profilePrefix : null;
  state.session = await loaded.ort.InferenceSession.create(loaded.modelPath, {
    executionProviders: backend === 'webgpu' ? ['webgpu', 'cpu'] : ['cpu'],
    enableMemPattern: false,
    executionMode: 'sequential',
    ...(enableProfiling ? { enableProfiling: true, profileFilePrefix: profilePrefix } : {}),
  });
  return state;
}

async function runSegment(
  loaded: LoadedRuntime,
  state: SessionState,
  tokens: BigInt64Array,
  speakerId: number,
  speed: number,
): Promise<Float32Array> {
  if (!state.session) throw new Error('session_unavailable');
  const output = await state.session.run({
    tokens: new loaded.ort.Tensor('int64', tokens, [1, tokens.length]),
    style: new loaded.ort.Tensor('float32', styleFor(loaded.voices, speakerId, tokens.length), [1, 256]),
    speed: new loaded.ort.Tensor('float32', Float32Array.of(speed), [1]),
  });
  const audio = output.audio?.data;
  if (!(audio instanceof Float32Array) || audio.length === 0) throw new Error('invalid_audio');
  return audio;
}

function wavHeader(sampleCount: number): Buffer {
  const dataBytes = sampleCount * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24_000, 24);
  header.writeUInt32LE(48_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

async function writeAll(file: Awaited<ReturnType<typeof open>>, bytes: Buffer, position?: number): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const result = await file.write(bytes, offset, bytes.length - offset, position === undefined ? null : position + offset);
    if (result.bytesWritten <= 0) throw new Error('wav_write_failed');
    offset += result.bytesWritten;
  }
}

function pcm16(samples: Float32Array): Buffer {
  const bytes = Buffer.allocUnsafe(samples.length * 2);
  let peak = 0;
  for (const sample of samples) {
    if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
  }
  const gain = peak > 0.98 ? 0.98 / peak : 1;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const value = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample * gain)) : 0;
    bytes.writeInt16LE(value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), index * 2);
  }
  return bytes;
}

async function generate(input: NativeTtsWorkerRequest): Promise<NativeTtsWorkerSuccess> {
  await validateRequest(input);
  const loaded = await loadRuntime(input);
  let fallbackReason: string | undefined;
  let state: SessionState;
  try {
    state = await createSession(loaded, input.devicePreference, join(input.workDir, 'ort-profile'));
  } catch {
    if (input.devicePreference !== 'webgpu') throw new Error('initialization_failed');
    fallbackReason = 'WebGPU initialization failed; ONNX Runtime used CPU fallback.';
    state = await createSession(loaded, 'cpu', join(input.workDir, 'unused-profile'));
  }
  const file = await open(input.outputPath, 'wx');
  let sampleCount = 0;
  let inferenceBackend: NativeTtsBackend = state === webGpu ? (state.backend ?? 'webgpu') : 'cpu';
  try {
    await writeAll(file, Buffer.alloc(44));
    for (let index = 0; index < input.segments.length; index += 1) {
      const tokens = await tokenize(loaded.frontend, input.segments[index]!);
      let audio: Float32Array;
      try {
        audio = await runSegment(loaded, state, tokens, input.speakerId, input.speed);
      } catch {
        if (state !== webGpu) throw new Error('generation_failed');
        await releaseSession(webGpu);
        fallbackReason = 'WebGPU inference failed; ONNX Runtime used CPU fallback.';
        state = await createSession(loaded, 'cpu', join(input.workDir, 'unused-profile'));
        audio = await runSegment(loaded, state, tokens, input.speakerId, input.speed);
        inferenceBackend = 'cpu';
      }
      if (state === webGpu && webGpu.backend === null && webGpu.profilingPrefix) {
        webGpu.backend = await finishWebGpuProfile(webGpu);
        inferenceBackend = webGpu.backend;
        if (inferenceBackend === 'cpu') {
          fallbackReason = 'WebGPU session assigned no model nodes to WebGPU; ONNX Runtime used CPU fallback.';
          await releaseSession(webGpu);
          state = await createSession(loaded, 'cpu', join(input.workDir, 'unused-profile'));
        }
      } else if (state === webGpu) inferenceBackend = webGpu.backend ?? 'webgpu';
      const silenceSamples = index + 1 < input.segments.length ? Math.round(24_000 * input.silenceMs / 1_000) : 0;
      if (sampleCount + audio.length + silenceSamples > input.maxOutputSamples) throw new Error('audio_too_long');
      await writeAll(file, pcm16(audio));
      sampleCount += audio.length;
      if (silenceSamples) {
        await writeAll(file, Buffer.alloc(silenceSamples * 2));
        sampleCount += silenceSamples;
      }
    }
    await writeAll(file, wavHeader(sampleCount), 0);
  } catch (error) {
    await file.close().catch(() => undefined);
    await rm(input.outputPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await file.close();
  return {
    id: input.id,
    ok: true,
    sampleRate: 24_000,
    sampleCount,
    segmentCount: input.segments.length,
    wavBytes: 44 + sampleCount * 2,
    inferenceBackend,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^[a-z_]+$/.test(message) ? message : 'worker_failed';
}

async function main(): Promise<void> {
  const require = createRequire(import.meta.url);
  const dns = require('node:dns') as MutableModule;
  installOfflineNetworkGuards({
    global: globalThis as unknown as MutableModule,
    http: require('node:http') as MutableModule,
    https: require('node:https') as MutableModule,
    net: require('node:net') as MutableModule,
    tls: require('node:tls') as MutableModule,
    dns,
    dnsPromises: dns.promises as MutableModule | undefined,
    dgram: require('node:dgram') as MutableModule,
  });
  process.stdin.setEncoding('utf8');
  let pending = '';
  for await (const chunk of process.stdin) {
    pending += chunk;
    if (pending.length > 256 * 1024) throw new Error('worker_input_too_large');
    for (;;) {
      const newline = pending.indexOf('\n');
      if (newline < 0) break;
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (!line.trim()) continue;
      let id = 'unknown';
      try {
        const input = JSON.parse(line) as NativeTtsWorkerRequest;
        id = typeof input.id === 'string' ? input.id : id;
        process.stdout.write(`${JSON.stringify(await generate(input))}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ id, ok: false, error: safeError(error) })}\n`);
      }
    }
  }
  await releaseRuntime();
}

if (process.env.YOLOCUT_NATIVE_TTS_WORKER === '1') {
  void main().catch(() => { process.exitCode = 1; });
}
