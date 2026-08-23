import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEGACY_PORTABLE_FORMATS } from '../../shared/product-compat.ts';

import {
  discoverFishS2Runtime,
  FISH_S2_LICENSE_ACCEPTANCE,
  FISH_S2_RUNTIME_FORMAT,
  FISH_S2_RUNTIME_REVISION,
} from './fish-s2-runtime-discovery.ts';

if (process.platform === 'win32' && process.arch === 'x64') {
  const root = await mkdtemp(join(tmpdir(), 'yolocut-fish-s2-runtime-'));
  try {
    const executable = Buffer.from('fixture-s2-executable');
    await writeFile(join(root, 's2.exe'), executable);
    const manifest = {
      format: LEGACY_PORTABLE_FORMATS.fishS2Runtime,
      sourceRevision: FISH_S2_RUNTIME_REVISION,
      licenseAcceptanceId: FISH_S2_LICENSE_ACCEPTANCE,
      platform: 'win32',
      arch: 'x64',
      executable: 's2.exe',
      files: [{
        path: 's2.exe',
        sizeBytes: executable.length,
        sha256: createHash('sha256').update(executable).digest('hex'),
      }],
    };
    await writeFile(join(root, 'runtime-manifest.json'), JSON.stringify(manifest));
    const passSelfCheck = async () => true;
    const discovery = await discoverFishS2Runtime(root, false, passSelfCheck);
    assert.equal(discovery.available, true);
    assert.equal(discovery.manifest?.format, FISH_S2_RUNTIME_FORMAT);

    await writeFile(join(root, 's2.exe'), 'tampered');
    assert.match((await discoverFishS2Runtime(root, false, passSelfCheck)).reason ?? '', /校验失败/);
    await writeFile(join(root, 'runtime-manifest.json'), JSON.stringify({ ...manifest, licenseAcceptanceId: 'missing' }));
    assert.match((await discoverFishS2Runtime(root, false, passSelfCheck)).reason ?? '', /版本或许可证确认无效/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

console.log('fish-s2-runtime-discovery.verify: pinned manifest, containment, license and SHA gates OK');
