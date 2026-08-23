import assert from 'node:assert/strict';
import { join } from 'node:path';
import { minimaxVoiceBody, minimaxVoiceResult } from './voice-providers.ts';
import { validateVoiceRequest } from './voice.ts';
import { generateAiVoice } from './voice-ai-sdk.ts';
import { generateLocalVoice } from './voice-local.ts';
import { voiceAssetPath } from './voice-media.ts';
import type { VoiceOptions } from './voice-types.ts';

assert.equal(
  voiceAssetPath(join('C:', 'yolocut', 'media', 'voice.wav')),
  '/media/uploads/voice.wav',
  'voice media URL keeps only the platform-native filename',
);

const mm = validateVoiceRequest({
  provider: 'minimax',
  text: '你好',
  voiceId: '',
  speed: 1.1,
  pitch: -2,
  volume: 1.5,
  emotion: 'calm',
  sampleRate: 44_100,
  audioFormat: 'flac',
  channel: 2,
  languageBoost: 'Chinese',
  textNormalization: true,
  pronunciations: ['YoloCut/(open chat cut)'],
  timbreWeights: [{ voiceId: 'female-yujie', weight: 70 }, { voiceId: 'female-shaonv', weight: 30 }],
  voiceModify: { pitch: 10, intensity: -10, effect: 'robotic' },
  subtitleEnable: true,
});
assert.equal(mm.provider, 'minimax');
assert.equal(mm.pitch, -2);
assert.equal(mm.volume, 1.5);
assert.equal(mm.audioFormat, 'flac');
assert.equal(mm.timbreWeights?.length, 2);
const mmBody = minimaxVoiceBody('speech-2.6-hd', mm);
assert.equal((mmBody.voice_setting as Record<string, unknown>).text_normalization, true);
assert.equal(mmBody.text_normalization, undefined);
assert.equal((mmBody.audio_setting as Record<string, unknown>).bitrate, undefined);

const streamed = validateVoiceRequest({
  provider: 'minimax', text: 'stream it', voiceId: 'female-yujie', audioFormat: 'mp3', stream: true,
  forceCbr: true, excludeAggregatedAudio: true, subtitleEnable: true, subtitleType: 'word_streaming',
});
const streamedBody = minimaxVoiceBody('speech-2.6-hd', streamed);
assert.equal(streamedBody.stream, true);
assert.equal((streamedBody.stream_options as Record<string, unknown>).exclude_aggregated_audio, true);
assert.equal((streamedBody.audio_setting as Record<string, unknown>).force_cbr, true);
const sse = [
  'data: {"data":{"audio":"6162","status":1},"base_resp":{"status_code":0}}',
  'data: {"data":{"audio":"63","status":1},"base_resp":{"status_code":0}}',
  'data: {"data":{"status":2,"subtitle_file":"https://example.com/subtitles.json"},"base_resp":{"status_code":0}}',
  'data: [DONE]',
].join('\n');
const parsed = minimaxVoiceResult(sse, true, true);
assert.equal(parsed.audio.toString(), 'abc');
assert.equal(parsed.subtitleUrl, 'https://example.com/subtitles.json');

assert.throws(
  () => validateVoiceRequest({ provider: 'minimax', text: 'x', voiceId: 'a', volume: 11 }),
  /greater than 0 and at most 10/,
);
assert.throws(
  () => validateVoiceRequest({ provider: 'minimax', text: 'x', voiceId: 'a', pitch: 13 }),
  /pitch must be between -12 and 12/,
);
assert.throws(
  () => validateVoiceRequest({ provider: 'minimax', text: 'x', voiceId: 'a', audioFormat: 'flac', bitrate: 128_000 }),
  /bitrate applies to MP3 only/,
);
assert.throws(
  () => validateVoiceRequest({ provider: 'minimax', text: 'x', voiceId: 'a', forceCbr: true }),
  /forceCbr requires stream=true and audioFormat=mp3/,
);
assert.throws(
  () => validateVoiceRequest({ provider: 'minimax', text: 'x', voiceId: 'a', subtitleType: 'word' }),
  /subtitleType requires subtitleEnable=true/,
);
assert.throws(
  () => validateVoiceRequest({ provider: 'minimax', text: 'x', voiceId: 'a', languageBoost: 'Klingon' as never }),
  /unsupported MiniMax languageBoost/,
);
const eleven = validateVoiceRequest({
  provider: 'elevenlabs', text: 'Hello', voiceId: 'peter', similarityBoost: 0.8,
  style: 0.2, useSpeakerBoost: true, languageCode: 'en', seed: 42,
  outputFormat: 'wav_44100', optimizeStreamingLatency: 2, enableLogging: false,
  applyTextNormalization: 'on', previousText: 'Before', nextText: 'After',
  pronunciationDictionaryLocators: [{ pronunciationDictionaryId: 'dict', versionId: 'v1' }],
});
assert.equal(eleven.outputFormat, 'wav_44100');
assert.equal(eleven.seed, 42);
assert.throws(
  () => validateVoiceRequest({ provider: 'elevenlabs', text: 'hi', voiceId: 'peter', outputFormat: 'wav' }),
  /unsupported ElevenLabs outputFormat/,
);
assert.throws(
  () => validateVoiceRequest({ provider: 'minimax', text: 'x', voiceId: 'a', emotion: 'calm', emotionScale: 2 }),
  /MiniMax does not accept ElevenLabs\/Doubao-only/,
);
assert.throws(
  () => validateVoiceRequest({ provider: 'elevenlabs', text: 'hi', voiceId: 'peter', volume: 2 }),
  /ElevenLabs does not accept/,
);

