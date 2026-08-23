import type {
  ModelPackCatalogEntry,
  ModelPackId,
  ModelPackInferenceBackend,
  ModelPackStatus,
} from '../../../shared/model-packs';

export type VoiceLanguageSupport = 'full' | 'partial' | 'experimental';
export type VoiceExecutionDevice = 'auto' | 'webgpu' | 'cuda' | 'cpu';
export type VoiceInferenceBackend = ModelPackInferenceBackend;
export type VoiceCompatibilityStatus = 'verified' | 'supported' | 'target' | 'unsupported';

export interface LocalVoiceLanguage {
  readonly id: string;
  readonly label: string;
  readonly support?: VoiceLanguageSupport;
}

export interface LocalVoiceOption {
  readonly id: string;
  readonly label: string;
  readonly languages: readonly string[];
}

export interface LocalVoiceCompatibility {
  readonly label: string;
  readonly status: VoiceCompatibilityStatus;
}

export interface LocalVoiceRuntimeStatus {
  readonly backend?: VoiceInferenceBackend;
  readonly fallbackReason?: string;
}

export interface LocalVoiceModelPack {
  readonly source: ModelPackCatalogEntry;
  /** Install/delete API identity. */
  readonly packId: ModelPackId;
  /** Saved setting and submit_voice identity. */
  readonly modelId: string;
  readonly label: string;
  readonly status: ModelPackStatus;
  readonly usable: boolean;
  readonly releaseChannel: 'stable' | 'experimental';
  readonly runtime?: string;
  readonly runtimeStatus: LocalVoiceRuntimeStatus;
  readonly languages: readonly LocalVoiceLanguage[];
  readonly voices: readonly LocalVoiceOption[];
  readonly hardware: {
    readonly cpuFallback: boolean;
    readonly devices: readonly VoiceExecutionDevice[];
    readonly compatibility: readonly LocalVoiceCompatibility[];
  };
  readonly supportsSpeed: boolean;
  readonly defaults: {
    readonly voice?: string;
    readonly language?: string;
    readonly speed: number;
    readonly device: VoiceExecutionDevice;
  };
}

function languageLabel(code: string): string {
  const labels: Record<string, string> = {
    'zh-cn': '中文',
    'en-us': '美式英语',
    'en-gb': '英式英语',
    'es-es': '西班牙语',
    'fr-fr': '法语',
    'hi-in': '印地语',
    'it-it': '意大利语',
    'ja-jp': '日语',
    'pt-br': '葡萄牙语（巴西）',
  };
  return labels[code.toLowerCase()] ?? code;
}

function runtimeLabel(entry: ModelPackCatalogEntry): string | undefined {
  if (!entry.runtime) return undefined;
  if (entry.runtime.engine === 's2.cpp') {
    return `s2.cpp ${entry.runtime.engineRevision.slice(0, 8)} · GGUF ${entry.runtime.quantization.toUpperCase()}`;
  }
  return [
    `${entry.runtime.engine} ${entry.runtime.engineVersion}`,
    `${entry.runtime.frontend} ${entry.runtime.frontendVersion}`,
  ].join(' · ');
}

function compatibility(entry: ModelPackCatalogEntry): readonly LocalVoiceCompatibility[] {
  const items: LocalVoiceCompatibility[] = [];
  if (entry.hardwareRecommendation) {
    const gpu = entry.detectedGpu
      ? `${entry.detectedGpu.name} · ${Math.round(entry.detectedGpu.memoryMiB / 1024)}GB`
      : '未检测到合格 NVIDIA GPU';
    items.push({
      label: `${entry.hardwareRecommendation.label}：${gpu}`,
      status: entry.hardwareRecommendation.tier === 'unsupported' ? 'unsupported' : 'supported',
    });
  }
  const note = entry.accelerationNote?.trim();
  if (note) items.push({ label: note, status: 'target' });
  if (entry.runtimeAvailability?.available === false) {
    items.push({
      label: entry.runtimeAvailability.reason ?? '本地运行组件不可用',
      status: 'unsupported',
    });
  }
  return items;
}

/**
 * Formal ModelPackCatalogEntry to local voice view model adapter. Model
 * identity, voices, languages, runtime and compatibility copy all come from
 * the backend catalog; the frontend owns only presentation and preference labels.
 */
export function localVoiceModelPack(entry: ModelPackCatalogEntry): LocalVoiceModelPack | null {
  if (entry.kind !== 'voice') return null;
  const voices: readonly LocalVoiceOption[] = (entry.voices ?? []).map((voice) => ({
    id: voice.id,
    label: voice.label,
    languages: [voice.languageCode],
  }));
  const languages: readonly LocalVoiceLanguage[] = (entry.supportedLanguageCodes ?? []).map((code) => ({
    id: code,
    label: languageLabel(code),
  }));
  const defaultVoice = entry.defaultVoiceId;
  const defaultLanguage = voices.find((voice) => voice.id === defaultVoice)?.languages[0]
    ?? languages[0]?.id;
  const fishS2 = entry.runtime?.engine === 's2.cpp';
  const usable = entry.status === 'installed' && entry.runtimeAvailability?.available !== false;
  return {
    source: entry,
    packId: entry.id,
    modelId: entry.modelId,
    label: entry.label,
    status: entry.status,
    usable,
    releaseChannel: entry.releaseChannel ?? 'stable',
    runtime: runtimeLabel(entry),
    runtimeStatus: entry.runtimeStatus ?? {},
    languages,
    voices,
    hardware: {
      cpuFallback: !fishS2,
      devices: fishS2 ? ['auto', 'cuda'] : ['auto', 'webgpu', 'cpu'],
      compatibility: compatibility(entry),
    },
    supportsSpeed: !fishS2,
    defaults: {
      voice: defaultVoice,
      language: defaultLanguage,
      speed: 1,
      device: 'auto',
    },
  };
}

export function localVoiceModels(entries: readonly ModelPackCatalogEntry[]): readonly LocalVoiceModelPack[] {
  return entries.flatMap((entry) => localVoiceModelPack(entry) ?? []);
}

export function installedLocalVoiceModels(models: readonly LocalVoiceModelPack[]): readonly LocalVoiceModelPack[] {
  return models.filter((model) => model.usable);
}

export function preferenceVoiceModel(
  models: readonly LocalVoiceModelPack[],
  configuredModelId: string,
): LocalVoiceModelPack | null {
  const installed = installedLocalVoiceModels(models);
  if (!configuredModelId) return installed.find((model) => model.source.hardwareRecommendation) ?? installed[0] ?? null;
  return installed.find((model) => model.modelId === configuredModelId) ?? null;
}

export function voicesForLanguage(
  model: LocalVoiceModelPack | null,
  language: string,
): readonly LocalVoiceOption[] {
  if (!model) return [];
  if (!language) return model.voices;
  return model.voices.filter((voice) => voice.languages.includes(language));
}
