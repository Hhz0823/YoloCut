import assert from 'node:assert/strict';
import {
  cleanupLegacyJson,
  loadMigrationStatus,
  runStorageMigration,
} from './storageMigration.ts';

const originalFetch = globalThis.fetch;

function mockResponse(body: string, init: ResponseInit = {}): void {
  globalThis.fetch = async () => new Response(body, init);
}

try {
  mockResponse('<!doctype html><html><body>YoloCut</body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
  await assert.rejects(
    loadMigrationStatus(),
    /桌面后端未提供数据库迁移接口/,
    'a static HTML fallback must produce an actionable version mismatch instead of JSON.parse noise',
  );

  mockResponse(JSON.stringify({
    enabled: true,
    phase: 'complete',
    receipt: { count: 25, importedAt: '2026-08-11T10:33:00.116Z' },
    jsonKeyCount: 25,
    sqliteKeyCount: 60,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const status = await loadMigrationStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.sqliteKeyCount, 60);

  mockResponse(JSON.stringify({
    summary: { imported: 25, skipped: 0, quarantined: 0 },
    enabled: true,
    status,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const migrated = await runStorageMigration();
  assert.equal(migrated.status?.phase, 'complete');
  assert.equal(migrated.summary?.imported, 25);

  mockResponse(JSON.stringify({ error: 'migration refused unreadable legacy data' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
  await assert.rejects(runStorageMigration(), /migration refused unreadable legacy data/);

  mockResponse(JSON.stringify({ removed: 25, jsonKeyCount: 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  assert.deepEqual(await cleanupLegacyJson(), { removed: 25, jsonKeyCount: 0 });
} finally {
  globalThis.fetch = originalFetch;
}

console.log('storageMigration.verify: desktop HTML fallback, status, migration, errors, and cleanup passed');
