import assert from 'node:assert/strict';
import { readMigratedStorageItem, type KeyValueStorage } from './storageKeyMigration';

const values = new Map<string, string>();
const storage: KeyValueStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); },
};

values.set('legacy', 'right');
assert.equal(readMigratedStorageItem(storage, 'current', ['legacy']), 'right');
assert.equal(values.get('current'), 'right', 'legacy preference is copied once');
values.set('current', 'left');
values.set('legacy', 'right');
assert.equal(readMigratedStorageItem(storage, 'current', ['legacy']), 'left', 'current preference wins');

console.log('storageKeyMigration.verify: copy-once compatibility and current-key precedence OK');
