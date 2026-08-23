import type { ZCodePublicStatus } from '../../../shared/zcode';

export type ZCodeStatusTone = 'ready' | 'warning' | 'error' | 'idle';

export function zcodeStatusTone(status: ZCodePublicStatus | null): ZCodeStatusTone {
  if (!status) return 'idle';
  if (status.authenticated) return 'ready';
  if (status.running || status.installed) return 'warning';
  return status.supported ? 'error' : 'idle';
}

export function parseZCodeStatus(value: unknown): ZCodePublicStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<ZCodePublicStatus>;
  const booleans = [row.supported, row.installed, row.running, row.authenticated, row.keyAvailable];
  if (!booleans.every((entry) => typeof entry === 'boolean')) return null;
  if (row.port !== null && (!Number.isSafeInteger(row.port) || Number(row.port) < 1 || Number(row.port) > 65_535)) return null;
  if (row.baseUrl !== null && typeof row.baseUrl !== 'string') return null;
  if (row.version !== null && typeof row.version !== 'string') return null;
  if (typeof row.message !== 'string' || row.message.length > 500) return null;
  if (!Array.isArray(row.models) || !row.models.every((model) => typeof model === 'string' && model.length <= 200)) return null;
  return row as ZCodePublicStatus;
}
