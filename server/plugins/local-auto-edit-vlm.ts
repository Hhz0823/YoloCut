import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

import {
  modelPackDefinition,
  type LlamaCppVisionModelPackRuntime,
} from '../../shared/model-packs/catalog.ts';
import type { AutoEditReferenceStyle } from '../../shared/auto-edit-batch.ts';
import { readJson } from '../agent-runs/request.ts';
import { discoverLlamaCppRuntime } from './llama-cpp-runtime-discovery.ts';
import { inspectModelPack, modelPackRoot } from './model-packs.ts';

const PACK_ID = 'smolvlm2-500m-q8-local';
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGES = 4;
const START_TIMEOUT_MS = 60_000;

type LocalVlmBackend = 'cuda' | 'vulkan' | 'metal' | 'cpu' | 'unknown';

interface LocalVlmResponse {
  readonly profile: AutoEditReferenceStyle;
  readonly modelId: string;
  readonly inferenceBackend: LocalVlmBackend;
  readonly runtimeBuild: number;
}

interface RunningServer {
  readonly process: ChildProcessByStdio<null, Readable, Readable>;
  readonly baseUrl: string;
  readonly build: number;
  readonly logs: () => string;
}

let running: Promise<RunningServer> | null = null;
let live: RunningServer | null = null;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function freePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePromise(port));
    });
  });
}

