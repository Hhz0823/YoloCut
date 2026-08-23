import type { MediaAsset, TimelineState } from '../editor/types';
import type { MinimaxLanguageBoost } from '../../shared/media-provider-params';
import {
  isLocalVoiceDevicePreference,
  isLocalVoiceInferenceBackend,
  type LocalVoiceDevicePreference,
  type LocalVoiceGenerationAudit,
} from '../../shared/local-voice';
import { assertAvailableLocalVoiceSelection } from './local-voice-status';

export type VoiceProvider =
  | 'elevenlabs'
  | 'doubao'
  | 'minimax'
  | 'inworld'
  | 'fishaudio'
  | 'speechify'
  | 'openai'
  | 'gemini'
  | 'mistral'
  | 'cartesia'
  | 'local';

export interface SubmitVoiceArgs {
  provider: VoiceProvider;
  text: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  speed?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  languageCode?: string;
  devicePreference?: LocalVoiceDevicePreference;
  seed?: number;
  outputFormat?: string;
  instructions?: string;
  optimizeStreamingLatency?: number;
  enableLogging?: boolean;
  applyTextNormalization?: 'auto' | 'on' | 'off';
  applyLanguageTextNormalization?: boolean;
  pronunciationDictionaryLocators?: Array<{ pronunciationDictionaryId: string; versionId: string }>;
  previousText?: string;
  nextText?: string;
  previousRequestIds?: string[];
  nextRequestIds?: string[];
  speedRatio?: number;
  emotion?: string;
  emotionScale?: number;
  loudnessRatio?: number;
  pitch?: number;
  /** MiniMax only: voice_setting.vol 0–10. */
  volume?: number;
  performancePrompt?: string;
  explicitDialect?: 'dongbei' | 'shaanxi' | 'sichuan';
  sampleRate?: number;
  bitrate?: number;
  audioFormat?: 'mp3' | 'pcm' | 'flac' | 'wav' | 'pcmu_raw' | 'pcmu_wav' | 'opus';
  channel?: 1 | 2;
  forceCbr?: boolean;
  stream?: boolean;
  excludeAggregatedAudio?: boolean;
  languageBoost?: MinimaxLanguageBoost;
  textNormalization?: boolean;
  latexRead?: boolean;
  pronunciations?: string[];
  timbreWeights?: Array<{ voiceId: string; weight: number }>;
  voiceModify?: { pitch?: number; intensity?: number; timbre?: number; effect?: 'spacious_echo' | 'auditorium_echo' | 'lofi_telephone' | 'robotic' };
  subtitleEnable?: boolean;
  subtitleType?: 'sentence' | 'word' | 'word_streaming';
  name?: string;
}

interface VoiceResponse {
  path?: string;
  subtitlePath?: string;
  durationSeconds?: number;
  modelId?: string;
  modelRevision?: string;
  voiceId?: string;
  languageCode?: string;
  speed?: number;
  inferenceBackend?: string;
  fallbackReason?: string;
  error?: string;
}

const newId = () => crypto.randomUUID?.() ?? `generated_${Date.now()}_${Math.random().toString(36).slice(2)}`;

function probeAudio(src: string, fps: number): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const fallback = window.setTimeout(() => resolve(Math.round(fps * 5)), 10_000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      window.clearTimeout(fallback);
      resolve(Math.max(1, Math.round((audio.duration || 5) * fps)));
    };
    audio.onerror = () => {
      window.clearTimeout(fallback);
      resolve(Math.round(fps * 5));
    };
    audio.src = src;
  });
}

