import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { cleanDesktopReleaseOutput } from '../scripts/clean-desktop-release-output.mjs';

const root = await mkdtemp(join(tmpdir(), 'yolocut-release-clean-'));
const resolvedTemp = resolve(tmpdir());
assert.ok(resolve(root).startsWith(`${resolvedTemp}${sep}`));

try {
  const release = join(root, 'release');
  await mkdir(join(release, 'win-unpacked', 'resources'), { recursive: true });
  await writeFile(join(release, 'win-unpacked', 'resources', 'app-update.yml'), 'stale: true\n');
  await writeFile(join(release, 'YoloCut-v0.0.2-x64.exe'), 'current');
  await writeFile(join(release, 'YoloCut-v0.0.2-x64.exe.blockmap'), 'current blockmap');
  await writeFile(join(release, 'latest-x64.yml'), 'version: 0.0.1\n');
  await writeFile(join(release, 'latest.yml'), 'version: 0.0.1\n');
  await writeFile(join(release, 'builder-debug.yml'), 'debug');
  await writeFile(join(release, 'builder-effective-config.yaml'), 'config');
  await writeFile(join(release, 'YoloCut-v0.0.1-x64.exe'), 'previous');
  await writeFile(join(release, 'YoloCut-v0.0.2-arm64.dmg'), 'other platform');

  const removed = await cleanDesktopReleaseOutput({ root, target: 'win32-x64', version: '0.0.2' });
  assert.ok(removed.includes('win-unpacked'));
  assert.ok(removed.includes('latest-x64.yml'));
  await assert.rejects(readFile(join(release, 'win-unpacked', 'resources', 'app-update.yml')));
  await assert.rejects(readFile(join(release, 'YoloCut-v0.0.2-x64.exe')));
  await assert.rejects(readFile(join(release, 'latest-x64.yml')));
  assert.equal(await readFile(join(release, 'YoloCut-v0.0.1-x64.exe'), 'utf8'), 'previous');
  assert.equal(await readFile(join(release, 'YoloCut-v0.0.2-arm64.dmg'), 'utf8'), 'other platform');

  await assert.rejects(
    cleanDesktopReleaseOutput({ root, target: 'win32-arm64' as never, version: '0.0.2' }),
    /unsupported desktop release target/,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('release-output-cleanup.verify: target output is cleaned without touching other versions or platforms');
