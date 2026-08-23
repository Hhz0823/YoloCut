import assert from 'node:assert/strict';

import { buildOperation, buildProposal } from '../proposal';
import { routedToolNames } from '../tool-routing';
import { activeTimeline, type TimelineState } from '../../editor/types';
import { historyReduce, type History } from '../../editor/reduce';
import { makeDraft, replayActions } from '../../editor/store';
import { localVoiceAuditFromAsset, submitVoice } from '../../generate/voice';
import { applyLiveLocalVoiceCapabilities } from '../../generate/local-voice-status';
import { docFromTimeline } from '../../persist/projectStore';
import { buildSubmitVoiceArgs } from './generate-tool-input';

const timeline = {
  fps: 30,
  width: 854,
  height: 480,
  items: [],
  selectedId: null,
  trackOrder: ['track_v1', 'track_a1'],
  tracks: {
    track_v1: { kind: 'video' },
    track_a1: { kind: 'audio' },
  },
} as TimelineState;

const localArgs = buildSubmitVoiceArgs({
  provider: 'local',
  text: '欢迎使用本地口播。',
  name: '本地口播 · 欢迎',
  modelId: 'nvidia/kokoro-82M-onnx-opt',
  voiceId: 'zf_xiaobei',
  languageCode: 'zh-CN',
  speed: 1,
  devicePreference: 'webgpu',
  stability: 0.8,
  outputFormat: 'mp3',
});

assert.ok(
  routedToolNames('请用本地口播生成这段旁白', false).has('submit_voice'),
  'local narration requests route to the real voice generation tool',
);

