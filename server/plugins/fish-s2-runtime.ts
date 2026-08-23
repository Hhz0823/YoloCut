import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { join } from 'node:path';

import type { FishS2ModelPackRuntime, ModelPackDefinition } from '../../shared/model-packs/catalog.ts';
import type { LocalVoiceInferenceBackend } from '../../shared/local-voice.ts';
import { discoverFishS2Runtime, type FishS2RuntimeDiscovery } from './fish-s2-runtime-discovery.ts';
import { probeLocalVoiceHardware } from './local-voice-hardware.ts';

const START_TIMEOUT_MS = 180_000;
const GENERATION_TIMEOUT_MS = 300_000;
const IDLE_TIMEOUT_MS = 300_000;
const MAX_DIAGNOSTIC_BYTES = 256 * 1024;
const MAX_WAV_BYTES = 24 * 1024 * 1024;

export interface FishS2GenerationInput {
  readonly pack: ModelPackDefinition & { readonly runtime: FishS2ModelPackRuntime };
  readonly modelRoot: string;
  readonly text: string;
  readonly voiceId: string;
  readonly languageCode: string;
  readonly speed: number;
  readonly devicePreference: 'auto' | 'cuda';
}

export interface FishS2GenerationResult {
  readonly bytes: Buffer;
  readonly sampleRate: number;
  readonly inferenceBackend: Extract<LocalVoiceInferenceBackend, 'cuda-hybrid'>;
  readonly fallbackReason?: string;
}

export function fishS2LaunchArgs(
  runtime: FishS2ModelPackRuntime,
  modelRoot: string,
  port: number,
): readonly string[] {
  return [
    '--model', join(modelRoot, runtime.modelPath),
    '--tokenizer', join(modelRoot, runtime.tokenizerPath),
    '--server', '--host', '127.0.0.1', '--port', String(port),
    '--cuda', '0', '--gpu-layers', String(runtime.gpuLayers),
    '--codec-auto', '--normalize', '--trim-silence', '--log-level', 'warn',
  ];
}

export function inspectPcmWav(bytes: Buffer): { sampleRate: number; channels: number; bits: number } | null {
  if (bytes.length < 44 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF'
    || bytes.subarray(8, 12).toString('ascii') !== 'WAVE'
    || bytes.subarray(12, 16).toString('ascii') !== 'fmt '
    || bytes.readUInt16LE(20) !== 1) return null;
  const channels = bytes.readUInt16LE(22);
  const sampleRate = bytes.readUInt32LE(24);
  const bits = bytes.readUInt16LE(34);
  if (channels !== 1 || bits !== 16 || sampleRate < 16_000 || sampleRate > 96_000) return null;
  return { sampleRate, channels, bits };
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to reserve s2.cpp port');
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  return address.port;
}

function portAccepting(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(250);
    socket.once('connect', () => { socket.destroy(); resolvePromise(true); });
    const fail = () => { socket.destroy(); resolvePromise(false); };
    socket.once('timeout', fail);
    socket.once('error', fail);
  });
}

async function readBoundedResponse(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && (declared <= 0 || declared > MAX_WAV_BYTES)) {
    throw new Error('s2.cpp returned an invalid audio size');
  }
  if (!response.body) throw new Error('s2.cpp returned no audio body');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_WAV_BYTES) {
      await reader.cancel();
      throw new Error('s2.cpp audio exceeded the 120 second product limit');
    }
    chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks, total);
}

class FishS2ServerClient {
  private child: ChildProcess | null = null;
  private key = '';
  private port = 0;
  private diagnostics = '';
  private startFlight: Promise<void> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private busy = false;

