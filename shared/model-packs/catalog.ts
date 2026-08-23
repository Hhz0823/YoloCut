import {
  FISH_S2_Q6_LOCAL_MODEL_ID,
  FISH_S2_Q8_LOCAL_MODEL_ID,
  type LocalNvidiaGpuProfile,
  type LocalVoiceHardwareRecommendation,
} from '../local-voice-hardware.ts';

export type ModelPackId =
  | 'rhythm-lite'
  | 'music-semantics-lite'
  | 'visual-semantics-lite'
  | 'smolvlm2-500m-q8-local'
  | 'kokoro-tts-local'
  | 'fish-s2-pro-q6-local'
  | 'fish-s2-pro-q8-local';

export type ModelPackKind = 'analysis' | 'voice';

export type ModelPackCapability =
  | '节拍定位'
  | '下拍定位'
  | 'BPM 与拍号'
  | '节拍能量'
  | '音乐语义向量'
  | '音乐相似度'
  | '画面语义向量'
  | '中文画面检索'
  | '重复镜头检测'
  | '参考成片结构分析'
  | '镜头节奏描述'
  | '字幕与转场风格提取'
  | '完全离线语音合成'
  | '中文口播音色'
  | '多语言情绪口播'
  | '自然语言行内控制';

export type ModelPackLicense = 'MIT' | 'Apache-2.0' | 'Fish-Audio-Research-License';
export type ModelPackReleaseChannel = 'stable' | 'experimental';

export interface ModelPackLicensePolicy {
  readonly acceptanceId: string;
  readonly url: string;
  readonly notice: string;
  readonly commercialUse: 'permitted' | 'separate-license-required';
}

export interface ModelPackFileSource {
  readonly modelId: string;
  readonly revision: string;
  readonly path: string;
}

export interface ModelPackFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  /** Omit when the file comes from the pack's primary modelId/revision/path. */
  readonly source?: ModelPackFileSource;
}

export interface ModelPackVoice {
  readonly id: string;
  readonly label: string;
  readonly speakerId?: number;
  readonly languageCode: string;
  readonly gender?: 'female' | 'male';
}

export interface KokoroModelPackRuntime {
  readonly engine: 'onnxruntime-node';
  readonly engineVersion: '1.27.0';
  readonly frontend: '@uzen/kokoro-js';
  readonly frontendVersion: '1.2.4';
  readonly architecture: 'kokoro';
  readonly modelPath: string;
  readonly voicesPath: string;
  readonly tokenizerDir: string;
}

export interface FishS2ModelPackRuntime {
  readonly engine: 's2.cpp';
  readonly engineRevision: '2c33261938da1a41d713768b1b391b4d368d7d2c';
  readonly architecture: 'fish-s2-pro';
  readonly quantization: 'q6_k' | 'q8_0';
  readonly modelPath: string;
  readonly tokenizerPath: string;
  readonly minimumVramMiB: number;
  readonly gpuLayers: -1;
}

export interface LlamaCppVisionModelPackRuntime {
  readonly engine: 'llama.cpp';
  readonly minimumBuild: 6500;
  readonly architecture: 'smolvlm2';
  readonly quantization: 'q8_0';
  readonly modelPath: string;
  readonly mmprojPath: string;
  readonly minimumVramMiB: 2_048;
  readonly gpuLayers: 99;
}

export type VoiceModelPackRuntime = KokoroModelPackRuntime | FishS2ModelPackRuntime;
export type AnalysisModelPackRuntime = LlamaCppVisionModelPackRuntime;
export type ModelPackRuntime = VoiceModelPackRuntime | AnalysisModelPackRuntime;
export type ModelPackInferenceBackend = 'webgpu' | 'cuda-hybrid' | 'cpu';

export interface ModelPackRuntimeStatus {
  /** Actual backend reported by the latest inference run, never the preference. */
  readonly backend: ModelPackInferenceBackend;
  readonly fallbackReason?: string;
}

export interface ModelPackRuntimeAvailability {
  readonly available: boolean;
  readonly reason?: string;
}

