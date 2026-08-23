import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

import { generateAiVoice, isAiVoiceProvider } from './voice-ai-sdk.ts';
import { generateLocalVoice } from './voice-local.ts';
import { LocalVoiceRuntimeError } from './local-voice-runtime.ts';
import { saveVoiceAudio, saveVoiceSubtitle } from './voice-media.ts';
import { doubaoVoice, elevenLabsVoice, fishAudioVoice, inworldVoice, minimaxVoice, speechifyVoice } from './voice-providers.ts';
import type { VoiceOptions, VoiceProvider, VoiceRequest } from './voice-types.ts';
import { validateVoiceRequest } from './voice-validation.ts';

export { validateVoiceRequest };

async function readJson(req: IncomingMessage): Promise<VoiceRequest> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > 1_000_000) throw new Error('request body too large');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as VoiceRequest;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function audioDescriptor(provider: VoiceProvider, outputFormat: string, audioFormat: string, sampleRate: number) {
  if (provider === 'elevenlabs') {
    const [codec, rate] = outputFormat.split('_');
    return { codec, sampleRate: Number(rate) };
  }
  if (provider === 'minimax') return { codec: audioFormat, sampleRate };
  return { codec: 'mp3', sampleRate: 24_000 };
}

export function voiceGenerationPlugin(options: VoiceOptions): Plugin {
  return {
    name: 'yolocut-voice-generation',
    configureServer(server) {
      server.middlewares.use('/generate/voice', async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed — use POST' }); return; }
        try {
          const input = validateVoiceRequest(await readJson(req));
          if (input.provider === 'local') {
            const audio = await generateLocalVoice(options, input);
            const saved = await saveVoiceAudio(audio.bytes, audio.codec, audio.sampleRate);
            sendJson(res, 200, {
              ...saved,
              modelId: audio.modelId,
              modelRevision: audio.modelRevision,
              voiceId: audio.voiceId,
              languageCode: audio.languageCode ?? input.languageCode,
              speed: audio.speed ?? input.speed,
              inferenceBackend: audio.inferenceBackend,
              fallbackReason: audio.fallbackReason,
            });
            return;
          }
          if (isAiVoiceProvider(input.provider)) {
            const audio = await generateAiVoice(options, input);
            const saved = await saveVoiceAudio(audio.bytes, audio.codec, audio.sampleRate);
            sendJson(res, 200, saved);
            return;
          }
          let bytes: Buffer;
          let subtitleUrl: string | undefined;
          if (input.provider === 'minimax') {
            const result = await minimaxVoice(options, input);
            bytes = result.audio;
            subtitleUrl = result.subtitleUrl;
          } else if (input.provider === 'elevenlabs') bytes = await elevenLabsVoice(options, input);
          else if (input.provider === 'doubao') bytes = await doubaoVoice(options, input);
          else if (input.provider === 'inworld') bytes = await inworldVoice(options, input);
          else if (input.provider === 'fishaudio') bytes = await fishAudioVoice(options, input);
          else bytes = await speechifyVoice(options, input);
          const audio = audioDescriptor(input.provider, input.outputFormat, input.audioFormat, input.sampleRate);
          const saved = await saveVoiceAudio(bytes, audio.codec, audio.sampleRate, input.provider === 'doubao' ? input.pitch ?? 0 : 0);
          const subtitlePath = subtitleUrl ? await saveVoiceSubtitle(subtitleUrl) : undefined;
          sendJson(res, 200, { ...saved, subtitlePath });
        } catch (error) {
          const localError = error instanceof LocalVoiceRuntimeError;
          const message = localError
            ? error.message
            : error instanceof Error ? error.message : String(error);
          server.config.logger.error(`[generate:voice] ${message}`);
          sendJson(res, localError ? error.status : 400, { error: message });
        }
      });
    },
  };
}