const doubao = validateVoiceRequest({
  provider: 'doubao',
  text: '你好',
  voiceId: 'vivi',
  pitch: 1,
  emotion: 'happy',
  emotionScale: 3,
});
assert.equal(doubao.provider, 'doubao');

const inworld = validateVoiceRequest({ provider: 'inworld', text: 'Hello', voiceId: 'Dennis', modelId: 'inworld-tts-2' });
assert.equal(inworld.provider, 'inworld');
assert.equal(inworld.modelId, 'inworld-tts-2');
assert.throws(
  () => validateVoiceRequest({ provider: 'inworld', text: 'x'.repeat(2_001), voiceId: 'Dennis' }),
  /Inworld TTS text must be at most 2000 characters/,
);
assert.throws(
  () => validateVoiceRequest({ provider: 'inworld', text: 'hi', voiceId: 'Dennis', pitch: 1 }),
  /Inworld only accepts text, voiceId, and modelId/,
);

const fishAudio = validateVoiceRequest({ provider: 'fishaudio', text: 'Hello', voiceId: 'ref-123' });
assert.equal(fishAudio.provider, 'fishaudio');
assert.throws(
  () => validateVoiceRequest({ provider: 'fishaudio', text: 'hi', voiceId: 'ref-123', emotion: 'calm' }),
  /Fish Audio only accepts text, voiceId, and modelId/,
);

const speechify = validateVoiceRequest({ provider: 'speechify', text: 'Hello', voiceId: 'george', modelId: 'simba-english' });
assert.equal(speechify.provider, 'speechify');
assert.throws(
  () => validateVoiceRequest({ provider: 'speechify', text: 'hi', voiceId: 'george', volume: 2 }),
  /Speechify only accepts text, voiceId, and modelId/,
);

const local = validateVoiceRequest({
  provider: 'local',
  text: '本地口播',
  modelId: 'nvidia/kokoro-82M-onnx-opt',
  voiceId: 'zf_xiaobei',
  languageCode: 'zh-CN',
  speed: 1.05,
  devicePreference: 'webgpu',
  name: '离线旁白',
});
assert.equal(local.provider, 'local');
assert.equal(local.modelId, 'nvidia/kokoro-82M-onnx-opt');
assert.equal(local.languageCode, 'zh-CN');
assert.equal(local.devicePreference, 'webgpu');
assert.equal(local.outputFormat, 'wav', 'local output is normalized to the WAV media-pool contract');
assert.throws(
  () => validateVoiceRequest({ provider: 'local', text: 'hi', voiceId: 'zf_xiaobei', languageCode: 'zh-CN' }),
  /local modelId is required/,
);
assert.throws(
  () => validateVoiceRequest({
    provider: 'local', text: 'hi', modelId: 'nvidia/kokoro-82M-onnx-opt', voiceId: 'zf_xiaobei',
  }),
  /local languageCode is required/,
);
assert.throws(
  () => validateVoiceRequest({
    provider: 'local', text: 'hi', modelId: 'nvidia/kokoro-82M-onnx-opt', voiceId: 'zf_xiaobei',
    languageCode: 'zh-CN', stability: 0.5,
  }),
  /Local voice does not accept parameter\(s\): stability/,
);
for (const removedPreference of ['directml', 'cuda-hybrid', 'gpu']) {
  assert.throws(
    () => validateVoiceRequest({
      provider: 'local', text: 'hi', modelId: 'nvidia/kokoro-82M-onnx-opt', voiceId: 'zf_xiaobei',
      languageCode: 'zh-CN', devicePreference: removedPreference as never,
    }),
    /devicePreference must be auto, webgpu, cuda, or cpu/,
    `${removedPreference} must be rejected by the local voice request contract`,
  );
}
assert.equal(validateVoiceRequest({
  provider: 'local', text: 'Fish S2', modelId: 'fishaudio/s2-pro-s2cpp-q6-k',
  voiceId: 'random-zh', languageCode: 'zh-CN', devicePreference: 'cuda',
}).devicePreference, 'cuda');
assert.throws(
  () => validateVoiceRequest({ provider: 'openai', text: 'hi', voiceId: 'alloy', devicePreference: 'webgpu' }),
  /does not accept local-only devicePreference/,
);

