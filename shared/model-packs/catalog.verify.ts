import assert from 'node:assert/strict';

import { modelPackDefinition, modelPackFileSource } from './catalog.ts';

const pack = modelPackDefinition('kokoro-tts-local');
assert(pack, 'local Kokoro pack must exist');
assert.equal(pack.kind, 'voice');
assert.equal(pack.modelId, 'nvidia/kokoro-82M-onnx-opt');
assert.equal(pack.revision, '2c9213187a1925bd87478540b6c8cda1a49a8d52');
assert.equal(pack.license, 'Apache-2.0');
assert.equal(pack.files.length, 5, 'only runtime-required model, voices, and tokenizer files are downloaded');
assert.equal(pack.files.reduce((sum, file) => sum + file.sizeBytes, 0), pack.sizeBytes);
assert.deepEqual(pack.files.map((file) => file.path), [
  'kokoro-82m-v1.0.onnx',
  'voices.bin',
  'tokenizer/config.json',
  'tokenizer/tokenizer.json',
  'tokenizer/tokenizer_config.json',
]);
for (const file of pack.files) {
  assert.match(file.sha256, /^[a-f0-9]{64}$/);
  const source = modelPackFileSource(pack, file);
  assert.doesNotMatch(source.revision, /^(?:main|master)$/i, `${file.path} must use a pinned revision`);
}
const tokenizerSources = pack.files.slice(2).map((file) => modelPackFileSource(pack, file));
assert.ok(tokenizerSources.every((source) => source.modelId === 'onnx-community/Kokoro-82M-v1.1-zh-ONNX'));
assert.ok(tokenizerSources.every((source) => source.revision === '6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3'));
assert.equal(pack.voices?.length, 8, 'first release exposes only the tested Chinese voices');
assert.deepEqual(pack.voices?.map((voice) => voice.speakerId), [45, 46, 47, 48, 49, 50, 51, 52]);
assert.ok(pack.voices?.every((voice) => voice.languageCode === 'zh-CN'));
assert.deepEqual(pack.supportedLanguageCodes, ['zh-CN']);
assert.deepEqual(pack.runtime, {
  engine: 'onnxruntime-node',
  engineVersion: '1.27.0',
  frontend: '@uzen/kokoro-js',
  frontendVersion: '1.2.4',
  architecture: 'kokoro',
  modelPath: 'kokoro-82m-v1.0.onnx',
  voicesPath: 'voices.bin',
  tokenizerDir: 'tokenizer',
});
assert.doesNotMatch(JSON.stringify(pack), /directml|cuda|espeak-ng-data/i);

for (const [id, quantization, modelPath, sizeBytes, minimumVramMiB] of [
  ['fish-s2-pro-q6-local', 'q6_k', 's2-pro-q6_k.gguf', 4_537_494_760, 8_192],
  ['fish-s2-pro-q8-local', 'q8_0', 's2-pro-q8_0.gguf', 5_642_265_320, 10_240],
] as const) {
  const fish = modelPackDefinition(id);
  assert(fish, `${id} must exist`);
  assert.equal(fish.kind, 'voice');
  assert.equal(fish.license, 'Fish-Audio-Research-License');
  assert.equal(fish.releaseChannel, 'experimental');
  assert.equal(fish.licensePolicy?.commercialUse, 'separate-license-required');
  assert.equal(fish.licensePolicy?.acceptanceId, 'fish-audio-research-license-2026-03-07');
  assert.equal(fish.sizeBytes, sizeBytes);
  assert.equal(fish.files.reduce((sum, file) => sum + file.sizeBytes, 0), fish.sizeBytes);
  assert.equal(fish.runtime?.engine, 's2.cpp');
  if (fish.runtime?.engine !== 's2.cpp') throw new Error(`${id} must use s2.cpp`);
  assert.equal(fish.runtime.engineRevision, '2c33261938da1a41d713768b1b391b4d368d7d2c');
  assert.equal(fish.runtime.quantization, quantization);
  assert.equal(fish.runtime.modelPath, modelPath);
  assert.equal(fish.runtime.minimumVramMiB, minimumVramMiB);
  assert.equal(fish.defaultVoiceId, 'random-zh');
  assert.deepEqual(fish.supportedLanguageCodes, ['zh-CN']);
  for (const file of fish.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    const source = modelPackFileSource(fish, file);
    assert.equal(source.modelId, 'rodrigomt/s2-pro-gguf');
    assert.equal(source.revision, 'a7320690b5585b03b20ed6484b55926f3015f48d');
  }
}

const autoEdit = modelPackDefinition('smolvlm2-500m-q8-local');
assert(autoEdit, 'SmolVLM2 auto-edit reference pack must exist');
assert.equal(autoEdit.kind, 'analysis');
assert.equal(autoEdit.license, 'Apache-2.0');
assert.equal(autoEdit.revision, 'ccd7aae53bcb1997355c2f094959e72b3642ce17');
assert.equal(autoEdit.sizeBytes, 545_593_888);
assert.equal(autoEdit.files.reduce((sum, file) => sum + file.sizeBytes, 0), autoEdit.sizeBytes);
assert.equal(autoEdit.analysisRuntime?.engine, 'llama.cpp');
if (autoEdit.analysisRuntime?.engine !== 'llama.cpp') throw new Error('SmolVLM2 must use llama.cpp');
assert.equal(autoEdit.analysisRuntime.quantization, 'q8_0');
assert.equal(autoEdit.analysisRuntime.minimumBuild, 6500);
assert.deepEqual(autoEdit.files.map((file) => file.sha256), [
  '6f67b8036b2469fcd71728702720c6b51aebd759b78137a8120733b4d66438bc',
  '921dc7e259f308e5b027111fa185efcbf33db13f6e35749ddf7f5cdb60ef520b',
]);
for (const file of autoEdit.files) {
  assert.equal(modelPackFileSource(autoEdit, file).revision, autoEdit.revision);
}

console.log('model-pack-catalog.verify: pinned Kokoro, Fish S2 and Apache SmolVLM2 manifests OK');
