import assert from 'node:assert/strict';

import { autoEditHardwarePlan, autoEditReferenceSceneMetrics, buildAutoEditBatchPrompt, type AutoEditBatch } from './auto-edit-batch.ts';
import type { DesktopHardwareCapabilities } from './desktop-inference.ts';

const hardware = (description: string): DesktopHardwareCapabilities => ({
  platform: 'win32', arch: 'x64', hardwareAcceleration: true,
  cpu: { model: 'test', logicalCores: 8, totalMemoryBytes: 16 * 1024 ** 3 },
  gpus: [{ active: true, vendor: 'nvidia', description }],
  graphicsFeatures: {},
});
assert.equal(autoEditHardwarePlan(hardware('NVIDIA GeForce RTX 2060')).tier, 'rtx2060');
assert.equal(autoEditHardwarePlan(hardware('NVIDIA GeForce RTX 4060')).workerConcurrency, 2);
assert.equal(autoEditHardwarePlan(hardware('NVIDIA GeForce RTX 5060')).workerConcurrency, 3);
assert.equal(autoEditHardwarePlan(hardware('NVIDIA GeForce RTX 5090')).renderConcurrency, 1);
assert.equal(autoEditHardwarePlan(null).tier, 'low');
assert.deepEqual(autoEditReferenceSceneMetrics(10_000, [1_000, 4_000, 7_000]), {
  durationMs: 10_000, detectedCuts: 3, medianShotMs: 3_000,
  p25ShotMs: 1_000, p75ShotMs: 3_000, cutsPerMinute: 18,
});

const batch = {
  format: 'yolocut-auto-edit-batch@1', id: 'batch-a', ownerProjectId: 'p', name: 'batch',
  sourceGrantId: 'grant', status: 'running', editScript: 'cut tightly', narrationScript: 'voice copy',
  referenceAssetIds: ['reference-a'], plannerModelId: 'smolvlm2-500m-q8-local',
  workerConcurrency: 1, renderConcurrency: 1, createdAt: 1, updatedAt: 1,
  jobs: [{ id: 'job', sourceId: 'source', sourceName: 'a.mp4', sourceKind: 'video', status: 'queued', attempts: 0, createdAt: 1, updatedAt: 1 }],
} satisfies AutoEditBatch;
const prompt = buildAutoEditBatchPrompt(batch);
assert.match(prompt, /analyze_reference/);
assert.match(prompt, /禁止复制参考片素材/);
assert.match(prompt, /口播脚本/);

console.log('auto-edit-batch.verify: hardware tiers and structure-only prompt passed');