const aiOptions: VoiceOptions = {
  elevenBaseUrl: '', elevenApiKey: '', elevenModel: '',
  doubaoBaseUrl: '', doubaoAppId: '', doubaoAccessKey: '', doubaoResourceId: '',
  minimaxBaseUrl: '', minimaxApiKey: '', minimaxModel: '',
  inworldBaseUrl: '', inworldApiKey: '', inworldModel: '',
  fishAudioBaseUrl: '', fishAudioApiKey: '', fishAudioModel: '',
  speechifyBaseUrl: '', speechifyApiKey: '', speechifyModel: '',
  ai: {
    openaiBaseUrl: 'https://api.openai.test',
    openaiApiKey: 'openai-test-key',
    openaiModel: 'gpt-4o-mini-tts',
    geminiBaseUrl: 'https://generativelanguage.googleapis.test',
    geminiApiKey: 'gemini-test-key',
    geminiModel: 'gemini-2.5-flash-preview-tts',
    mistralBaseUrl: 'https://api.mistral.test/v1',
    mistralApiKey: 'mistral-test-key',
    mistralModel: 'voxtral-mini-tts-2603',
    cartesiaApiKey: 'cartesia-test-key',
    cartesiaModel: 'sonic-3',
  },
};
await assert.rejects(
  () => generateLocalVoice(aiOptions, local),
  /设置 → 本地模型 → 本地口播.*不会自动下载模型/,
  'missing local backend fails closed without a download side effect',
);
const localAudio = await generateLocalVoice({
  ...aiOptions,
  localVoiceGenerator: async (input) => ({
    bytes: Buffer.from('wav-fixture'),
    codec: 'wav',
    sampleRate: 24_000,
    modelId: input.modelId!,
    modelRevision: '2c9213187a1925bd87478540b6c8cda1a49a8d52',
    voiceId: input.voiceId,
    languageCode: input.languageCode,
    speed: input.speed,
    inferenceBackend: 'cpu',
  }),
}, local);
assert.equal(localAudio.inferenceBackend, 'cpu', 'adapter preserves the actual CPU backend instead of requested WebGPU');
assert.equal(localAudio.fallbackReason, undefined, 'adapter never invents fallback metadata when the backend omits it');
assert.equal(localAudio.modelId, 'nvidia/kokoro-82M-onnx-opt');
const webGpuAudio = await generateLocalVoice({
  ...aiOptions,
  localVoiceGenerator: async (input) => ({
    bytes: Buffer.from('wav-webgpu-fixture'), codec: 'wav', sampleRate: 24_000,
    modelId: input.modelId!, voiceId: input.voiceId, languageCode: input.languageCode,
    inferenceBackend: 'webgpu',
  }),
}, local);
assert.equal(webGpuAudio.inferenceBackend, 'webgpu', 'WebGPU execution is accepted and preserved verbatim');
const cudaHybridAudio = await generateLocalVoice({
  ...aiOptions,
  localVoiceGenerator: async (input) => ({
    bytes: Buffer.from('wav-cuda-fixture'), codec: 'wav', sampleRate: 44_100,
    modelId: input.modelId!, voiceId: input.voiceId, languageCode: input.languageCode,
    inferenceBackend: 'cuda-hybrid',
  }),
}, local);
assert.equal(cudaHybridAudio.inferenceBackend, 'cuda-hybrid');
await assert.rejects(
  () => generateLocalVoice({
    ...aiOptions,
    localVoiceGenerator: async (input) => ({
      bytes: Buffer.from('wav-fixture'), codec: 'wav', sampleRate: 24_000,
      modelId: 'invented/model', voiceId: input.voiceId, languageCode: input.languageCode,
      inferenceBackend: 'webgpu',
    }),
  }, local),
  /did not confirm the requested modelId/,
  'backend cannot silently substitute a different local model',
);
await assert.rejects(
  () => generateLocalVoice({
    ...aiOptions,
    localVoiceGenerator: async (input) => ({
      bytes: Buffer.from('wav-fixture'), codec: 'wav', sampleRate: 24_000,
      modelId: input.modelId!, voiceId: input.voiceId, languageCode: input.languageCode,
      inferenceBackend: 'cuda' as never,
    }),
  }, local),
  /inferenceBackend as webgpu, cuda-hybrid, or cpu/,
  'ambiguous CUDA execution labels cannot enter result/audit metadata',
);
const openAiRequest = validateVoiceRequest({
  provider: 'openai',
  text: 'Hello from YoloCut',
  voiceId: 'alloy',
  instructions: 'Speak calmly',
  speed: 1.1,
  outputFormat: 'mp3',
});
const originalFetch = globalThis.fetch;
try {
  let requestSeen = false;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    assert.equal(url, 'https://api.openai.test/v1/audio/speech');
    assert.equal(init?.method, 'POST');
    assert.equal(typeof init?.body, 'string');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    assert.equal(body.model, 'gpt-4o-mini-tts');
    assert.equal(body.voice, 'alloy');
    assert.equal(body.instructions, 'Speak calmly');
    requestSeen = true;
    return new Response(Buffer.from([1, 2, 3]), {
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  };
  const generated = await generateAiVoice(aiOptions, openAiRequest);
  assert.equal(requestSeen, true);
  assert.deepEqual([...generated.bytes], [1, 2, 3]);
  assert.equal(generated.codec, 'mp3');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('voice.verify: ok (provider validation + OpenAI AI SDK request)');
