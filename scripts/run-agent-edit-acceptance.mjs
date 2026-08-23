import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = resolve(process.argv[2] || `.tmp/agent-edit-acceptance/${stamp}`);
const profileDir = resolve(artifactDir, 'profile');
const viteCli = resolve(root, 'node_modules/vite/bin/vite.js');

async function freePort() {
  for (;;) {
    const port = await new Promise((resolvePort, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        const value = address && typeof address === 'object' ? address.port : 0;
        probe.close((error) => error ? reject(error) : resolvePort(value));
      });
    });
    if (port !== 5199) return port;
  }
}

async function waitForSource(origin, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`isolated source server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/api/zcode/status`, { cache: 'no-store' });
      if (response.ok && (response.headers.get('content-type') ?? '').includes('application/json')) return;
    } catch {
      // Source server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error('isolated source server did not become ready');
}

async function connectZCode(origin) {
  const response = await fetch(`${origin}/api/zcode/connect`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.includes('application/json')) {
    throw new Error(`source /api/zcode/connect failed (HTTP ${response.status}, ${contentType || 'no content-type'})`);
  }
  const body = await response.json();
  if (body?.status?.authenticated !== true || !body.status.models?.includes('gemini-3.7-flash')) {
    throw new Error(body?.status?.message || 'gemini-3.7-flash is unavailable through ZCode');
  }
  process.stdout.write(`[acceptance] source ZCode connected; ${body.status.models.length} models advertised\n`);
}

async function runChild(command, args, env, label) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${label} exited with ${code ?? signal ?? 'unknown'}`));
    });
  });
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function isolatedBaseEnvironment(source) {
  const clean = {};
  const sensitiveName = /token|secret|password|credential|auth|api[_-]?key|access[_-]?key/i;
  const providerConfig = /^(?:LLM_|IMAGE_|GEMINI_|OPENAI_|ASSEMBLYAI_|SEEDANCE_|KLING_|MUREKA_|MINIMAX_|ELEVENLABS_|DEEPGRAM_|GROQ_|CARTESIA_|DOUBAO_|INWORLD_|FISHAUDIO_|SPEECHIFY_|PEXELS_|PIXABAY_|UNSPLASH_|FREESOUND_|E2B_|FIRECRAWL_|R2_)/;
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || sensitiveName.test(name) || providerConfig.test(name)) continue;
    if (name === 'MEDIA_DIR' || name === 'PROXY_URL'
      || name === 'YOLOCUT_GENERATION_JOB_STORE'
      || name === 'YOLOCUT_PROJECT_STORE_AUTH_DIR') continue;
    clean[name] = value;
  }
  return clean;
}

async function bundleAcceptanceDriver(outfile) {
  const rawPlugin = {
    name: 'acceptance-vite-raw',
    setup(builder) {
      builder.onResolve({ filter: /\?raw$/ }, (args) => ({
        path: resolve(args.resolveDir, args.path.slice(0, -'?raw'.length)),
        namespace: 'acceptance-raw-text',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'acceptance-raw-text' }, async (args) => ({
        contents: await readFile(args.path, 'utf8'),
        loader: 'text',
        resolveDir: dirname(args.path),
      }));
    },
  };
  await build({
    entryPoints: [resolve(root, 'desktop/agent-edit-acceptance-live.ts')],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    outfile,
    plugins: [rawPlugin],
    loader: { '.frag': 'text', '.vert': 'text' },
    logLevel: 'silent',
  });
}

await mkdir(profileDir, { recursive: true });
// An existing file makes the isolated Vite profile ignore checkout .env.local;
// ZCode is connected live through the source-only endpoint below.
await writeFile(resolve(profileDir, 'settings.env'), '', { flag: 'wx', mode: 0o600 }).catch((error) => {
  if (error?.code !== 'EEXIST') throw error;
});
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...isolatedBaseEnvironment(process.env),
  YOLOCUT_DEV_PROFILE_ID: randomUUID(),
  YOLOCUT_DATA_DIR: profileDir,
  YOLOCUT_EDITOR_URL: origin,
};
const vite = spawn(process.execPath, [
  viteCli,
  '--config', 'config/vite.config.ts',
  '--host', '127.0.0.1',
  '--port', String(port),
  '--strictPort',
], { cwd: root, env, stdio: 'inherit', windowsHide: true });

let exitCode = 1;
try {
  process.stdout.write(`[acceptance] isolated source ${origin}\n`);
  process.stdout.write(`[acceptance] dedicated data ${profileDir}\n`);
  await waitForSource(origin, vite);
  await connectZCode(origin);
  const driverBundle = resolve(artifactDir, 'agent-edit-acceptance-driver.mjs');
  await bundleAcceptanceDriver(driverBundle);
  await runChild(process.execPath, [
    driverBundle,
    '--origin', origin,
    '--artifact-dir', artifactDir,
  ], env, 'agent edit acceptance');
  exitCode = 0;
} finally {
  await stop(vite);
  process.stdout.write(`[acceptance] artifacts kept at ${artifactDir}\n`);
}
process.exitCode = exitCode;