const originalFetch = globalThis.fetch;
let requests = 0;
let reportedBackend = 'cpu';
try {
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(body).sort(),
      ['devicePreference', 'languageCode', 'modelId', 'name', 'provider', 'speed', 'text', 'voiceId'].sort(),
      'local generation HTTP request contains only common/local-whitelisted fields',
    );
    assert.equal(
      body.devicePreference,
      body.modelId === 'fishaudio/s2-pro-s2cpp-q6-k' ? 'cuda' : 'webgpu',
      'request records the model-specific preference without treating it as actual execution',
    );
    return new Response(JSON.stringify({
      path: '/media/uploads/local-kokoro.wav',
      durationSeconds: 1.2,
      modelId: body.modelId,
      modelRevision: '2c9213187a1925bd87478540b6c8cda1a49a8d52',
      voiceId: body.voiceId,
      languageCode: body.languageCode,
      speed: body.speed,
      inferenceBackend: reportedBackend,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  applyLiveLocalVoiceCapabilities(null);
  await assert.rejects(
    () => submitVoice(localArgs, timeline),
    /设置 → 本地模型 → 本地口播.*不会自动下载模型/,
    'missing catalog stops before generation and gives the exact install guidance',
  );
  assert.equal(requests, 0, 'missing local model never calls generation and cannot trigger a hidden download');

  applyLiveLocalVoiceCapabilities({
    models: [{
      modelId: 'nvidia/kokoro-82M-onnx-opt',
      label: 'NVIDIA Kokoro 82M ONNX',
      status: 'installed',
      revision: '2c9213187a1925bd87478540b6c8cda1a49a8d52',
      license: 'Apache-2.0',
      voices: [
        { voiceId: 'zf_xiaobei', label: '小北', languageCodes: ['zh-CN'], previewUrl: '/local-voice/previews/zf_xiaobei.wav' },
      ],
    }],
  });

  await assert.rejects(
    () => submitVoice({ ...localArgs, voiceId: 'invented-voice' }, timeline),
    /不在已安装模型.*可用清单.*确认音色/,
    'an invented voice cannot pass the installed/confirmed catalog gate',
  );
  assert.equal(requests, 0, 'invalid voice selection is rejected before inference');

  const asset = await submitVoice(localArgs, timeline);
  assert.equal(requests, 1, 'confirmed local selection invokes the generation endpoint exactly once');
  assert.equal(asset.kind, 'audio');
  assert.equal(asset.src, '/media/uploads/local-kokoro.wav');
  assert.equal(asset.durationInFrames, 36);
  const audit = localVoiceAuditFromAsset(asset);
  assert.equal(audit?.modelId, 'nvidia/kokoro-82M-onnx-opt');
  assert.equal(audit?.requestedDevicePreference, 'webgpu');
  assert.equal(audit?.inferenceBackend, 'cpu', 'CPU execution is audited as CPU, never as the requested WebGPU backend');
  assert.equal(audit?.fallbackReason, undefined, 'frontend never invents fallback metadata from a preference/backend mismatch');

  reportedBackend = 'cuda';
  await assert.rejects(
    () => submitVoice(localArgs, timeline),
    /inferenceBackend as webgpu, cuda-hybrid, or cpu/,
    'an ambiguous CUDA label cannot enter the media asset audit; s2.cpp must report cuda-hybrid',
  );

  applyLiveLocalVoiceCapabilities({
    models: [{
      modelId: 'fishaudio/s2-pro-s2cpp-q6-k',
      label: 'Fish Audio S2 Pro Q6_K',
      status: 'installed',
      revision: 'a7320690b5585b03b20ed6484b55926f3015f48d',
      license: 'Fish-Audio-Research-License',
      releaseChannel: 'experimental',
      runtimeAvailable: true,
      voices: [{ voiceId: 'random-zh', label: '随机中文音色', languageCodes: ['zh-CN'] }],
    }],
  });
  reportedBackend = 'cuda-hybrid';
  const fishAsset = await submitVoice({
    ...localArgs,
    modelId: 'fishaudio/s2-pro-s2cpp-q6-k',
    voiceId: 'random-zh',
    devicePreference: 'cuda',
  }, timeline);
  const fishAudit = localVoiceAuditFromAsset(fishAsset);
  assert.equal(fishAudit?.modelId, 'fishaudio/s2-pro-s2cpp-q6-k');
  assert.equal(fishAudit?.requestedDevicePreference, 'cuda');
  assert.equal(fishAudit?.inferenceBackend, 'cuda-hybrid');

  // Generation persists the media-pool asset separately. Timeline placement is
  // drafted only after an explicit placement request, then approved as one
  // tl.setDoc history action and undone without deleting the generated asset.
  const base = docFromTimeline(timeline);
  const withAsset = replayActions(base, [{ type: 'addAsset', asset }]);
  assert.equal(withAsset.assets.length, 1, 'generated local voice enters the media pool');
  assert.equal(activeTimeline(withAsset).items.length, 0, 'generation alone does not touch the timeline');

  const draft = makeDraft(withAsset);
  draft.commands.addMediaItem(asset, { track: 'track_a1', startFrame: 30 });
  const placementActions = draft.takeActions();
  const proposal = buildProposal(
    [buildOperation('edit_item', { type: 'audio', assetId: asset.id, trackId: 'track_a1', fromFrame: 30 }, placementActions)],
    '把已确认的本地口播放到音频轨',
    withAsset,
    draft.getState(),
  );
  assert.equal(activeTimeline(withAsset).items.length, 0, 'pending manual proposal leaves persisted timeline unchanged');
  assert.equal(proposal.options[0]?.operations.length, 1, 'placement is represented by one reviewable operation');

  const reviewedDoc = replayActions(withAsset, proposal.options[0]!.operations.flatMap((operation) => operation.actions));
  let history: History = { past: [], present: withAsset, future: [] };
  history = historyReduce(history, { type: 'tl.setDoc', doc: reviewedDoc });
  assert.equal(history.past.length, 1, 'reviewed placement applies as one atomic history action');
  assert.equal(activeTimeline(history.present).items.length, 1);
  assert.equal(activeTimeline(history.present).items[0]?.track, 'track_a1');

  history = historyReduce(history, { type: 'undo' });
  assert.equal(activeTimeline(history.present).items.length, 0, 'one undo rolls back the whole placement');
  assert.equal(history.present.assets[0]?.id, asset.id, 'undoing placement preserves the generated media-pool asset');
} finally {
  globalThis.fetch = originalFetch;
  applyLiveLocalVoiceCapabilities(null);
}

console.log('local-voice-workflow.verify: local catalog gate + asset audit + atomic proposal apply/undo ok');
