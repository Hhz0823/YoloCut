export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Read a current key and copy the first available historical value once. */
export function readMigratedStorageItem(
  storage: KeyValueStorage,
  currentKey: string,
  legacyKeys: readonly string[],
): string | null {
  const current = storage.getItem(currentKey);
  if (current !== null) return current;
  for (const legacyKey of legacyKeys) {
    const legacy = storage.getItem(legacyKey);
    if (legacy === null) continue;
    storage.setItem(currentKey, legacy);
    return legacy;
  }
  return null;
}
