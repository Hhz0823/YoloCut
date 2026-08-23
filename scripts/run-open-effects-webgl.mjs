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
  rmSync(target, { recursive: true, force: true });
}
let result;
try {
  result = spawnSync(
    electronPath,
    [`--user-data-dir=${userData}`, 'scripts/verify-open-effects-webgl.mjs'],
    { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
  );
} finally {
  cleanupUserData();
}

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