  private appendDiagnostics(chunk: Buffer): void {
    this.diagnostics += chunk.toString('utf8');
    if (Buffer.byteLength(this.diagnostics) > MAX_DIAGNOSTIC_BYTES) {
      this.diagnostics = this.diagnostics.slice(-MAX_DIAGNOSTIC_BYTES / 2);
    }
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.terminate(), IDLE_TIMEOUT_MS);
    this.idleTimer.unref();
  }

  private async start(
    input: FishS2GenerationInput,
    discovery: FishS2RuntimeDiscovery & { available: true; executablePath: string; root: string },
  ): Promise<void> {
    this.port = await reserveLoopbackPort();
    const child = spawn(discovery.executablePath, fishS2LaunchArgs(input.pack.runtime, input.modelRoot, this.port), {
      cwd: discovery.root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: `${discovery.root};${process.env.PATH ?? process.env.Path ?? ''}`,
        Path: `${discovery.root};${process.env.Path ?? process.env.PATH ?? ''}`,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        CUDA_PATH: process.env.CUDA_PATH,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
      },
    });
    this.child = child;
    this.diagnostics = '';
    let launchError: Error | null = null;
    child.stdout?.on('data', (chunk: Buffer) => this.appendDiagnostics(chunk));
    child.stderr?.on('data', (chunk: Buffer) => this.appendDiagnostics(chunk));
    child.once('error', (error) => { launchError = error; });
    const deadline = Date.now() + START_TIMEOUT_MS;
    for (;;) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.killed) {
        throw new Error(`s2.cpp stopped during startup: ${this.diagnostics.slice(-600)}`);
      }
      if (await portAccepting(this.port)) break;
      if (Date.now() >= deadline) throw new Error('s2.cpp model startup timed out');
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }

  private async ensure(input: FishS2GenerationInput): Promise<void> {
    const discovery = await discoverFishS2Runtime();
    if (!discovery.available || !discovery.executablePath || !discovery.root) {
      throw new Error(discovery.reason ?? 'Fish S2 Pro s2.cpp runtime is unavailable');
    }
    const nextKey = `${discovery.executablePath}|${input.pack.id}|${input.modelRoot}`;
    if (this.child && this.child.exitCode === null && !this.child.killed && this.key === nextKey) return;
    this.terminate();
    this.key = nextKey;
    this.startFlight = this.start(input, discovery as FishS2RuntimeDiscovery & {
      available: true; executablePath: string; root: string;
    });
    try { await this.startFlight; } catch (error) { this.terminate(); throw error; }
    finally { this.startFlight = null; }
  }

  async run(input: FishS2GenerationInput, signal?: AbortSignal): Promise<FishS2GenerationResult> {
    if (this.busy) throw new Error('Another Fish S2 Pro job is already running');
    this.busy = true;
    try {
      const hardware = await probeLocalVoiceHardware();
      if (!hardware.selectedGpu || hardware.selectedGpu.memoryMiB < input.pack.runtime.minimumVramMiB) {
        throw new Error(`Fish S2 Pro ${input.pack.runtime.quantization} requires at least ${input.pack.runtime.minimumVramMiB} MiB VRAM`);
      }
      await this.ensure(input);
      const form = new FormData();
      form.set('text', input.text);
      form.set('params', JSON.stringify({
        max_new_tokens: 512,
        temperature: 0.58,
        top_p: 0.88,
        top_k: 40,
        stream: true,
        segment_sentences: true,
        sentence_pause_ms: 120,
        segment_max_chars: 220,
      }));
      const timeout = AbortSignal.timeout(GENERATION_TIMEOUT_MS);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await fetch(`http://127.0.0.1:${this.port}/generate`, {
        method: 'POST', body: form, signal: combined,
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 600);
        throw new Error(`s2.cpp generation failed (${response.status}): ${detail}`);
      }
      const bytes = await readBoundedResponse(response);
      const wav = inspectPcmWav(bytes);
      if (!wav) throw new Error('s2.cpp returned an invalid mono PCM WAV');
      if (bytes.length > wav.sampleRate * 2 * 120 + 44) {
        throw new Error('s2.cpp audio exceeded the 120 second product limit');
      }
      this.scheduleIdle();
      return { bytes, sampleRate: wav.sampleRate, inferenceBackend: 'cuda-hybrid' };
    } finally {
      this.busy = false;
    }
  }

  terminate(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const child = this.child;
    this.child = null;
    this.key = '';
    this.port = 0;
    this.startFlight = null;
    this.diagnostics = '';
    if (child && !child.killed) child.kill();
  }
}

const client = new FishS2ServerClient();

export function generateFishS2Audio(
  input: FishS2GenerationInput,
  signal?: AbortSignal,
): Promise<FishS2GenerationResult> {
  return client.run(input, signal);
}

export function __resetFishS2RuntimeForVerify(): void {
  client.terminate();
}
