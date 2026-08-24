import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hasExplicitUserDataDir,
  prepareYoloCutCompatibility,
  resolveYoloCutUserDataDir,
  selectYoloCutUserData,
} from './yolocut-compat';

assert.equal(hasExplicitUserDataDir(['YoloCut.exe']), false);
assert.equal(hasExplicitUserDataDir(['YoloCut.exe', '--user-data-dir=C:\\isolated']), true);
assert.equal(hasExplicitUserDataDir(['YoloCut.exe', '--user-data-dir', 'C:\\isolated']), true);
const isolatedUserData = join(tmpdir(), 'yolocut-isolated');
assert.deepEqual(
  selectYoloCutUserData(join(tmpdir(), 'app-data'), isolatedUserData, [
    'YoloCut.exe',
    `--user-data-dir=${isolatedUserData}`,
  ]),
  { directory: isolatedUserData, mountLegacy: false },
);

const root = await mkdtemp(join(tmpdir(), 'yolocut-compat-'));
try {
  const appData = join(root, 'app-data');
  const home = join(root, 'home');
  const recentLegacy = join(appData, 'ChatCut');
  const olderLegacy = join(appData, 'OpenChatCut');
  const current = join(appData, 'YoloCut');
  const legacyMedia = join(recentLegacy, 'public', 'media', 'uploads');
  const legacyRuntime = join(home, '.chatcut');
  await mkdir(legacyMedia, { recursive: true });
  await mkdir(join(olderLegacy, 'public', 'media', 'uploads'), { recursive: true });
  await mkdir(legacyRuntime, { recursive: true });
  await writeFile(
    join(recentLegacy, '.env.local'),
    [
      'MODEL_KEY=recent-legacy-secret',
      'CHATCUT_MCP_TOKEN=recent-token',
      'export OPENCHATCUT_H264_ENCODER=legacy-encoder',
      'COMMENT=OPENCHATCUT_VALUE_MUST_NOT_CHANGE',
      '',
    ].join('\n'),
  );
  await writeFile(join(olderLegacy, '.env.local'), 'MODEL_KEY=older-legacy-secret\n');
  await writeFile(join(legacyMedia, 'existing.mp4'), 'legacy-media');

  assert.equal(
    resolveYoloCutUserDataDir(appData, current),
    recentLegacy,
    'first YoloCut launch mounts the newest populated browser profile without copying media',
  );

  const first = prepareYoloCutCompatibility(appData, current, home);
  assert.equal(first.copiedLegacySettings, true);
  assert.equal(first.copiedLegacySettingsFrom, join(recentLegacy, '.env.local'));
  assert.equal(first.legacyMediaDir, legacyMedia);
  assert.equal(first.legacyRuntimeDir, legacyRuntime);
  assert.equal(
    await readFile(join(current, '.env.local'), 'utf8'),
    [
      'MODEL_KEY=recent-legacy-secret',
      'YOLOCUT_MCP_TOKEN=recent-token',
      'export YOLOCUT_H264_ENCODER=legacy-encoder',
      'COMMENT=OPENCHATCUT_VALUE_MUST_NOT_CHANGE',
      '',
    ].join('\n'),
  );

  await writeFile(join(current, '.env.local'), 'MODEL_KEY=yolocut-setting\n');
  assert.equal(resolveYoloCutUserDataDir(appData, current), current, 'a populated YoloCut profile wins');
  const second = prepareYoloCutCompatibility(appData, current, home);
  assert.equal(second.copiedLegacySettings, false, 'YoloCut settings always win after first launch');
  assert.equal(await readFile(join(current, '.env.local'), 'utf8'), 'MODEL_KEY=yolocut-setting\n');
  assert.equal(await readFile(join(legacyMedia, 'existing.mp4'), 'utf8'), 'legacy-media');

  await mkdir(join(home, '.yolocut'), { recursive: true });
  const migrated = prepareYoloCutCompatibility(appData, current, home);
  assert.equal(migrated.legacyRuntimeDir, null, 'an existing YoloCut runtime always wins');
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('yolocut-compat.verify: settings copy-once and non-destructive legacy media fallback OK');
