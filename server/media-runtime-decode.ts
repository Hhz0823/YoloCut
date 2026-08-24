import type { H264Encoder } from './media-acceleration.ts';
import { resolveHwDecodeArgs } from './media-acceleration.ts';
import { ffmpegBin } from './media-binaries.ts';
import {
  resolveThirdPartyVideoDecoders,
  videoDecodeAttempts,
  type VideoDecodeAttempt,
} from './media-decoder-fallback.ts';

/** Resolve the one runtime decode policy used by every FFmpeg consumer.
 * An empty codec still receives hardware -> automatic software fallback;
 * codec-aware callers additionally receive explicit external-library attempts. */
export async function resolveRuntimeVideoDecodeAttempts(
  codec = '',
  encoder?: H264Encoder,
): Promise<VideoDecodeAttempt[]> {
  const ffmpeg = ffmpegBin();
  const [hardwareArgs, thirdPartyDecoders] = await Promise.all([
    resolveHwDecodeArgs(ffmpeg, encoder),
    resolveThirdPartyVideoDecoders(ffmpeg),
  ]);
  return videoDecodeAttempts(hardwareArgs, codec, thirdPartyDecoders);
}