export interface ModelPackDefinition {
  readonly id: ModelPackId;
  readonly kind: ModelPackKind;
  readonly label: string;
  readonly description: string;
  readonly modelId: string;
  readonly revision: string;
  readonly license: ModelPackLicense;
  readonly licensePolicy?: ModelPackLicensePolicy;
  readonly releaseChannel?: ModelPackReleaseChannel;
  readonly sizeBytes: number;
  readonly recommendedMemoryBytes: number;
  readonly capabilities: readonly ModelPackCapability[];
  readonly files: readonly ModelPackFile[];
  readonly voices?: readonly ModelPackVoice[];
  readonly defaultVoiceId?: string;
  readonly supportedLanguageCodes?: readonly string[];
  readonly accelerationNote?: string;
  readonly runtime?: VoiceModelPackRuntime;
  readonly analysisRuntime?: AnalysisModelPackRuntime;
}

export type ModelPackStatus = 'absent' | 'downloading' | 'installed' | 'error';

export interface ModelPackTask {
  readonly id: ModelPackId;
  readonly status: Exclude<ModelPackStatus, 'absent'>;
  readonly bytesDone: number;
  readonly bytesTotal: number;
  readonly filesDone: number;
  readonly filesTotal: number;
  readonly error?: string;
}

export interface ModelPackCatalogEntry extends ModelPackDefinition {
  readonly status: ModelPackStatus;
  readonly installedBytes: number;
  readonly task?: ModelPackTask;
  readonly error?: string;
  readonly runtimeStatus?: ModelPackRuntimeStatus;
  readonly runtimeAvailability?: ModelPackRuntimeAvailability;
  readonly hardwareRecommendation?: LocalVoiceHardwareRecommendation;
  readonly detectedGpu?: LocalNvidiaGpuProfile;
}

const GIB = 1024 * 1024 * 1024;

const KOKORO_TOKENIZER_SOURCE = {
  modelId: 'onnx-community/Kokoro-82M-v1.1-zh-ONNX',
  revision: '6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3',
} as const;

const FISH_S2_SOURCE = {
  modelId: 'rodrigomt/s2-pro-gguf',
  revision: 'a7320690b5585b03b20ed6484b55926f3015f48d',
} as const;

const FISH_S2_LICENSE_POLICY = {
  acceptanceId: 'fish-audio-research-license-2026-03-07',
  url: 'https://huggingface.co/rodrigomt/s2-pro-gguf/blob/a7320690b5585b03b20ed6484b55926f3015f48d/LICENSE.md',
  notice: '仅限研究与非商业使用；商业使用必须另行取得 Fish Audio 的书面许可。s2.cpp 为社区 alpha 组件。',
  commercialUse: 'separate-license-required',
} as const satisfies ModelPackLicensePolicy;

const KOKORO_VOICE_ROWS = [
  ['zf_xiaobei', '小北', 45, 'female'],
  ['zf_xiaoni', '小妮', 46, 'female'],
  ['zf_xiaoxiao', '小小', 47, 'female'],
  ['zf_xiaoyi', '小艺', 48, 'female'],
  ['zm_yunjian', '云剑', 49, 'male'],
  ['zm_yunxi', '云希', 50, 'male'],
  ['zm_yunxia', '云夏', 51, 'male'],
  ['zm_yunyang', '云扬', 52, 'male'],
] as const satisfies readonly (readonly [string, string, number, 'female' | 'male'])[];

const KOKORO_VOICES: readonly ModelPackVoice[] = KOKORO_VOICE_ROWS.map(
  ([id, label, speakerId, gender]) => ({ id, label, speakerId, languageCode: 'zh-CN', gender }),
);

