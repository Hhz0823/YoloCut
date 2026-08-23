import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateMcpToken, mcpTokenPath } from './mcp-token.ts';
import { PRODUCT_MACHINE_STATE_DIR_ENV } from '../shared/product-brand.ts';

const home = mkdtempSync(join(tmpdir(), 'occ-mcp-token-'));
try {
  // First launch mints a token and persists it; the registered `claude mcp add`
  // command must keep working after the app restarts, so a second load has to
  // return the SAME token rather than minting again.
  const first = loadOrCreateMcpToken({ home });
  assert.equal(first.persisted, true, 'first launch persists the token');
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/, 'token keeps the historical shape');
  const second = loadOrCreateMcpToken({ home });
  assert.equal(second.token, first.token, 'a restart serves the same token');

  // The secret must not be world-readable, and must not live under the movable
  // data dir (which may be a synced folder): HOME-anchored hidden root only.
  const path = mcpTokenPath({ home });
  assert.ok(path.startsWith(join(home, '.yolocut')), 'token lives under the hidden home root');
  if (process.platform !== 'win32') {
    assert.equal(statSync(path).mode & 0o777, 0o600, 'token file is owner-only');
  }
  assert.equal(readFileSync(path, 'utf8').trim(), first.token);

  // Isolated dev profiles keep their own token so two checkouts never share a
  // credential, and the default profile never reads a profile's token.
  const profiled = loadOrCreateMcpToken({ home, profileId: '5a4c1e9e-1111-4222-8333-444455556666' });
  assert.notEqual(profiled.token, first.token, 'profiles are credential-isolated');
  assert.equal(
    loadOrCreateMcpToken({ home, profileId: '5a4c1e9e-1111-4222-8333-444455556666' }).token,
    profiled.token,
    'a profile token is stable too',
  );

  // A malformed file is replaced, not trusted: serving arbitrary file content
  // would turn a corrupted write into the endpoint's credential.
  // Written deliberately world-readable: the heal must not inherit that.
  writeFileSync(path, 'pas-un-jeton\n', { mode: 0o644 });
  const healed = loadOrCreateMcpToken({ home });
  assert.match(healed.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(healed.token, 'pas-un-jeton');
  assert.equal(readFileSync(path, 'utf8').trim(), healed.token, 'the healed token is written back');
  if (process.platform !== 'win32') {
    assert.equal(statSync(path).mode & 0o777, 0o600, 'healing sheds the loose permissions of the old file');
  }

  // Losing the first-mint race adopts the winner: the file was created between
  // our failed read and our exclusive write, and both processes must end up
  // serving the token the file actually holds.
  rmSync(path);
  const raceWinner = 'W'.repeat(43);
  const noteThenWrite = () => writeFileSync(path, raceWinner + '\n', { mode: 0o600, flag: 'wx' });
  noteThenWrite();
  assert.equal(loadOrCreateMcpToken({ home }).token, raceWinner, 'an existing exclusive write wins the race');

  // A first YoloCut launch adopts the newest valid legacy token so existing
  // Agent registrations keep authenticating without copying a new secret.
  const migrationHome = join(home, 'migration');
  const legacyToken = 'L'.repeat(43);
  const legacyTokenPath = join(migrationHome, '.chatcut', 'mcp-token');
  mkdirSync(join(migrationHome, '.chatcut'), { recursive: true });
  writeFileSync(legacyTokenPath, `${legacyToken}\n`, { mode: 0o600 });
  const migrated = loadOrCreateMcpToken({ home: migrationHome });
  assert.equal(migrated.token, legacyToken, 'legacy registration token is preserved');
  assert.equal(readFileSync(mcpTokenPath({ home: migrationHome }), 'utf8').trim(), legacyToken);

  // A filesystem that refuses writes degrades to the old per-process token
  // instead of refusing to serve. A regular file blocking the expected hidden
  // directory is deterministic on Windows and POSIX (chmod is not on Windows).
  const lockedHome = join(home, 'locked');
  mkdirSync(lockedHome, { recursive: true });
  writeFileSync(join(lockedHome, '.yolocut'), 'directory blocked by a file');
  const volatile = loadOrCreateMcpToken({ home: lockedHome });
  assert.equal(volatile.persisted, false, 'unwritable home reports non-persistence');
  assert.match(volatile.token, /^[A-Za-z0-9_-]{43}$/, 'a usable token is still served');

  const previousMachineState = process.env[PRODUCT_MACHINE_STATE_DIR_ENV];
  const isolatedMachineState = join(home, 'isolated-machine-state');
  process.env[PRODUCT_MACHINE_STATE_DIR_ENV] = isolatedMachineState;
  const isolated = loadOrCreateMcpToken();
  assert.equal(mcpTokenPath(), join(isolatedMachineState, 'mcp-token'));
  assert.equal(readFileSync(mcpTokenPath(), 'utf8').trim(), isolated.token);
  if (previousMachineState === undefined) delete process.env[PRODUCT_MACHINE_STATE_DIR_ENV];
  else process.env[PRODUCT_MACHINE_STATE_DIR_ENV] = previousMachineState;

  // The environment override wins without touching the filesystem, which is
  // what pins the token for scripted setups and tests.
  process.env.YOLOCUT_MCP_TOKEN = ' jeton-fixe-depuis-env ';
  const { externalMcpToken } = await import('./editor-auth.ts');
  assert.equal(externalMcpToken(), 'jeton-fixe-depuis-env', 'env override wins, trimmed');

  console.log('mcp-token.verify OK');
} finally {
  rmSync(home, { recursive: true, force: true });
}