function boundedLog(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString('utf8')}`.slice(-32_000);
}

async function waitForHealth(baseUrl: string, child: ChildProcessByStdio<null, Readable, Readable>, logs: () => string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`llama-server exited during startup: ${logs().slice(-2_000)}`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Loading a GGUF can take tens of seconds on the minimum hardware tier.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`llama-server startup timed out: ${logs().slice(-2_000)}`);
}

async function startServer(): Promise<RunningServer> {
  const pack = modelPackDefinition(PACK_ID);
  if (!pack || pack.analysisRuntime?.engine !== 'llama.cpp') throw new Error('SmolVLM2 model-pack contract is unavailable');
  const inspection = await inspectModelPack(pack);
  if (!inspection.installed) {
    throw new Error('请先在 设置 → 本地模型 → 自动剪辑分析 安装 SmolVLM2 500M Q8 模型包。');
  }
  const runtime = await discoverLlamaCppRuntime();
  if (!runtime.available || !runtime.executablePath || !runtime.build) {
    throw new Error(runtime.reason ?? 'llama.cpp runtime is unavailable');
  }
  const contract = pack.analysisRuntime as LlamaCppVisionModelPackRuntime;
  const root = modelPackRoot(pack);
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const args = [
    '--model', join(root, contract.modelPath),
    '--mmproj', join(root, contract.mmprojPath),
    '--host', '127.0.0.1',
    '--port', String(port),
    '--ctx-size', '4096',
    '--parallel', '1',
    '--n-gpu-layers', String(contract.gpuLayers),
    '--no-webui',
  ];
  const child = spawn(runtime.executablePath, args, {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => { output = boundedLog(output, chunk); });
  child.stderr.on('data', (chunk: Buffer) => { output = boundedLog(output, chunk); });
  const current: RunningServer = {
    process: child,
    baseUrl,
    build: runtime.build,
    logs: () => output,
  };
  try {
    await waitForHealth(baseUrl, child, current.logs);
  } catch (error) {
    child.kill();
    throw error;
  }
  live = current;
  child.once('exit', () => {
    if (live === current) live = null;
    running = null;
  });
  return current;
}

function ensureServer(): Promise<RunningServer> {
  if (live?.process.exitCode === null) return Promise.resolve(live);
  running ??= startServer().catch((error) => {
    running = null;
    throw error;
  });
  return running;
}

export function localAutoEditVlmBackend(logs: string): LocalVlmBackend {
  const offload = /offload(?:ed|ing)?[^\n]*?\b(\d+)\s*(?:\/\s*\d+)?\s+(?:repeating\s+)?layers?[^\n]*GPU/i.exec(logs);
  const usedGpu = offload !== null && Number.parseInt(offload[1]!, 10) > 0;
  if (usedGpu && /\bCUDA\b|ggml_cuda/i.test(logs)) return 'cuda';
  if (usedGpu && /\bVulkan\b/i.test(logs)) return 'vulkan';
  if (usedGpu && /\bMetal\b/i.test(logs)) return 'metal';
  if (/CPU buffer|using CPU|CPU backend/i.test(logs)) return 'cpu';
  return 'unknown';
}

function imageDataUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(?:data:image\/(jpeg|png|webp);base64,)?([A-Za-z0-9+/]+={0,2})$/.exec(value.trim());
  if (!match) return null;
  const bytes = Math.floor(match[2]!.length * 3 / 4);
  if (bytes < 1 || bytes > MAX_IMAGE_BYTES) return null;
  return `data:image/${match[1] ?? 'jpeg'};base64,${match[2]}`;
}

export function parseLocalAutoEditReferenceStyle(content: string): AutoEditReferenceStyle {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const value = JSON.parse(normalized) as Record<string, unknown>;
  const field = (name: string): string => {
    const text = typeof value[name] === 'string' ? value[name].trim() : '';
    if (!text) throw new Error(`local vision result is missing ${name}`);
    return text.slice(0, 2_000);
  };
  return {
    summary: field('summary'),
    shotRhythm: field('shotRhythm'),
    visualStyle: field('visualStyle'),
    captionStyle: field('captionStyle'),
    transitionStyle: field('transitionStyle'),
    colorStyle: field('colorStyle'),
    audioStyle: '未从静态画面帧推断；需要单独分析参考音轨。',
    structureOnly: true,
  };
}

async function analyze(images: readonly string[], instruction: string): Promise<LocalVlmResponse> {
  const server = await ensureServer();
  const content = [
    ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
    {
      type: 'text',
      text: [
        'Analyze this contact sheet as an editing reference. Describe reusable structure only.',
        'Do not identify or reproduce people, logos, copyrighted footage, dialogue, or unique creative expression.',
        instruction,
        'Return JSON with exactly: summary, shotRhythm, visualStyle, captionStyle, transitionStyle, colorStyle, audioStyle.',
      ].filter(Boolean).join('\n'),
    },
  ];
  const response = await fetch(`${server.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'smolvlm2-500m-q8-local',
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a conservative video-editing reference analyst.' },
        { role: 'user', content },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.json().catch(() => null) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  if (!response.ok) throw new Error(body?.error?.message ?? `llama-server HTTP ${response.status}`);
  const result = body?.choices?.[0]?.message?.content;
  if (!result) throw new Error('llama-server returned no analysis');
  return {
    profile: parseLocalAutoEditReferenceStyle(result),
    modelId: PACK_ID,
    inferenceBackend: localAutoEditVlmBackend(server.logs()),
    runtimeBuild: server.build,
  };
}

async function handleAnalyze(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req, MAX_REQUEST_BYTES);
  const rawImages = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  const images = rawImages.map(imageDataUrl).filter((value): value is string => value !== null);
  if (!images.length || images.length !== rawImages.length) throw new Error('1-4 valid JPEG/PNG/WebP images are required');
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 4_000) : '';
  sendJson(res, 200, await analyze(images, instruction));
}

export function stopLocalAutoEditVlm(): void {
  live?.process.kill();
  live = null;
  running = null;
}

export function localAutoEditVlmPlugin(): Plugin {
  return {
    name: 'yolocut-local-auto-edit-vlm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?', 1)[0];
        if (pathname !== '/api/auto-edit/vlm/analyze') return next();
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        void handleAnalyze(req, res).catch((error) => sendJson(res, 400, { error: errorMessage(error) }));
      });
      return () => stopLocalAutoEditVlm();
    },
  };
}
