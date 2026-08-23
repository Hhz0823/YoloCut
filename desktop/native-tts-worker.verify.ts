import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  backendFromProfile,
  installOfflineNetworkGuards,
  kokoroStyleOffset,
  type OfflineNetworkTargets,
} from './native-tts-worker.ts';

const original = (): string => 'network';
const targets = {
  global: { fetch: original },
  http: { request: original, get: original },
  https: { request: original, get: original },
  net: { connect: original, createConnection: original },
  tls: { connect: original },
  dns: { lookup: original, resolve: original, resolve4: original, resolve6: original, resolveAny: original },
  dnsPromises: { lookup: original, resolve: original, resolve4: original, resolve6: original, resolveAny: original },
  dgram: { createSocket: original },
} satisfies OfflineNetworkTargets;
installOfflineNetworkGuards(targets);
for (const module of Object.values(targets)) {
  for (const fn of Object.values(module)) assert.throws(() => (fn as () => unknown)(), /network access is disabled/);
}

assert.equal(backendFromProfile([
  { args: { provider: 'WebGpuExecutionProvider' } },
  { args: { provider: 'CPUExecutionProvider' } },
]), 'webgpu');
assert.equal(backendFromProfile([{ args: { provider: 'CPUExecutionProvider' } }]), 'cpu');
assert.equal(backendFromProfile(null), 'cpu');
assert.equal(kokoroStyleOffset(45, 51), ((45 * 510) + 49) * 256);
assert.equal(kokoroStyleOffset(52, 1_000), ((52 * 510) + 509) * 256);
assert.equal(kokoroStyleOffset(45, 1), (45 * 510) * 256);

const source = await readFile(new URL('./native-tts-worker.ts', import.meta.url), 'utf8');
assert.match(source, /executionProviders: backend === 'webgpu' \? \['webgpu', 'cpu'\] : \['cpu'\]/);
assert.match(source, /enableMemPattern: false/);
assert.match(source, /executionMode: 'sequential'/);
assert.doesNotMatch(source, /freeDimensionOverrides/,
  'dynamic sequence_length must remain reusable without a fixed override');
assert.doesNotMatch(source, /directml|cuda/i, 'runtime/backend audit contract is webgpu or cpu only');
assert.match(source, /let runtime: LoadedRuntime \| null/);
assert.match(source, /if \(state\.session\) return state/,
  'one long-lived worker reuses the compiled dynamic session across jobs');
assert.match(source, /resolve\(input\.outputPath\) !== resolve\(input\.workDir, 'output\.wav'\)/,
  'Windows TEMP 8.3 aliases must not invalidate a caller-consistent output path');
assert.match(source, /const gain = peak > 0\.98 \? 0\.98 \/ peak : 1/,
  'PCM conversion must normalize overs before quantization instead of clipping');

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  dependencies: Record<string, string>;
  overrides?: Record<string, string>;
};
assert.equal(packageJson.dependencies['@uzen/kokoro-js'], '1.2.4');
assert.equal(packageJson.dependencies['onnxruntime-node'], '1.27.0');
assert.equal(packageJson.overrides?.['onnxruntime-node'], '1.27.0');

console.log('native-tts-worker.verify: offline guards, style layout, profile backend, dynamic WebGPU session reuse OK');
