import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { ModelPackCatalogEntry } from '../../../shared/model-packs';
import {
  installedLocalVoiceModels,
  localVoiceModelPack,
  localVoiceModels,
  preferenceVoiceModel,
  voicesForLanguage,
} from './localVoiceModel';
import {
  LOCAL_VOICE_SETTINGS_FIELDS,
  localVoiceSettingsSupported,
} from './localVoiceSettings';

const CHINESE_VOICES = [
  ['zf_xiaobei', '小北', 45, 'female'],
  ['zf_xiaoni', '小妮', 46, 'female'],
  ['zf_xiaoxiao', '小小', 47, 'female'],
  ['zf_xiaoyi', '小艺', 48, 'female'],
  ['zm_yunjian', '云剑', 49, 'male'],
  ['zm_yunxi', '云希', 50, 'male'],
  ['zm_yunxia', '云夏', 51, 'male'],
  ['zm_yunyang', '云扬', 52, 'male'],
] as const;

const kokoroFixture = {
  id: 'kokoro-tts-local',
  kind: 'voice',
  label: 'Kokoro 82M 本地中文口播',
  description: 'NVIDIA 优化 ONNX；首发稳定开放 8 个中文音色，英文与更多语言待后续验证。',
  modelId: 'nvidia/kokoro-82M-onnx-opt',
  revision: 'fixed-revision-from-backend',
  license: 'Apache-2.0',
  sizeBytes: 265 * 1024 * 1024,
  recommendedMemoryBytes: 2 * 1024 * 1024 * 1024,
  capabilities: ['完全离线语音合成', '中文口播音色'],
  files: [],
  status: 'installed',
  installedBytes: 265 * 1024 * 1024,
  runtime: {
    engine: 'onnxruntime-node',
    engineVersion: '1.27.0',
    frontend: '@uzen/kokoro-js',
    frontendVersion: '1.2.4',
    architecture: 'kokoro',
    modelPath: 'kokoro-82m-v1.0.onnx',
    voicesPath: 'voices.bin',
    tokenizerDir: 'tokenizer',
  },
  supportedLanguageCodes: ['zh-CN'],
  voices: CHINESE_VOICES.map(([id, label, speakerId, gender]) => ({
    id,
    label,
    speakerId,
    languageCode: 'zh-CN',
    gender,
  })),
  defaultVoiceId: 'zf_xiaoxiao',
  accelerationNote: 'RTX 2060 目标兼容（NVIDIA 模型卡列入测试硬件）',
} satisfies ModelPackCatalogEntry;

const model = localVoiceModelPack(kokoroFixture);
assert.ok(model);
assert.equal(model.packId, 'kokoro-tts-local');
assert.equal(model.modelId, 'nvidia/kokoro-82M-onnx-opt');
assert.equal(model.runtime, 'onnxruntime-node 1.27.0 · @uzen/kokoro-js 1.2.4');
assert.deepEqual(model.languages.map((language) => [language.id, language.label]), [
  ['zh-CN', '中文'],
]);
assert.equal(model.voices.length, 8, 'the first catalog fixture exposes only the eight backend-provided Chinese voices');
assert.deepEqual(model.hardware.devices, ['auto', 'webgpu', 'cpu']);
assert.deepEqual(model.hardware.compatibility[0], {
  label: 'RTX 2060 目标兼容（NVIDIA 模型卡列入测试硬件）',
  status: 'target',
});
assert.equal(model.hardware.cpuFallback, true);
assert.equal(model.usable, true);
assert.equal(model.releaseChannel, 'stable');
assert.deepEqual(model.runtimeStatus, {}, 'a static catalog does not invent inference history');
assert.equal(model.defaults.voice, 'zf_xiaoxiao');
assert.equal(model.defaults.language, 'zh-CN');
assert.deepEqual(voicesForLanguage(model, 'zh-CN').map((voice) => voice.id), CHINESE_VOICES.map(([id]) => id));

const absent: ModelPackCatalogEntry = { ...kokoroFixture, status: 'absent' };
const models = localVoiceModels([absent, kokoroFixture]);
assert.equal(models.length, 2);
assert.equal(installedLocalVoiceModels(models).length, 1);
assert.equal(preferenceVoiceModel(models, '')?.modelId, 'nvidia/kokoro-82M-onnx-opt');
assert.equal(preferenceVoiceModel(models, 'nvidia/kokoro-82M-onnx-opt')?.packId, 'kokoro-tts-local',
  'the saved HF modelId maps back to the installed packId');