export async function submitVoice(args: SubmitVoiceArgs, state: TimelineState): Promise<MediaAsset> {
  const text = args.text.trim();
  const voiceId = args.voiceId.trim();
  if (!text) throw new Error('text is required');
  if (!voiceId && !args.timbreWeights?.length) throw new Error('voiceId is required unless MiniMax timbreWeights are provided');
  let requestArgs: SubmitVoiceArgs = { ...args, text, voiceId };
  if (args.provider === 'local') {
    const modelId = args.modelId?.trim() ?? '';
    const languageCode = args.languageCode?.trim() ?? '';
    const devicePreference = args.devicePreference ?? 'auto';
    const speed = args.speed ?? 1;
    if (!isLocalVoiceDevicePreference(devicePreference)) throw new Error('local devicePreference must be auto, webgpu, cuda, or cpu');
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error('local speed must be between 0.5 and 2');
    assertAvailableLocalVoiceSelection({ modelId, voiceId, languageCode });
    requestArgs = { ...args, text, voiceId, modelId, languageCode, devicePreference, speed };
  }
  const response = await fetch('/generate/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestArgs),
  });
  const result = await response.json().catch(() => ({})) as VoiceResponse;
  if (!response.ok) throw new Error(result.error ?? `voice generation failed (${response.status})`);
  if (!result.path) throw new Error('voice generation returned no audio asset');
  const durationInFrames = result.durationSeconds && Number.isFinite(result.durationSeconds)
    ? Math.max(1, Math.round(result.durationSeconds * state.fps))
    : await probeAudio(result.path, state.fps);
  const props: Record<string, unknown> = {};
  if (result.subtitlePath) {
    props.minimaxSubtitlePath = result.subtitlePath;
    props.minimaxSubtitleType = requestArgs.subtitleType ?? 'sentence';
  }
  if (requestArgs.provider === 'local') props.localVoiceGeneration = localVoiceGenerationAudit(requestArgs, result);
  return {
    id: newId(),
    name: requestArgs.name?.trim() || `Voice · ${voiceId}`,
    kind: 'audio',
    src: result.path,
    durationInFrames,
    props: Object.keys(props).length ? props : undefined,
  };
}

function localVoiceGenerationAudit(args: SubmitVoiceArgs, result: VoiceResponse): LocalVoiceGenerationAudit {
  const modelId = result.modelId?.trim() ?? '';
  const voiceId = result.voiceId?.trim() ?? '';
  const requestedModelId = args.modelId?.trim() ?? '';
  const requestedVoiceId = args.voiceId.trim();
  const requestedLanguageCode = args.languageCode?.trim() ?? '';
  if (!modelId || modelId !== requestedModelId) throw new Error('local voice response did not confirm the requested modelId');
  if (!voiceId || voiceId !== requestedVoiceId) throw new Error('local voice response did not confirm the requested voiceId');
  if (!isLocalVoiceInferenceBackend(result.inferenceBackend)) {
    throw new Error('local voice response must report inferenceBackend as webgpu, cuda-hybrid, or cpu');
  }
  const actualLanguageCode = result.languageCode?.trim() || requestedLanguageCode;
  if (actualLanguageCode.toLowerCase() !== requestedLanguageCode.toLowerCase()) {
    throw new Error('local voice response languageCode does not match the confirmed request');
  }
  const actualSpeed = typeof result.speed === 'number' && Number.isFinite(result.speed)
    ? result.speed
    : args.speed ?? 1;
  const requestedDevicePreference = args.devicePreference ?? 'auto';
  if (!isLocalVoiceDevicePreference(requestedDevicePreference)) throw new Error('invalid local voice device preference');
  const fallbackReason = result.fallbackReason?.trim();
  const modelRevision = result.modelRevision?.trim();
  return {
    provider: 'local',
    modelId,
    ...(modelRevision ? { modelRevision } : {}),
    voiceId,
    languageCode: actualLanguageCode,
    speed: actualSpeed,
    requestedDevicePreference,
    inferenceBackend: result.inferenceBackend,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

export function localVoiceAuditFromAsset(asset: MediaAsset): LocalVoiceGenerationAudit | undefined {
  const value = asset.props?.localVoiceGeneration;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const audit = value as Partial<LocalVoiceGenerationAudit>;
  if (audit.provider !== 'local' || typeof audit.modelId !== 'string' || typeof audit.voiceId !== 'string'
    || typeof audit.languageCode !== 'string' || typeof audit.speed !== 'number'
    || !isLocalVoiceDevicePreference(audit.requestedDevicePreference)
    || !isLocalVoiceInferenceBackend(audit.inferenceBackend)) return undefined;
  return audit as LocalVoiceGenerationAudit;
}
