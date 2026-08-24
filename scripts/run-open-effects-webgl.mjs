import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import electronPath from 'electron';

const tempRoot = resolve(tmpdir());
const userData = mkdtempSync(join(tempRoot, 'yolocut-fx-verify-'));
function cleanupUserData() {
  const target = resolve(userData);
  const child = relative(tempRoot, target);
  if (!child || child.startsWith('..') || isAbsolute(child) || !basename(target).startsWith('yolocut-fx-verify-')) {
    throw new Error(`refusing to remove unexpected WebGL verification profile: ${target}`);
  }
  // Windows can keep Chromium cache handles alive for a brief moment after the
  // Electron process exits. Retry only this verified temporary profile rather
  // than turning a successful shader check into a flaky EPERM failure.
  rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
let result;
try {
  // GitHub-hosted Linux runners cannot configure Electron's root-owned SUID
  // helper inside npm's workspace. The workflow supplies an isolated Xvfb
  // display, so disable the child sandbox only for that disposable CI runner;
  // desktop builds and local verification keep Electron's normal sandbox.
  const linuxCi = process.platform === 'linux' && process.env.CI === 'true';
  const softwareWebgl = linuxCi || process.env.YOLOCUT_WEBGL_VERIFY_SOFTWARE === '1';
  const ciElectronArgs = [
    ...(linuxCi ? ['--no-sandbox'] : []),
    ...(softwareWebgl
      ? [
        '--ignore-gpu-blocklist',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ]
      : []),
  ];
  result = spawnSync(
    electronPath,
    [...ciElectronArgs, `--user-data-dir=${userData}`, 'scripts/verify-open-effects-webgl.mjs'],
    { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
  );
} finally {
  cleanupUserData();
}

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