export const MODEL_PACKS = [
  {
    id: 'rhythm-lite',
    kind: 'analysis',
    label: '节奏分析轻量包',
    description: '本地分析节拍、下拍、速度、拍号与节拍能量。',
    modelId: 'musetric/beat-this-onnx',
    revision: '4e971bd43753023e1bf961c34a0cb74985cfcb88',
    license: 'MIT',
    sizeBytes: 83_407_111,
    recommendedMemoryBytes: 1 * GIB,
    capabilities: ['节拍定位', '下拍定位', 'BPM 与拍号', '节拍能量'],
    files: [
      {
        path: 'beat_this.onnx',
        sizeBytes: 83_143_431,
        sha256: '078572af6ca47741e06a82d09525d13c793eaa8e311a8cf15e831dcd7e73f218',
      },
      {
        path: 'config.json',
        sizeBytes: 1_024,
        sha256: '56cc961ddc588c57787c20c01ec6ab483b23af1049e65bd33d599a81803acd69',
      },
      {
        path: 'mel-filterbank.bin',
        sizeBytes: 262_656,
        sha256: '1ee975d96f44ccf2c3bfe37825c1c1f0b089f5703c7a12a84b1f0a3bce004533',
      },
    ],
  },
  {
    id: 'music-semantics-lite',
    kind: 'analysis',
    label: '音乐语义轻量包',
    description: '在本机生成音乐语义向量，用于检索与相似度匹配。',
    modelId: 'Xenova/clap-htsat-unfused',
    revision: 'c28f2883575e590e04d3146ff0713c2448d691ba',
    license: 'Apache-2.0',
    sizeBytes: 34_302_907,
    recommendedMemoryBytes: 2 * GIB,
    capabilities: ['音乐语义向量', '音乐相似度'],
    files: [
      {
        path: 'config.json',
        sizeBytes: 699,
        sha256: '39c6d90fe29cf2cce650dd5c92c38a1e35b130d9ce0bb98585222ad687ad979b',
      },
      {
        path: 'preprocessor_config.json',
        sizeBytes: 541,
        sha256: '9739f58296aa6f9ac18008fd0150fb2649bc554985fbde86d0a4041c882ac753',
      },
      {
        path: 'onnx/audio_model_quantized.onnx',
        sizeBytes: 34_301_667,
        sha256: '3fcff2c8824e7bcb83a983f2a49edab3b60cbcf4872ac70efee517355173bd1f',
      },
    ],
  },
  {
    id: 'visual-semantics-lite',
    kind: 'analysis',
    label: '画面语义轻量包',
    description: '在本机生成画面与中文文本向量，用于语义检索和重复镜头检测。',
    modelId: 'Xenova/chinese-clip-vit-base-patch16',
    revision: 'f26904860903e70e050b8f48255e5f48401816e9',
    license: 'Apache-2.0',
    sizeBytes: 178_225_758,
    recommendedMemoryBytes: 2 * GIB,
    capabilities: ['画面语义向量', '中文画面检索', '重复镜头检测'],
    files: [
      {
        path: 'config.json',
        sizeBytes: 844,
        sha256: '19447ad8c20d274f0644a6663af56286be98bd2d0e5f9472fcb318e04fcd6961',
      },
      {
        path: 'preprocessor_config.json',
        sizeBytes: 546,
        sha256: '61a78fdd2c7ac17b54b6190c0f4cb23423192c535003d52528d01e318a47608b',
      },
      {
        path: 'special_tokens_map.json',
        sizeBytes: 125,
        sha256: 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
      },
      {
        path: 'tokenizer.json',
        sizeBytes: 439_124,
        sha256: '7dfbf1966ebf99d471c3796e9b457329d2b2182b817e144f1e904b957745c839',
      },
      {
        path: 'tokenizer_config.json',
        sizeBytes: 1_315,
        sha256: '38fbc894183595cc1168e36150251b2fb658197b3a49f6908cce88ae22acd52a',
      },
      {
        path: 'vocab.txt',
        sizeBytes: 109_540,
        sha256: '45bbac6b341c319adc98a532532882e91a9cefc0329aa57bac9ae761c27b291c',
      },
      {
        path: 'onnx/model_q4.onnx',
        sizeBytes: 177_674_264,
        sha256: 'c64c40f177a8756c7831cdaa932bfb30187ef2e85266e54ec838259d34d3fe2e',
      },
    ],
  },
  {
    id: 'smolvlm2-500m-q8-local',
    kind: 'analysis',
    label: 'SmolVLM2 500M · Q8 本地参考分析',
    description: '通过 llama.cpp 在本机分析成片参考的镜头节奏、字幕、转场与画面风格；只生成结构化风格档案，不复制参考素材。',
    modelId: 'ggml-org/SmolVLM2-500M-Video-Instruct-GGUF',
    revision: 'ccd7aae53bcb1997355c2f094959e72b3642ce17',
    license: 'Apache-2.0',
    sizeBytes: 545_593_888,
    recommendedMemoryBytes: 4 * GIB,
    capabilities: ['参考成片结构分析', '镜头节奏描述', '字幕与转场风格提取'],
    accelerationNote: 'RTX 2060 6GB 为目标最低档；实际 CUDA/CPU 后端只采用 llama.cpp 运行结果，不从显卡型号推断。',
    analysisRuntime: {
      engine: 'llama.cpp',
      minimumBuild: 6500,
      architecture: 'smolvlm2',
      quantization: 'q8_0',
      modelPath: 'SmolVLM2-500M-Video-Instruct-Q8_0.gguf',
      mmprojPath: 'mmproj-SmolVLM2-500M-Video-Instruct-Q8_0.gguf',
      minimumVramMiB: 2_048,
      gpuLayers: 99,
    },
    files: [
      {
        path: 'SmolVLM2-500M-Video-Instruct-Q8_0.gguf',
        sizeBytes: 436_808_704,
        sha256: '6f67b8036b2469fcd71728702720c6b51aebd759b78137a8120733b4d66438bc',
      },
      {
        path: 'mmproj-SmolVLM2-500M-Video-Instruct-Q8_0.gguf',
        sizeBytes: 108_785_184,
        sha256: '921dc7e259f308e5b027111fa185efcbf33db13f6e35749ddf7f5cdb60ef520b',
      },
    ],
  },
  {
    id: 'kokoro-tts-local',
    kind: 'voice',
    label: 'Kokoro 82M 本地中文口播',
    description: 'NVIDIA 优化 ONNX；首发稳定开放 8 个中文音色，英文与更多语言待后续验证。',
    modelId: 'nvidia/kokoro-82M-onnx-opt',
    revision: '2c9213187a1925bd87478540b6c8cda1a49a8d52',
    license: 'Apache-2.0',
    sizeBytes: 230_264_408,
    recommendedMemoryBytes: 2 * GIB,
    capabilities: ['完全离线语音合成', '中文口播音色'],
    voices: KOKORO_VOICES,
    defaultVoiceId: 'zf_xiaoxiao',
    supportedLanguageCodes: ['zh-CN'],
    accelerationNote: 'Windows WebGPU 以 RTX 2060 6GB 为最低目标；响应按 ORT profile 报告实际 webgpu/cpu，待 RTX 2060 实机验收。',
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
    files: [
      { path: 'kokoro-82m-v1.0.onnx', sizeBytes: 202_580_587, sha256: '0534faf2a4cdc715f9aa42660b69fffe79a69379af432d7d4497695e86f37d6d' },
      { path: 'voices.bin', sizeBytes: 27_678_720, sha256: '8a77c0d397026208d22211f37670b5b3b11e03f190756b25a1d24041fced82a9' },
      {
        path: 'tokenizer/config.json',
        sizeBytes: 44,
        sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f',
        source: { ...KOKORO_TOKENIZER_SOURCE, path: 'config.json' },
      },
      {
        path: 'tokenizer/tokenizer.json',
        sizeBytes: 4_944,
        sha256: '5715a60b09d5e4b9074435d68c6ccd5675b9d48b220e109fdea3cda681e23d15',
        source: { ...KOKORO_TOKENIZER_SOURCE, path: 'tokenizer.json' },
      },
      {
        path: 'tokenizer/tokenizer_config.json',
        sizeBytes: 113,
        sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20',
        source: { ...KOKORO_TOKENIZER_SOURCE, path: 'tokenizer_config.json' },
      },
    ],
  },
  {
    id: 'fish-s2-pro-q6-local',
    kind: 'voice',
    label: 'Fish Audio S2 Pro · Q6_K（实验）',
    description: '面向 RTX 4060/5060 8–9GB 的 s2.cpp CUDA 口播包；当前为社区 alpha，默认随机音色。',
    modelId: FISH_S2_Q6_LOCAL_MODEL_ID,
    revision: FISH_S2_SOURCE.revision,
    license: 'Fish-Audio-Research-License',
    licensePolicy: FISH_S2_LICENSE_POLICY,
    releaseChannel: 'experimental',
    sizeBytes: 4_537_494_760,
    recommendedMemoryBytes: 16 * GIB,
    capabilities: ['完全离线语音合成', '中文口播音色', '多语言情绪口播', '自然语言行内控制'],
    voices: [{ id: 'random-zh', label: 'S2 随机中文音色（每次可能不同）', languageCode: 'zh-CN' }],
    defaultVoiceId: 'random-zh',
    supportedLanguageCodes: ['zh-CN'],
    accelerationNote: 'RTX 4060/5060 8–9GB 推荐：s2.cpp CUDA + Q6_K；运行组件与权重均需单独许可确认。',
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
    files: [
      {
        path: 's2-pro-q6_k.gguf',
        sizeBytes: 4_525_266_528,
        sha256: '84ac904172a2cadb84e8f7f14ea3f1acef0584987635e85f7207fd254eafa235',
        source: { ...FISH_S2_SOURCE, path: 's2-pro-q6_k.gguf' },
      },
      {
        path: 'tokenizer.json',
        sizeBytes: 12_217_872,
        sha256: 'f24e08099d45a8adf3f52f5f0b03276e433bb9d689bb15fcbcc48ce58744588b',
        source: { ...FISH_S2_SOURCE, path: 'tokenizer.json' },
      },
      {
        path: 'LICENSE.md',
        sizeBytes: 10_360,
        sha256: 'aa7d9206e9d710590987a3636934f643529c00cd490323594e6206aaa0c32d80',
        source: { ...FISH_S2_SOURCE, path: 'LICENSE.md' },
      },
    ],
  },
  {
    id: 'fish-s2-pro-q8-local',
    kind: 'voice',
    label: 'Fish Audio S2 Pro · Q8_0（实验）',
    description: '面向 RTX 5060+ 或 10GB 以上大显存的 s2.cpp CUDA 口播包；优先质量、稳定性与热机速度。',
    modelId: FISH_S2_Q8_LOCAL_MODEL_ID,
    revision: FISH_S2_SOURCE.revision,
    license: 'Fish-Audio-Research-License',
    licensePolicy: FISH_S2_LICENSE_POLICY,
    releaseChannel: 'experimental',
    sizeBytes: 5_642_265_320,
    recommendedMemoryBytes: 24 * GIB,
    capabilities: ['完全离线语音合成', '中文口播音色', '多语言情绪口播', '自然语言行内控制'],
    voices: [{ id: 'random-zh', label: 'S2 随机中文音色（每次可能不同）', languageCode: 'zh-CN' }],
    defaultVoiceId: 'random-zh',
    supportedLanguageCodes: ['zh-CN'],
    accelerationNote: 'RTX 5060+ / 10GB 以上大显存优先：s2.cpp CUDA + Q8_0；运行组件与权重均需单独许可确认。',
    runtime: {
      engine: 's2.cpp',
      engineRevision: '2c33261938da1a41d713768b1b391b4d368d7d2c',
      architecture: 'fish-s2-pro',
      quantization: 'q8_0',
      modelPath: 's2-pro-q8_0.gguf',
      tokenizerPath: 'tokenizer.json',
      minimumVramMiB: 10_240,
      gpuLayers: -1,
    },
    files: [
      {
        path: 's2-pro-q8_0.gguf',
        sizeBytes: 5_630_037_088,
        sha256: 'e2043182234786e7b975547d3bbcb23ff02e4ff684b82f7fa851287e4cb4f267',
        source: { ...FISH_S2_SOURCE, path: 's2-pro-q8_0.gguf' },
      },
      {
        path: 'tokenizer.json',
        sizeBytes: 12_217_872,
        sha256: 'f24e08099d45a8adf3f52f5f0b03276e433bb9d689bb15fcbcc48ce58744588b',
        source: { ...FISH_S2_SOURCE, path: 'tokenizer.json' },
      },
      {
        path: 'LICENSE.md',
        sizeBytes: 10_360,
        sha256: 'aa7d9206e9d710590987a3636934f643529c00cd490323594e6206aaa0c32d80',
        source: { ...FISH_S2_SOURCE, path: 'LICENSE.md' },
      },
    ],
  },
] as const satisfies readonly ModelPackDefinition[];

export function modelPackFileSource(
  pack: ModelPackDefinition,
  file: ModelPackFile,
): ModelPackFileSource {
  return file.source ?? { modelId: pack.modelId, revision: pack.revision, path: file.path };
}

export function modelPackDefinition(id: string): ModelPackDefinition | undefined {
  return MODEL_PACKS.find((pack) => pack.id === id);
}

/**
 * User-facing install guidance for missing model packs (used by agent tools).
 * Bilingual because the assistant relays it in the user's language.
 */
export function modelPackInstallGuidance(packs: readonly { id: string }[]): string {
  const names = packs.map((pack) => {
    const def = MODEL_PACKS.find((entry) => entry.id === pack.id);
    return def ? `${def.label}（${def.id}）` : pack.id;
  }).join('、');
  return `请到 设置 → 转写 → 本地模型 下载：${names}（Settings → Transcription → Local models: ${packs.map((pack) => pack.id).join(', ')}）`;
}
