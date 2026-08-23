// Shared storage-migration UI helpers (components must stay component-only).
import { fetchWithEditorSession } from '../../persist/projectStoreTransport';

export interface MigrationStatus {
  enabled: boolean;
  phase: 'legacy' | 'migrating' | 'complete' | 'failed';
  receipt: { count: number; importedAt: string } | null;
  jsonKeyCount: number;
  sqliteKeyCount: number;
  error?: string;
}

export interface MigrationSummary {
  imported: number;
  skipped: number;
  quarantined: number;
}

export interface MigrationRunResult {
  summary?: MigrationSummary;
  status?: MigrationStatus;
  enabled?: boolean;
}

export const STORAGE_BANNER_DISMISS_KEY = 'cc.storageMigrationBannerDismissed';

/** Dispatched after a successful migration so the banner can re-check. */
export const STORAGE_MIGRATED_EVENT = 'cc:storage-migrated';

const MIGRATION_ROUTE_MISSING =
  '当前桌面后端未提供数据库迁移接口，请安装与界面版本一致的新版 YoloCut 并重启。';

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function migrationError(value: Record<string, unknown>, fallback: string): Error {
  return new Error(typeof value.error === 'string' && value.error.trim() ? value.error : fallback);
}

async function readMigrationJson(
  response: Response,
  fallback: string,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('text/html') || /^\s*<!doctype\s+html/i.test(text) || /^\s*<html/i.test(text)) {
    throw new Error(MIGRATION_ROUTE_MISSING);
  }
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${fallback}（接口返回的不是有效 JSON，HTTP ${response.status}）`);
  }
  const body = objectValue(parsed);
  if (!body) throw new Error(`${fallback}（接口响应格式无效，HTTP ${response.status}）`);
  if (!response.ok) throw migrationError(body, `${fallback}（HTTP ${response.status}）`);
  return body;
}

function isMigrationStatus(value: unknown): value is MigrationStatus {
  const status = objectValue(value);
  if (!status) return false;
  const receipt = status.receipt;
  return typeof status.enabled === 'boolean'
    && (status.phase === 'legacy'
      || status.phase === 'migrating'
      || status.phase === 'complete'
      || status.phase === 'failed')
    && (receipt === null || (
      objectValue(receipt) !== null
      && typeof (receipt as Record<string, unknown>).count === 'number'
      && typeof (receipt as Record<string, unknown>).importedAt === 'string'
    ))
    && typeof status.jsonKeyCount === 'number'
    && typeof status.sqliteKeyCount === 'number'
    && (status.error === undefined || typeof status.error === 'string');
}

/** Delete the migrated legacy JSON files. Requires explicit user consent. */
export async function cleanupLegacyJson(): Promise<{ removed: number; jsonKeyCount: number }> {
  const response = await fetchWithEditorSession('/api/project-store/migrate-cleanup', {
    method: 'POST',
  });
  const body = await readMigrationJson(response, '清理旧 JSON 数据失败');
  if (typeof body.removed !== 'number') throw new Error('清理旧 JSON 数据失败（接口响应格式无效）');
  return {
    removed: body.removed,
    jsonKeyCount: typeof body.jsonKeyCount === 'number' ? body.jsonKeyCount : 0,
  };
}

export async function loadMigrationStatus(): Promise<MigrationStatus> {
  const response = await fetchWithEditorSession('/api/project-store/migrate-status', { method: 'GET' });
  const body = await readMigrationJson(response, '读取数据库迁移状态失败');
  if (!isMigrationStatus(body)) throw new Error('读取数据库迁移状态失败（接口响应格式无效）');
  return body;
}

export async function runStorageMigration(): Promise<MigrationRunResult> {
  const response = await fetchWithEditorSession('/api/project-store/migrate', { method: 'POST' });
  const body = await readMigrationJson(response, '迁移到 SQLite 失败');
  const status = body.status;
  if (status !== undefined && !isMigrationStatus(status)) {
    throw new Error('迁移到 SQLite 失败（接口响应格式无效）');
  }
  const summary = objectValue(body.summary);
  return {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    status: status as MigrationStatus | undefined,
    summary: summary
      && typeof summary.imported === 'number'
      && typeof summary.skipped === 'number'
      && typeof summary.quarantined === 'number'
      ? {
        imported: summary.imported,
        skipped: summary.skipped,
        quarantined: summary.quarantined,
      }
      : undefined,
  };
}
