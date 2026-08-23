export const KOKORO_LOCAL_MODEL_ID = 'nvidia/kokoro-82M-onnx-opt';
export const FISH_S2_Q6_LOCAL_MODEL_ID = 'fishaudio/s2-pro-s2cpp-q6-k';
export const FISH_S2_Q8_LOCAL_MODEL_ID = 'fishaudio/s2-pro-s2cpp-q8-0';

export type LocalVoiceHardwareTier = 'unsupported' | 'minimum' | 'recommended' | 'performance';
export type LocalVoiceRecommendedPackId =
  | 'kokoro-tts-local'
  | 'fish-s2-pro-q6-local'
  | 'fish-s2-pro-q8-local';
export type FishS2Quantization = 'q6_k' | 'q8_0';

export interface LocalNvidiaGpuProfile {
  readonly name: string;
  readonly memoryMiB: number;
  readonly computeCapability: number;
}

export interface LocalVoiceHardwareRecommendation {
  readonly tier: LocalVoiceHardwareTier;
  readonly label: string;
  readonly packId: LocalVoiceRecommendedPackId;
  readonly modelId: string;
  readonly engine: 'kokoro-webgpu' | 's2.cpp-cuda';
  readonly quantization?: FishS2Quantization;
  readonly reason: string;
}

export interface LocalVoiceHardwareSnapshot {
  readonly gpus: readonly LocalNvidiaGpuProfile[];
  readonly selectedGpu: LocalNvidiaGpuProfile | null;
  readonly recommendation: LocalVoiceHardwareRecommendation;
}

const MINIMUM_VRAM_MIB = 6_144;
const RECOMMENDED_VRAM_MIB = 8_192;
const Q8_VRAM_MIB = 10_240;
const MINIMUM_COMPUTE = 7.5;

/** Parse the four-digit RTX family without treating a marketing name as a VRAM claim. */
export function rtxGeneration(name: string): number | undefined {
  const match = /\bRTX\s*(\d{4})\b/i.exec(name);
  if (!match) return undefined;
  const model = Number(match[1]);
  return Number.isInteger(model) ? Math.floor(model / 1_000) : undefined;
}

/**
 * Product policy, intentionally stricter than whether a community runtime can
 * technically start. RTX 2060/6 GB is the minimum stable Kokoro tier. RTX 40
 * and 50 series move to Fish S2 Pro only when measured VRAM meets the selected
 * GGUF floor; 10+ GB prefers Q8_0, otherwise 8–9 GB uses Q6_K.
 */
export function recommendLocalVoiceHardware(
  gpu: LocalNvidiaGpuProfile | null,
): LocalVoiceHardwareRecommendation {
  if (!gpu || gpu.memoryMiB < MINIMUM_VRAM_MIB || gpu.computeCapability < MINIMUM_COMPUTE) {
    return {
      tier: 'unsupported',
      label: '未达到 RTX 2060 最低 GPU 标准',
      packId: 'kokoro-tts-local',
      modelId: KOKORO_LOCAL_MODEL_ID,
      engine: 'kokoro-webgpu',
      reason: '需要 NVIDIA compute capability 7.5+ 与至少 6 GB 显存；仍可手动使用 Kokoro CPU 回退。',
    };
  }

  const generation = rtxGeneration(gpu.name);
  const fishGeneration = generation !== undefined && generation >= 4;
  if (fishGeneration && gpu.memoryMiB >= Q8_VRAM_MIB) {
    return {
      tier: 'performance',
      label: 'RTX 5060+ / 大显存性能档',
      packId: 'fish-s2-pro-q8-local',
      modelId: FISH_S2_Q8_LOCAL_MODEL_ID,
      engine: 's2.cpp-cuda',
      quantization: 'q8_0',
      reason: 'RTX 40/50 系且实测显存至少 10 GB，优先 s2.cpp + Q8_0。',
    };
  }
  if (fishGeneration && gpu.memoryMiB >= RECOMMENDED_VRAM_MIB) {
    return {
      tier: 'recommended',
      label: 'RTX 4060 / RTX 5060 推荐档',
      packId: 'fish-s2-pro-q6-local',
      modelId: FISH_S2_Q6_LOCAL_MODEL_ID,
      engine: 's2.cpp-cuda',
      quantization: 'q6_k',
      reason: 'RTX 40/50 系且实测显存为 8–9 GB，使用 s2.cpp + Q6_K；大显存再升级 Q8_0。',
    };
  }
  return {
    tier: 'minimum',
    label: 'RTX 2060 最低兼容档',
    packId: 'kokoro-tts-local',
    modelId: KOKORO_LOCAL_MODEL_ID,
    engine: 'kokoro-webgpu',
    reason: '已达到 6 GB/Turing 最低线；稳定默认使用 Kokoro WebGPU，Fish S2 Pro 从 RTX 4060 档开始推荐。',
  };
}
