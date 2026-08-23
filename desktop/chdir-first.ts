// The packaged version nails cwd to the .env.local path of userData:keystore and the default upload directory is anchored in
// process.cwd() (module top-level evaluation), use chdir once to let the two naturally fall into the user-writable area, server side
// Zero modifications. Must be evaluated before the import chain of embedded-server - keep this module in main.ts
// The first import (ESM is executed depth first in declaration order). dev (unpackaged) inherits the startup cwd (worktree root).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import {
  MIGRATED_MEDIA_DIR_ENV,
  PRODUCT_DATA_DIR_ENV,
  PRODUCT_MACHINE_STATE_DIR_ENV,
} from '../shared/product-brand.ts';
import { applyLegacyEnvironmentAliases } from '../shared/product-compat.ts';
import {
  prepareYoloCutCompatibility,
  selectYoloCutUserData,
} from './yolocut-compat.ts';

applyLegacyEnvironmentAliases(process.env);

if (app.isPackaged) {
  const configuredDir = app.getPath('userData');
  const selection = selectYoloCutUserData(app.getPath('appData'), configuredDir, process.argv);
  const dir = selection.directory;
  if (dir !== configuredDir) app.setPath('userData', dir);
  mkdirSync(dir, { recursive: true });
  if (selection.mountLegacy) {
    const compatibility = prepareYoloCutCompatibility(
      app.getPath('appData'),
      dir,
      app.getPath('home'),
    );
    if (compatibility.legacyMediaDir && !process.env[MIGRATED_MEDIA_DIR_ENV]) {
      process.env[MIGRATED_MEDIA_DIR_ENV] = compatibility.legacyMediaDir;
    }
    if (compatibility.legacyRuntimeDir && !process.env[PRODUCT_DATA_DIR_ENV]) {
      process.env[PRODUCT_DATA_DIR_ENV] = compatibility.legacyRuntimeDir;
    }
  } else {
    process.env[PRODUCT_DATA_DIR_ENV] ||= join(dir, 'runtime');
    process.env[PRODUCT_MACHINE_STATE_DIR_ENV] ||= join(dir, 'machine-state');
  }
  process.chdir(dir);
}
