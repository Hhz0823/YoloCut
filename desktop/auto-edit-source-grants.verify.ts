import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEGACY_PORTABLE_FORMATS } from '../shared/product-compat.ts';

import { AutoEditSourceGrantStore } from './auto-edit-source-grants.ts';

const root = await mkdtemp(join(tmpdir(), 'yolocut-auto-edit-source-'));
try {
  const media = join(root, 'media');
  await mkdir(join(media, 'nested'), { recursive: true });
  await writeFile(join(media, 'a.mp4'), 'video');
  await writeFile(join(media, 'nested', 'b.wav'), 'audio');
  await writeFile(join(media, 'ignored.exe'), 'ignored');
  const grantsPath = join(root, 'grants.json');
  const store = new AutoEditSourceGrantStore(grantsPath);
  const selection = await store.grantDirectory(media);
  assert.equal(selection.sources.length, 2);
  assert.equal(selection.sources.some((source) => source.relativeName.includes('nested/')), true);
  assert.equal(JSON.stringify(selection).includes(media), false, 'absolute paths never cross IPC');
  assert.deepEqual(await store.selection(selection.grantId), selection);
  const snapshot = JSON.parse(await readFile(grantsPath, 'utf8')) as Record<string, unknown>;
  await writeFile(grantsPath, JSON.stringify({
    ...snapshot,
    format: LEGACY_PORTABLE_FORMATS.autoEditSourceGrants,
  }));
  const migratedStore = new AutoEditSourceGrantStore(grantsPath);
  assert.deepEqual(await migratedStore.selection(selection.grantId), selection);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('auto-edit-source-grants.verify: 10k-ready opaque directory grant scan passed');
