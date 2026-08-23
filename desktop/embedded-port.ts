import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { LEGACY_HOME_DIR_NAMES } from '../shared/product-compat.ts';
import { PRODUCT_MACHINE_STATE_DIR_ENV } from '../shared/product-brand.ts';

/** The documented external-MCP address; README and the MCP panel assume it. */
export const CANONICAL_EMBEDDED_PORT = 5199;

export interface EmbeddedPortLocation {
  /** Overridable for tests; never for callers wiring the real server. */
  readonly home?: string;
  /** Isolated dev profiles keep their own memory, exactly like the MCP token:
   *  the profile-scoped instance lock lets a packaged app and a dev checkout
   *  run concurrently, and one memory slot shared between them would ping-pong
   *  at every contended launch — the very instability this file removes. */
  readonly profileId?: string;
}

function configuredMachineStateDir(location: EmbeddedPortLocation): string | null {
  if (location.home !== undefined) return null;
  const configured = process.env[PRODUCT_MACHINE_STATE_DIR_ENV]?.trim();
  if (!configured) return null;
  if (!isAbsolute(configured)) {
    throw new Error(`${PRODUCT_MACHINE_STATE_DIR_ENV} must be an absolute path`);
  }
  return resolve(configured);
}

/** Same HOME-anchored hidden root as the MCP token, and for the same reason:
 *  the user-chosen data dir may be a synced folder, and machine-local wiring
 *  state has no business following a sync service to another machine. */
export function embeddedPortPath(location: EmbeddedPortLocation = {}): string {
  const home = location.home ?? homedir();
  const configured = configuredMachineStateDir(location);
  const base = configured ?? join(home, '.yolocut');
  const root = location.profileId ? join(base, 'dev-profiles', location.profileId) : base;
  return join(root, 'mcp-port');
}

export function readRememberedPort(location: EmbeddedPortLocation = {}): number | null {
  const readPort = (path: string): number | null => {
    try {
      const port = Number(readFileSync(path, 'utf8').trim());
      return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
    } catch {
      return null;
    }
  };
  const current = readPort(embeddedPortPath(location));
  if (current !== null) return current;
  if (location.profileId || configuredMachineStateDir(location) !== null) return null;
  const home = location.home ?? homedir();
  for (const directory of LEGACY_HOME_DIR_NAMES) {
    const port = readPort(join(home, directory, 'mcp-port'));
    if (port === null) continue;
    rememberPort(port, location);
    return port;
  }
  return null;
}

export function rememberPort(port: number, location: EmbeddedPortLocation = {}): boolean {
  try {
    const path = embeddedPortPath(location);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${port}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export interface ListenWithAffinityOptions extends EmbeddedPortLocation {
  /** Overridable for tests; the real server always uses the documented port. */
  readonly canonicalPort?: number;
  readonly log?: (message: string) => void;
}

/**
 * Bind the embedded server to a port external agents can rely on.
 *
 * The last successful port comes first so registered external clients keep a
 * stable endpoint across restarts. The canonical port is used for first launch
 * and as the fallback when a remembered non-canonical port is occupied. Only
 * when both are busy is a fresh random port picked and remembered.
 */
export async function listenWithAffinity(
  server: Server,
  { canonicalPort = CANONICAL_EMBEDDED_PORT, home, profileId, log = console.warn }: ListenWithAffinityOptions = {},
): Promise<number> {
  const listenOn = (port: number) => new Promise<number>((resolvePort, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      const addr = server.address();
      if (addr && typeof addr === 'object') resolvePort(addr.port);
      else reject(new Error('embedded server failed to bind'));
    });
  });
  const inUse = (err: unknown): boolean => (err as NodeJS.ErrnoException).code === 'EADDRINUSE';

  const remembered = readRememberedPort({ home, profileId });
  if (remembered !== null) {
    try {
      const port = await listenOn(remembered);
      if (port !== canonicalPort) log(`[embedded-server] reusing stable MCP port ${port}`);
      return port;
    } catch (err) {
      if (!inUse(err)) throw err;
    }
  }
  if (remembered !== canonicalPort) {
    try {
      const port = await listenOn(canonicalPort);
      rememberPort(port, { home, profileId });
      return port;
    } catch (err) {
      if (!inUse(err)) throw err;
    }
  }
  const port = await listenOn(0);
  rememberPort(port, { home, profileId });
  log(`[embedded-server] preferred MCP ports are in use — falling back to ${port}, kept for future launches; point external MCP clients at the origin logged below`);
  return port;
}