assert.equal(preferenceVoiceModel(models, 'missing'), null, 'an unavailable configured model must fail closed');
const analysisFixture: ModelPackCatalogEntry = { ...kokoroFixture, id: 'rhythm-lite', kind: 'analysis' };
assert.equal(localVoiceModelPack(analysisFixture), null);

const fishFixture = {
  ...kokoroFixture,
  id: 'fish-s2-pro-q6-local',
  label: 'Fish Audio S2 Pro · Q6_K（实验）',
  modelId: 'fishaudio/s2-pro-s2cpp-q6-k',
  license: 'Fish-Audio-Research-License',
  releaseChannel: 'experimental',
  runtime: {
    engine: 's2.cpp',
    engineRevision: '2c33261938da1a41d713768b1b391b4d368d7d2c',
    architecture: 'fish-s2-pro',
    quantization: 'q6_k',
    modelPath: 's2-pro-q6_k.gguf',
    tokenizerPath: 'tokenizer.json',
    minimumVramMiB: 8_192,
    gpuLayers: -1,
  },
  voices: [{ id: 'random-zh', label: '随机中文音色', languageCode: 'zh-CN' }],
  defaultVoiceId: 'random-zh',
  runtimeAvailability: { available: false, reason: '运行组件未安装' },
  hardwareRecommendation: {
    tier: 'recommended',
    label: 'RTX 4060 / RTX 5060 推荐档',
    packId: 'fish-s2-pro-q6-local',
    modelId: 'fishaudio/s2-pro-s2cpp-q6-k',
    engine: 's2.cpp-cuda',
    quantization: 'q6_k',
    reason: '8–9 GB 使用 Q6_K',
  },
  detectedGpu: { name: 'NVIDIA GeForce RTX 4060', memoryMiB: 8_192, computeCapability: 8.9 },
} satisfies ModelPackCatalogEntry;
const fishModel = localVoiceModelPack(fishFixture);
assert.ok(fishModel);
assert.equal(fishModel.usable, false, 'installed weights do not bypass the external runtime integrity gate');
assert.equal(fishModel.runtime, 's2.cpp 2c332619 · GGUF Q6_K');
assert.deepEqual(fishModel.hardware.devices, ['auto', 'cuda']);
assert.equal(fishModel.hardware.cpuFallback, false);
assert.equal(fishModel.supportsSpeed, false);
assert.ok(fishModel.hardware.compatibility.some((item) => item.status === 'unsupported'));

assert.deepEqual(
  LOCAL_VOICE_SETTINGS_FIELDS.map((field) => field.name),
  ['LOCAL_VOICE_MODEL', 'LOCAL_VOICE_ID', 'LOCAL_VOICE_LANGUAGE', 'LOCAL_VOICE_SPEED', 'LOCAL_VOICE_DEVICE'],
);
assert.equal(localVoiceSettingsSupported({}), false);
assert.equal(localVoiceSettingsSupported(Object.fromEntries(
  LOCAL_VOICE_SETTINGS_FIELDS.map((field) => [field.name, '']),
)), true);

const [paneSource, adapterSource, schemaSource, vendorSource, packPaneSource, settingsSource, i18nSource, catalogSource] = await Promise.all([
  readFile(new URL('./LocalVoiceModelPane.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./localVoiceModel.ts', import.meta.url), 'utf8'),
  readFile(new URL('./settingsSchema.ts', import.meta.url), 'utf8'),
  readFile(new URL('./settingsVendorPane.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./LocalModelPackPane.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./localVoiceSettings.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../i18n/dict/en/settings.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../../shared/model-packs/catalog.ts', import.meta.url), 'utf8'),
]);

assert.doesNotMatch(paneSource + '\n' + adapterSource, /https?:|huggingface|kokoro-82/i,
  'production frontend must not embed a model URL or stable model identity');
