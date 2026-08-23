import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  LEGACY_HOME_DIR_NAMES,
  LEGACY_USER_DATA_DIR_NAMES,
  migrateLegacyEnvironmentText,
} from '../shared/product-compat.ts';

export interface YoloCutCompatibilityResult {
  readonly copiedLegacySettings: boolean;
  readonly copiedLegacySettingsFrom: string | null;
  readonly legacyMediaDir: string | null;
  readonly legacyRuntimeDir: string | null;
}

function hasProfileEntries(path: string): boolean {
  try {
    return readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

/** Explicit Electron profile overrides are isolation boundaries (tests/portable launches). */
export function hasExplicitUserDataDir(argv: readonly string[]): boolean {
  return argv.some((argument) => argument === '--user-data-dir'
    || argument.startsWith('--user-data-dir='));
}

export interface YoloCutUserDataSelection {
  readonly directory: string;
  readonly mountLegacy: boolean;
}

export function selectYoloCutUserData(
  appDataDir: string,
  yoloCutUserDataDir: string,
  argv: readonly string[],
): YoloCutUserDataSelection {
  const mountLegacy = !hasExplicitUserDataDir(argv);
  return {
    directory: mountLegacy
      ? resolveYoloCutUserDataDir(appDataDir, yoloCutUserDataDir)
      : resolve(yoloCutUserDataDir),
    mountLegacy,
  };
}

/**
 * Reuse the most recent browser profile on the first renamed launch. Chromium
 * IndexedDB can contain multi-gigabyte 4K media, so mounting the profile is
 * both safer and much cheaper than copying it into a newly named directory.
 */
export function resolveYoloCutUserDataDir(
  appDataDir: string,
  yoloCutUserDataDir: string,
): string {
  const current = resolve(yoloCutUserDataDir);
  if (hasProfileEntries(current)) return current;
  const appData = resolve(appDataDir);
  return LEGACY_USER_DATA_DIR_NAMES
    .map((name) => join(appData, name))
    .find(hasProfileEntries) ?? current;
}

/**
 * Prepare a distinct YoloCut userData directory without abandoning either
 * preceding product profile. Small settings are copied once. Large media and
 * the existing project runtime remain in place and are mounted as fallbacks,
 * so a brand migration never duplicates user videos or hides old projects.
 */
export function prepareYoloCutCompatibility(
  appDataDir: string,
  yoloCutUserDataDir: string,
  homeDir: string,
): YoloCutCompatibilityResult {
  const appData = resolve(appDataDir);
  const yoloCutUserData = resolve(yoloCutUserDataDir);
  const home = resolve(homeDir);
  const legacyUserDataDirs = LEGACY_USER_DATA_DIR_NAMES.map((name) => join(appData, name));
  mkdirSync(yoloCutUserData, { recursive: true });

  const yoloCutSettings = join(yoloCutUserData, '.env.local');
  let copiedLegacySettings = false;
  let copiedLegacySettingsFrom: string | null = null;
  const legacySettings = legacyUserDataDirs
    .map((directory) => join(directory, '.env.local'))
    .find((path) => existsSync(path));
  if (!existsSync(yoloCutSettings) && legacySettings) {
    try {
      const migratedSettings = migrateLegacyEnvironmentText(
        readFileSync(legacySettings, 'utf8'),
      );
      writeFileSync(yoloCutSettings, migratedSettings, { encoding: 'utf8', flag: 'wx' });
      copiedLegacySettings = true;
      copiedLegacySettingsFrom = legacySettings;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
    }
  }

  const legacyMediaDir = legacyUserDataDirs
    .map((directory) => join(directory, 'public', 'media', 'uploads'))
    .find((path) => existsSync(path)) ?? null;
  const currentRuntimeDir = join(home, '.yolocut');
  const legacyRuntimeDir = existsSync(currentRuntimeDir)
    ? null
    : LEGACY_HOME_DIR_NAMES
      .map((name) => join(home, name))
      .find((path) => existsSync(path)) ?? null;
  return {
    copiedLegacySettings,
    copiedLegacySettingsFrom,
    legacyMediaDir,
    legacyRuntimeDir,
  };
}
