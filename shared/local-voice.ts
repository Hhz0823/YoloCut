export const LOCAL_VOICE_CAPABILITIES_ENDPOINT = '/api/local-voice/models';
export const LOCAL_VOICE_SETTINGS_PATH = '设置 → 本地模型 → 本地口播';
export const LOCAL_VOICE_UNAVAILABLE_MESSAGE =
  `本地口播模型未安装或不可用。请到 ${LOCAL_VOICE_SETTINGS_PATH} 安装并确认模型与音色；Agent 不会自动下载模型。`;

export type LocalVoiceDevicePreference = 'auto' | 'webgpu' | 'cuda' | 'cpu';
export type LocalVoiceInferenceBackend = 'webgpu' | 'cuda-hybrid' | 'cpu';
export type LocalVoiceModelStatus = 'absent' | 'downloading' | 'installed' | 'error';

export interface LocalVoiceCatalogVoice {
  readonly voiceId: string;
  readonly label: string;
  readonly languageCodes: readonly string[];
  /** Optional same-origin preview supplied by the installed-model catalog. */
  readonly previewUrl?: string;
}

export interface LocalVoiceCatalogModel {
  readonly modelId: string;
  readonly label: string;
  readonly status: LocalVoiceModelStatus;
  readonly revision?: string;
  readonly license?: string;
  readonly releaseChannel?: 'stable' | 'experimental';
  readonly runtimeAvailable?: boolean;
  readonly runtimeReason?: string;
  readonly voices: readonly LocalVoiceCatalogVoice[];
}

export interface LocalVoiceCapabilitySnapshot {
  readonly models: readonly LocalVoiceCatalogModel[];
}

/** Required metadata on a successful local `/generate/voice` response. */
export interface LocalVoiceGenerationMetadata {
  readonly modelId: string;
  readonly modelRevision?: string;
  readonly voiceId: string;
  readonly languageCode?: string;
  readonly speed?: number;
  readonly inferenceBackend: LocalVoiceInferenceBackend;
  readonly fallbackReason?: string;
}

export interface LocalVoiceGenerationAudit extends LocalVoiceGenerationMetadata {
  readonly provider: 'local';
  readonly requestedDevicePreference: LocalVoiceDevicePreference;
}

export const EMPTY_LOCAL_VOICE_CAPABILITIES: LocalVoiceCapabilitySnapshot = { models: [] };

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,199}$/;
const LANGUAGE_CODE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const MODEL_STATUSES = new Set<LocalVoiceModelStatus>(['absent', 'downloading', 'installed', 'error']);
const DEVICE_PREFERENCES = new Set<Exclude<LocalVoiceDevicePreference, 'auto'>>(['webgpu', 'cuda', 'cpu']);
const INFERENCE_BACKENDS = new Set<LocalVoiceInferenceBackend>(['webgpu', 'cuda-hybrid', 'cpu']);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return SAFE_ID.test(trimmed) ? trimmed : undefined;
}

function safeText(value: unknown, fallback: string, maxLength = 120): string {
  if (typeof value !== 'string') return fallback;
  const text = [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? ' ' : character;
  }).join('').trim().slice(0, maxLength);
  return text || fallback;
}

function safeLanguageCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => LANGUAGE_CODE.test(item)))];
}

function safePreviewUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || /[\r\n]/.test(trimmed)) return undefined;
  return trimmed.slice(0, 500);
}

function parseVoice(value: unknown): LocalVoiceCatalogVoice | undefined {
  const raw = record(value);
  const voiceId = safeId(raw?.voiceId);
  if (!raw || !voiceId) return undefined;
  const languageCodes = safeLanguageCodes(raw.languageCodes);
  if (languageCodes.length === 0) return undefined;
  const previewUrl = safePreviewUrl(raw.previewUrl);
  return {
    voiceId,
    label: safeText(raw.label, voiceId),
    languageCodes,
    ...(previewUrl ? { previewUrl } : {}),
  };
}

