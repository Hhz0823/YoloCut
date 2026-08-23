import {
  isLocalVoiceInferenceBackend,
  LOCAL_VOICE_UNAVAILABLE_MESSAGE,
} from '../../shared/local-voice.ts';
import type { LocalVoiceAudio, ValidVoiceRequest, VoiceOptions } from './voice-types.ts';

/**
 * Adapter boundary for the separately owned local inference backend. This file
 * never installs/downloads a model; absent injection fails closed with Settings
 * guidance. Returned execution metadata is validated before it reaches audit.
 */
export async function generateLocalVoice(
  options: VoiceOptions,
  input: ValidVoiceRequest,
): Promise<LocalVoiceAudio> {
  if (input.provider !== 'local') throw new Error(`unsupported local voice provider: ${input.provider}`);
  if (!options.localVoiceGenerator) throw new Error(LOCAL_VOICE_UNAVAILABLE_MESSAGE);
  const result = await options.localVoiceGenerator(input);
  if (!Buffer.isBuffer(result.bytes) || result.bytes.length === 0) throw new Error('local voice backend returned empty audio');
  if (result.codec !== 'wav') throw new Error('local voice backend must return WAV audio');
  if (!Number.isFinite(result.sampleRate) || result.sampleRate <= 0) throw new Error('local voice backend returned an invalid sampleRate');
  if (result.modelId !== input.modelId) throw new Error('local voice backend did not confirm the requested modelId');
  if (result.voiceId !== input.voiceId) throw new Error('local voice backend did not confirm the requested voiceId');
  if (result.languageCode && result.languageCode.toLowerCase() !== input.languageCode?.toLowerCase()) {
    throw new Error('local voice backend languageCode does not match the confirmed request');
  }
  if (!isLocalVoiceInferenceBackend(result.inferenceBackend)) {
    throw new Error('local voice backend must report inferenceBackend as webgpu, cuda-hybrid, or cpu');
  }
  return result;
}
