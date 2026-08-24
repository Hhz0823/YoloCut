import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('@derhuerst/ffprobe-static');
const TEMP_PREFIX = 'yolocut-nvenc-smoke-';
const duration = Math.max(1, Math.min(30, Number(process.env.YOLOCUT_NVENC_SMOKE_SECONDS) || 3));

async function run(command, args, timeout = 120_000) {
  try {
    return await execFileAsync(command, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout,
      windowsHide: true,
    });
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim().split(/\r?\n/).slice(-40).join('\n') : '';
    throw new Error(`${basename(command)} failed${stderr ? `:\n${stderr}` : ''}`, { cause: error });
  }
}

async function elapsed(task) {
  const started = performance.now();
  const result = await task();
  return { result, elapsedMs: Math.round(performance.now() - started) };
}

const tempBase = resolve(tmpdir());
const smokeRoot = await mkdtemp(join(tempBase, TEMP_PREFIX));
const source = join(smokeRoot, 'source-4k.mp4');
const proxy = join(smokeRoot, 'proxy-1080p.mp4');
const cleanup = resolve(smokeRoot);

if (dirname(cleanup) !== tempBase || !basename(cleanup).startsWith(TEMP_PREFIX)) {
  throw new Error(`Refusing unsafe NVIDIA smoke cleanup: ${cleanup}`);
}

try {
  const gpu = await run('nvidia-smi', [
    '--query-gpu=name,driver_version,memory.total',
    '--format=csv,noheader,nounits',
  ], 15_000);
  const generation = await elapsed(() => run(ffmpeg, [
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30',
    '-t', String(duration),
    '-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq:v', '23', '-b:v', '0',
    '-pix_fmt', 'yuv420p',
    source,
  ]));
  const proxyRun = await elapsed(() => run(ffmpeg, [
    '-hide_banner', '-y',
    '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda',
    '-i', source,
    '-vf', 'scale_cuda=1920:1080:format=yuv420p',
    '-c:v', 'h264_nvenc', '-preset', 'p4', '-an',
    proxy,
  ]));
  const probe = await run(ffprobe, [
    '-v', 'error',
    '-show_entries', 'stream=codec_name,width,height,r_frame_rate,pix_fmt',
    '-show_entries', 'format=duration,size',
    '-of', 'json',
    proxy,
  ]);
  const sourceInfo = await stat(source);
  const proxyInfo = await stat(proxy);
  const parsedProbe = JSON.parse(probe.stdout);
  const video = parsedProbe.streams?.[0];
  if (video?.codec_name !== 'h264' || video.width !== 1920 || video.height !== 1080) {
    throw new Error(`Unexpected proxy output: ${probe.stdout}`);
  }
  console.log(JSON.stringify({
    gpu: gpu.stdout.trim().split(/\r?\n/),
    durationSeconds: duration,
    generate4kMs: generation.elapsedMs,
    proxyNvdecCudaNvencMs: proxyRun.elapsedMs,
    sourceBytes: sourceInfo.size,
    proxyBytes: proxyInfo.size,
    output: parsedProbe,
  }, null, 2));
} finally {
  await rm(cleanup, { recursive: true, force: true });
}