function parseModel(value: unknown): LocalVoiceCatalogModel | undefined {
  const raw = record(value);
  const modelId = safeId(raw?.modelId);
  const status = raw?.status;
  if (!raw || !modelId || typeof status !== 'string' || !MODEL_STATUSES.has(status as LocalVoiceModelStatus)) return undefined;
  const voices = Array.isArray(raw.voices)
    ? raw.voices.map(parseVoice).filter((voice): voice is LocalVoiceCatalogVoice => voice !== undefined)
    : [];
  const revision = safeId(raw.revision);
  const license = typeof raw.license === 'string' ? safeText(raw.license, '', 40) : '';
  const releaseChannel = raw.releaseChannel === 'stable' || raw.releaseChannel === 'experimental'
    ? raw.releaseChannel
    : undefined;
  const runtimeAvailable = typeof raw.runtimeAvailable === 'boolean' ? raw.runtimeAvailable : undefined;
  const runtimeReason = typeof raw.runtimeReason === 'string' ? safeText(raw.runtimeReason, '', 240) : '';
  return {
    modelId,
    label: safeText(raw.label, modelId),
    status: status as LocalVoiceModelStatus,
    voices,
    ...(revision ? { revision } : {}),
    ...(license ? { license } : {}),
    ...(releaseChannel ? { releaseChannel } : {}),
    ...(runtimeAvailable !== undefined ? { runtimeAvailable } : {}),
    ...(runtimeReason ? { runtimeReason } : {}),
  };
}

/** Parse an untrusted backend catalog. Invalid entries are omitted, so availability fails closed. */
export function parseLocalVoiceCapabilities(value: unknown): LocalVoiceCapabilitySnapshot {
  const raw = record(value);
  if (!Array.isArray(raw?.models)) return EMPTY_LOCAL_VOICE_CAPABILITIES;
  return {
    models: raw.models.map(parseModel).filter((model): model is LocalVoiceCatalogModel => model !== undefined),
  };
}

export function installedLocalVoiceModels(
  snapshot: LocalVoiceCapabilitySnapshot,
): readonly LocalVoiceCatalogModel[] {
  return snapshot.models.filter((model) => (
    model.status === 'installed' && model.runtimeAvailable !== false && model.voices.length > 0
  ));
}

export interface LocalVoiceSelection {
  readonly modelId: string;
  readonly voiceId: string;
  readonly languageCode: string;
}

/** Returns a user-facing fail-closed reason, or undefined for an installed catalog selection. */
export function localVoiceSelectionIssue(
  snapshot: LocalVoiceCapabilitySnapshot,
  selection: LocalVoiceSelection,
): string | undefined {
  const installed = installedLocalVoiceModels(snapshot);
  if (installed.length === 0) return LOCAL_VOICE_UNAVAILABLE_MESSAGE;
  const model = installed.find((candidate) => candidate.modelId === selection.modelId);
  if (!model) return `本地口播模型 ${selection.modelId || '(empty)'} 未安装或不可用。请到 ${LOCAL_VOICE_SETTINGS_PATH} 重新选择；Agent 不会自动下载模型。`;
  const voice = model.voices.find((candidate) => candidate.voiceId === selection.voiceId);
  if (!voice) return `音色 ${selection.voiceId || '(empty)'} 不在已安装模型 ${model.modelId} 的可用清单中。请先展示清单并让用户确认音色。`;
  const language = selection.languageCode.toLowerCase();
  if (!voice.languageCodes.some((candidate) => candidate.toLowerCase() === language)) {
    return `音色 ${voice.voiceId} 不支持 languageCode=${selection.languageCode || '(empty)'}；请从已展示的语言清单中确认。`;
  }
  return undefined;
}

export function isLocalVoiceDevicePreference(value: unknown): value is LocalVoiceDevicePreference {
  return value === 'auto' || (typeof value === 'string'
    && DEVICE_PREFERENCES.has(value as Exclude<LocalVoiceDevicePreference, 'auto'>));
}

export function isLocalVoiceInferenceBackend(value: unknown): value is LocalVoiceInferenceBackend {
  return typeof value === 'string' && INFERENCE_BACKENDS.has(value as LocalVoiceInferenceBackend);
}