assert.match(paneSource, /<LocalModelPackPane/);
assert.match(paneSource, /value: 'auto'[\s\S]*value: 'webgpu'[\s\S]*value: 'cuda'[\s\S]*value: 'cpu'/,
  'device preferences expose model-specific WebGPU, CUDA, and CPU choices');
assert.match(paneSource, /自动（按模型与显存）/);
assert.doesNotMatch(paneSource, /value: 'gpu'|value: 'directml'/);
assert.match(paneSource, /model\.runtimeStatus\.backend/);
assert.match(paneSource, /model\.runtimeStatus\.fallbackReason/);
assert.match(paneSource, /不根据设备偏好推断/,
  'actual backend and fallbackReason must come from backend status, never the selected preference');
assert.match(settingsSource, /defaultLabel: '自动（按模型与显存）'/);
assert.match(paneSource, /option value=\{model\.modelId\}/,
  'LOCAL_VOICE_MODEL options save the fixed backend modelId');
assert.match(paneSource, /key=\{model\.packId\}/,
  'the UI keeps packId separate for catalog/install identity');
assert.match(packPaneSource, /install\(pack\.id, licenseAccepted \? pack\.licensePolicy\?\.acceptanceId/,
  'installation actions continue to use pack.id');
assert.match(packPaneSource, /pack\.licensePolicy[\s\S]*type="checkbox"[\s\S]*查看许可证/,
  'restricted model packs require an explicit visible license acknowledgement');
assert.match(packPaneSource, /runtimeBlocked = pack\.runtimeAvailability\?\.available === false[\s\S]*disabled=\{busy \|\| runtimeBlocked/,
  'weights cannot be installed while the separately licensed runtime is unavailable');
assert.match(paneSource, /disabled=\{!model\.usable\}/,
  'uninstalled or runtime-unavailable catalog models must remain non-selectable');
assert.match(paneSource, /localVoiceSettingsSupported\(ctx\.status\?\.models\)/,
  'configuration must stay read-only until the backend exposes all setting keys');
assert.match(adapterSource, /entry\.kind !== 'voice'/);
assert.doesNotMatch(adapterSource, /as unknown|type JsonRecord|\braw\./,
  'the UI adapter must use the formal shared ModelPackCatalogEntry contract');
assert.match(adapterSource, /status: 'target'/,
  'RTX 2060 compatibility is target-only');
assert.match(adapterSource, /entry\.source\.hardwareRecommendation|source\.hardwareRecommendation|hardwareRecommendation/,
  'an empty saved preference may select the live hardware recommendation');
assert.match(schemaSource, /key: 'local\/voice'[\s\S]*?fields: LOCAL_VOICE_SETTINGS_FIELDS/);
assert.match(vendorSource, /page\.key === 'local\/voice'[\s\S]*?<LocalVoiceModelPane ctx=\{ctx\}/);
assert.match(packPaneSource, /visiblePacks\.length === 0 && emptyState/);
assert.match(packPaneSource, /pack\.status === 'downloading' && <PackProgress/);
assert.match(packPaneSource, /pack\.status === 'error'/);
assert.match(packPaneSource, /role="alert"/);
assert.match(catalogSource, /readonly kind: ModelPackKind/);
assert.match(catalogSource, /readonly voices\?: readonly ModelPackVoice\[\]/);
assert.match(catalogSource, /readonly source\?: ModelPackFileSource/);
assert.match(catalogSource, /interface KokoroModelPackRuntime[\s\S]*engine: 'onnxruntime-node'[\s\S]*frontend: '@uzen\/kokoro-js'/);
assert.match(catalogSource, /interface FishS2ModelPackRuntime[\s\S]*engine: 's2\.cpp'[\s\S]*quantization: 'q6_k' \| 'q8_0'/);
assert.match(catalogSource, /readonly runtimeStatus\?: ModelPackRuntimeStatus/);
assert.match(i18nSource, /RTX 2060 目标兼容（NVIDIA 模型卡列入测试硬件）/);
assert.doesNotMatch(i18nSource, /Windows\/Turing\/RTX 2060 官方实测|53 个音色|53 voices|Multilingual voices/,
  'first-launch copy must not claim RTX acceptance, 53 voices, or fixed multilingual support');

console.log('local-voice-model.verify: formal voice catalog, modelId settings, WebGPU/CPU status, and target compatibility passed');
