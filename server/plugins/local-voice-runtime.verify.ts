import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateVoiceRequest } from './voice-validation.ts';
import {
  __resetLocalVoiceRuntimeForVerify,
  estimateLocalTtsTokens,
  generateLocalVoiceAudio,
  parseEligibleNvidiaGpu,
  segmentLocalTtsText,
  type LocalVoiceRuntimeOverrides,
} from './local-voice-runtime.ts';
import type { NativeTtsBackend, NativeTtsWorkerRequest, NativeTtsWorkerSuccess } from '../../desktop/native-tts-worker.ts';

function wav(sampleCount = 2_400, sampleRate = 24_000): Buffer {
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36 + sampleCount * 2, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(sampleCount * 2, 40);
  return bytes;
}

async function workerFixture(
  request: NativeTtsWorkerRequest,
  inferenceBackend: NativeTtsBackend,
  fallbackReason?: string,
): Promise<NativeTtsWorkerSuccess> {
  const bytes = wav();
  await writeFile(request.outputPath, bytes);
  return {
    id: request.id,
    ok: true,
    sampleRate: 24_000,
    sampleCount: 2_400,
    segmentCount: request.segments.length,
    wavBytes: bytes.length,
    inferenceBackend,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

const short = '你好。欢迎使用 YoloCut。';
assert.ok(estimateLocalTtsTokens(short) > 0);
assert.equal(segmentLocalTtsText(short).length, 1, 'short neighboring sentences are merged');
const long = Array.from({ length: 20 }, (_, index) => `这是第${index + 1}句本地口播内容，用于验证自然分段。`).join('');
const segments = segmentLocalTtsText(long);
assert.ok(segments.length > 1);
assert.ok(segments.every((segment) => estimateLocalTtsTokens(segment) <= 200));
assert.throws(() => segmentLocalTtsText('x'.repeat(2_001)), /at most 2000 characters/);
assert.equal(parseEligibleNvidiaGpu('NVIDIA GeForce RTX 2060, 6144, 7.5'), true);
assert.equal(parseEligibleNvidiaGpu('NVIDIA GeForce GTX 1650, 4096, 7.5'), false);

const input = validateVoiceRequest({
  provider: 'local',
  text: '你好，欢迎使用完全离线的本地语音。',
  modelId: 'nvidia/kokoro-82M-onnx-opt',
  voiceId: 'zf_xiaoxiao',
  languageCode: 'zh-CN',
  speed: 1,
  devicePreference: 'auto',
});
const root = await mkdtemp(join(tmpdir(), 'yolocut-local-tts-runtime-'));
const base: LocalVoiceRuntimeOverrides = {
  inspect: async () => ({ installed: true }),
  root: () => root,
  probe: async () => ({ eligible: true }),
};

try {
  let webGpuRequest: NativeTtsWorkerRequest | undefined;
  const generated = await generateLocalVoiceAudio(input, {
    ...base,
    runWorker: async (request) => {
      webGpuRequest = request;
      return workerFixture(request, 'webgpu');
    },
  });
  assert.equal(webGpuRequest?.devicePreference, 'webgpu');
  assert.equal(webGpuRequest?.speakerId, 47);
  assert.equal(generated.modelId, 'nvidia/kokoro-82M-onnx-opt');
  assert.equal(generated.inferenceBackend, 'webgpu', 'backend comes from the worker result');
  assert.equal(generated.bytes.subarray(0, 4).toString('ascii'), 'RIFF');

  const cpuFallback = await generateLocalVoiceAudio(input, {
    ...base,
    probe: async () => ({ eligible: false, reason: 'GPU below floor; local TTS used CPU fallback.' }),
    runWorker: async (request) => {
      assert.equal(request.devicePreference, 'cpu');
      return workerFixture(request, 'cpu');
    },
  });
  assert.equal(cpuFallback.inferenceBackend, 'cpu');
  assert.match(cpuFallback.fallbackReason ?? '', /CPU fallback/);

  await assert.rejects(
    generateLocalVoiceAudio(input, { ...base, inspect: async () => ({ installed: false }) }),
    /本地口播模型未安装或不可用/,
  );
  await assert.rejects(
    generateLocalVoiceAudio(input, { ...base, inspect: async () => ({ installed: false, error: 'bad sha' }) }),
    /damaged.*reinstall/i,
  );
  await assert.rejects(
    generateLocalVoiceAudio({ ...input, modelId: '../outside' }, base),
    /未安装或不可用/,
    'traversal-like model ids never become filesystem paths',
  );
  await assert.rejects(
    generateLocalVoiceAudio({ ...input, voiceId: 'invented' }, base),
    /voiceId is not available/,
  );

  const fishInput = validateVoiceRequest({
    provider: 'local',
    text: '这是 Fish Audio S2 Pro 的本地 CUDA 口播。',
    modelId: 'fishaudio/s2-pro-s2cpp-q6-k',
    voiceId: 'random-zh',
    languageCode: 'zh-CN',
    speed: 1,
    devicePreference: 'cuda',
  });
  const fishGenerated = await generateLocalVoiceAudio(fishInput, {
    ...base,
    runFishS2: async (request) => {
      assert.equal(request.pack.runtime.engine, 's2.cpp');
      assert.equal(request.pack.runtime.quantization, 'q6_k');
      assert.equal(request.devicePreference, 'cuda');
      return {
        bytes: wav(4_410, 44_100),
        sampleRate: 44_100,
        inferenceBackend: 'cuda-hybrid',
      };
    },
  });
  assert.equal(fishGenerated.modelId, 'fishaudio/s2-pro-s2cpp-q6-k');
  assert.equal(fishGenerated.sampleRate, 44_100);
  assert.equal(fishGenerated.inferenceBackend, 'cuda-hybrid');
  await assert.rejects(
    generateLocalVoiceAudio({ ...fishInput, devicePreference: 'cpu' }, base),
    /requires CUDA/,
  );
  await assert.rejects(
    generateLocalVoiceAudio({ ...fishInput, speed: 1.1 }, base),
    /speed=1 only/,
  );

  let releaseWorker: (() => void) | undefined;
  const gate = new Promise<void>((resolvePromise) => { releaseWorker = resolvePromise; });
  const first = generateLocalVoiceAudio(input, {
    ...base,
    runWorker: async (request) => {
      await gate;
      return workerFixture(request, 'webgpu');
    },
  });
  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
  await assert.rejects(generateLocalVoiceAudio(input, base), (error: unknown) => (
    error instanceof Error && error.message.includes('already running')
    && (error as Error & { status?: number }).status === 429
  ));
  releaseWorker?.();
  await first;
} finally {
  __resetLocalVoiceRuntimeForVerify();
  await rm(root, { recursive: true, force: true });
}

console.log('local-voice-runtime.verify: segmentation, install/voice gates, CPU fallback, actual backend, and concurrency OK');
