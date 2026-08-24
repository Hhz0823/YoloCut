import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const exportRendering = readFileSync(
  new URL('../server/plugins/export-rendering.ts', import.meta.url),
  'utf8',
);
const e2b = readFileSync(new URL('../server/plugins/e2b.ts', import.meta.url), 'utf8');
const r2 = readFileSync(new URL('../server/r2.ts', import.meta.url), 'utf8');
const updater = readFileSync(new URL('./update-ipc.ts', import.meta.url), 'utf8');
const smokeRunner = readFileSync(
  new URL('../scripts/run-desktop-smoke.mjs', import.meta.url),
  'utf8',
);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts?: Record<string, string>;
};

const shellLoad = main.indexOf('win.loadURL(STARTUP_SHELL_URL)');
const serverLoad = main.indexOf("new URL('./embedded-server.mjs'");
assert.ok(shellLoad >= 0 && serverLoad > shellLoad, 'the native startup shell must appear before the embedded server bundle loads');
assert.doesNotMatch(main, /^import .*embedded-server/m, 'embedded server must stay out of the eager desktop entry graph');
assert.doesNotMatch(main, /^import .*project-store-ipc/m, 'SQLite/search code must stay out of the eager desktop entry graph');
assert.doesNotMatch(main, /^import .*smoke-probe/m, 'test-only MCP clients must stay out of production startup');
assert.match(main, /snapshotDesktopHardwareProfile\(app\)/, 'desktop inference must register from the synchronous host snapshot');
assert.match(main, /hardwarePromise[\s\S]*updateHardware/, 'the complete GPU profile must refresh in the background');
assert.match(main, /PACKAGED_RENDER_WARMUP_DELAY_MS/, 'packaged render assets must warm after first paint');

assert.doesNotMatch(exportRendering, /^import .*remotion\/render/m, 'Remotion must not load with the server route table');
assert.match(exportRendering, /import\(moduleUrl\)/, 'the render runtime must load only on the first render request');
assert.match(exportRendering, /ensureRenderRuntimeReady\(\)/, 'packaged assets must be ready before the lazy render import');
assert.match(e2b, /import type \{ Sandbox \}/, 'E2B startup dependency must be type-only');
assert.match(e2b, /import\('@e2b\/code-interpreter'\)/, 'E2B SDK must load only for an E2B request');
assert.doesNotMatch(r2, /^import (?!type\b).*@aws-sdk/m, 'AWS SDK must not be an eager R2 import');
assert.match(r2, /import\(S3_SDK_MODULE\)/, 'AWS SDK must load only for configured cloud storage work');
assert.doesNotMatch(updater, /^import electronUpdater/m, 'electron-updater must not block desktop module evaluation');
assert.match(updater, /import\('electron-updater'\)/, 'desktop updater must load on the first update operation');
assert.match(smokeRunner, /YOLOCUT_DEV_PROFILE_ID:\s*profileId/);
assert.match(
  smokeRunner,
  /YOLOCUT_DATA_DIR:\s*isolatedDataDir/,
  'desktop smoke must isolate both Chromium and application project data',
);

const desktopBuild = packageJson.scripts?.['desktop:build:main'] ?? '';
assert.match(
  desktopBuild,
  /createRequire as __createRequire/,
  'the packed ESM server must provide require for bundled CommonJS provider dependencies',
);
assert.match(desktopBuild, /--external:sqlite-vec/, 'native SQLite extensions must remain external');
assert.match(
  packageJson.scripts?.['desktop:smoke:post-startup'] ?? '',
  /--post-startup/,
  'desktop verification must cover delayed poster, updater, and model synchronization work',
);
for (const output of [
  'embedded-server.mjs',
  'project-store-ipc.mjs',
  'smoke-probe.mjs',
  'remotion-render.mjs',
]) {
  assert.match(desktopBuild, new RegExp(output.replace('.', '\\.')), `${output} must have an explicit desktop build entry`);
}

console.log('startup-performance.verify: desktop shell and heavy host dependencies are staged lazily');
