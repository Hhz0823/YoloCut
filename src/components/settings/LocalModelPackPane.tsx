import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { useT } from '../../i18n/locale';
import { theme } from '../../theme';
import {
  cancelModelPackInstall,
  deleteModelPack,
  fetchModelPackCatalog,
  installModelPack,
  type ModelPackCatalogEntry,
  type ModelPackId,
} from '../../../shared/model-packs';
import { executeModelPackMutation, type ModelPackMutation } from './model-pack-actions';

const POLL_MS = 1_000;
type PackErrors = Partial<Record<ModelPackId, string | undefined>>;

function formatBytes(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GB` : `${Math.round(mib)} MB`;
}

function progressPercent(pack: ModelPackCatalogEntry): number {
  const task = pack.task;
  if (!task || task.status !== 'downloading') return 0;
  if (task.bytesTotal > 0) return Math.min(100, Math.round(task.bytesDone / task.bytesTotal * 100));
  if (task.filesTotal > 0) return Math.min(100, Math.round(task.filesDone / task.filesTotal * 100));
  return 0;
}

function usePackCatalog() {
  const [packs, setPacks] = useState<readonly ModelPackCatalogEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setPacks(await fetchModelPackCatalog());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const downloading = (packs ?? []).some((pack) => pack.status === 'downloading');
  useEffect(() => {
    if (!downloading) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [downloading, refresh]);
  return { packs, loadError, refresh };
}

function usePackActions(refresh: () => Promise<void>) {
  const [busyId, setBusyId] = useState<ModelPackId | null>(null);
  const [errors, setErrors] = useState<PackErrors>({});
  const perform = useCallback(async (
    id: ModelPackId,
    action: ModelPackMutation,
    licenseAcceptance?: string,
  ) => {
    setBusyId(id);
    setErrors((current) => ({ ...current, [id]: undefined }));
    try {
      await executeModelPackMutation(id, action, { licenseAcceptance });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrors((current) => ({ ...current, [id]: message }));
    } finally {
      setBusyId(null);
    }
  }, [refresh]);
  return {
    busyId,
    errors,
    cancel: (id: ModelPackId) => perform(id, cancelModelPackInstall),
    install: (id: ModelPackId, licenseAcceptance?: string) => perform(id, installModelPack, licenseAcceptance),
    remove: (id: ModelPackId) => perform(id, deleteModelPack),
  };
}

interface LocalModelPackPaneProps {
  packIds?: readonly ModelPackId[];
  title?: string;
  description?: string;
  filter?: (pack: ModelPackCatalogEntry) => boolean;
  emptyState?: ReactNode;
  renderExtraMetadata?: (pack: ModelPackCatalogEntry) => ReactNode;
  renderAfter?: (packs: readonly ModelPackCatalogEntry[]) => ReactNode;
}

export function LocalModelPackPane({
  packIds,
  title = '本地智能模型',
  description = '模型不会自动安装。安装后，节拍与音乐语义分析只在本机运行。',
  filter,
  emptyState,
  renderExtraMetadata,
  renderAfter,
}: LocalModelPackPaneProps) {
  const t = useT();
  const { packs, loadError, refresh } = usePackCatalog();
  const actions = usePackActions(refresh);
  const headingId = useId();
  const visiblePacks = packs?.filter((pack) => (
    (!packIds || packIds.includes(pack.id)) && (!filter || filter(pack))
  )) ?? [];
  return (
    <section style={sectionStyle} aria-labelledby={headingId} aria-busy={!packs && !loadError}>
      <div>
        <div id={headingId} style={{ fontSize: 12.5, fontWeight: 650 }}>{t(title)}</div>
        <div style={{ marginTop: 3, fontSize: 11.5, color: theme.textDim }}>{t(description)}</div>
      </div>
      {loadError && <div role="alert" style={errorStyle}>
        <span>{t('无法读取模型包列表：{err}', { err: loadError })}</span>
        <button type="button" onClick={() => void refresh()} style={{ ...smallButton, marginLeft: 8 }}>{t('重试')}</button>
      </div>}
      {!loadError && !packs && <div style={hintStyle}>{t('读取中…')}</div>}
      {visiblePacks.map((pack) => (
        <PackCard key={pack.id} pack={pack} busy={actions.busyId === pack.id}
          error={actions.errors[pack.id]} install={actions.install} remove={actions.remove}
          cancel={actions.cancel} renderExtraMetadata={renderExtraMetadata} />
      ))}
      {!loadError && packs && visiblePacks.length === 0 && emptyState}
      {!loadError && packs && renderAfter?.(visiblePacks)}
    </section>
  );
}

interface PackCardProps {
  pack: ModelPackCatalogEntry;
  busy: boolean;
  error?: string;
  install: (id: ModelPackId, licenseAcceptance?: string) => Promise<unknown>;
  remove: (id: ModelPackId) => Promise<unknown>;
  cancel: (id: ModelPackId) => Promise<unknown>;
  renderExtraMetadata?: (pack: ModelPackCatalogEntry) => ReactNode;
}

function PackCard({ pack, busy, error: actionError, install, remove, cancel, renderExtraMetadata }: PackCardProps) {
  const t = useT();
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const error = actionError ?? pack.error ?? pack.task?.error;
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, fontWeight: 650 }}>{t(pack.label)}</span>
            <PackStatus pack={pack} />
          </div>
          <PackMetadata pack={pack} />
          {pack.licensePolicy && <label style={licenseStyle}>
            <input
              type="checkbox"
              checked={licenseAccepted}
              disabled={pack.status === 'downloading'}
              onChange={(event) => setLicenseAccepted(event.target.checked)}
            />
            <span>
              {t(pack.licensePolicy.notice)}{' '}
              <a href={pack.licensePolicy.url} target="_blank" rel="noreferrer">{t('查看许可证')}</a>
            </span>
          </label>}
          {renderExtraMetadata?.(pack)}
        </div>
        <PackActions pack={pack} busy={busy} install={install} remove={remove} cancel={cancel}
          licenseAccepted={licenseAccepted} />
      </div>
      {pack.status === 'downloading' && <PackProgress pack={pack} />}
      {error && <div role="alert" style={{ ...errorStyle, marginTop: 7 }}>{error}</div>}
    </div>
  );
}


function PackMetadata({ pack }: { pack: ModelPackCatalogEntry }) {
  const t = useT();
  return <>
    <div style={{ marginTop: 3, fontSize: 11, color: theme.textDim }}>
      {formatBytes(pack.sizeBytes)} · {pack.license} · {t('建议内存 {memory}', {
        memory: formatBytes(pack.recommendedMemoryBytes),
      })}
    </div>
    <div style={{ marginTop: 5, fontSize: 11.5, color: theme.text }}>
      {pack.capabilities.map((capability) => t(capability)).join(' · ')}
    </div>
    <div style={{ marginTop: 3, fontSize: 11, color: theme.textDim }}>{t(pack.description)}</div>
  </>;
}

function PackProgress({ pack }: { pack: ModelPackCatalogEntry }) {
  const t = useT();
  const percent = progressPercent(pack);
  return <div style={{ marginTop: 8 }} role="status" aria-live="polite">
    <div
      role="progressbar"
      aria-label={t('模型安装进度')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      style={progressTrack}
    ><div style={{ ...progressFill, width: `${percent}%` }} /></div>
    <div style={{ marginTop: 3, fontSize: 10.5, color: theme.textDim }}>
      {t('安装中 {pct}%（{done}/{total} 个文件）', {
        pct: percent,
        done: pack.task?.filesDone ?? 0,
        total: pack.task?.filesTotal ?? pack.files.length,
      })}
    </div>
  </div>;
}

function PackStatus({ pack }: { pack: ModelPackCatalogEntry }) {
  const t = useT();
  const display = pack.status === 'installed'
    ? { text: t('已安装'), color: theme.success }
    : pack.status === 'downloading'
      ? { text: t('安装中'), color: theme.accent }
      : pack.status === 'error'
        ? { text: t('安装错误'), color: theme.danger }
        : { text: t('未安装'), color: theme.textDim };
  return <span style={{ fontSize: 10.5, color: display.color }}>{display.text}</span>;
}

function PackActions({
  pack, busy, install, remove, cancel, licenseAccepted,
}: Omit<PackCardProps, 'error' | 'renderExtraMetadata'> & { licenseAccepted: boolean }) {
  const t = useT();
  const runtimeBlocked = pack.runtimeAvailability?.available === false;
  if (pack.status === 'downloading') {
    return <button type="button" disabled={busy} onClick={() => void cancel(pack.id)} style={smallButton}>{t('取消')}</button>;
  }
  if (pack.status === 'installed') {
    return <button type="button" disabled={busy} onClick={() => void remove(pack.id)} style={smallButton}>{t('删除')}</button>;
  }
  return <div style={{ display: 'flex', gap: 5 }}>
    {pack.status === 'error' && (
      <button type="button" disabled={busy} onClick={() => void remove(pack.id)} style={smallButton}>{t('删除')}</button>
    )}
    <button
      type="button"
      disabled={busy || runtimeBlocked || Boolean(pack.licensePolicy && !licenseAccepted)}
      title={runtimeBlocked ? pack.runtimeAvailability?.reason : undefined}
      onClick={() => void install(pack.id, licenseAccepted ? pack.licensePolicy?.acceptanceId : undefined)}
      style={installButton}
    >
      {pack.status === 'error' ? t('重新安装') : t('安装')}
    </button>
  </div>;
}

const sectionStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 9, marginTop: 16, paddingTop: 14,
  borderTop: `1px solid ${theme.border}`,
};
const cardStyle: React.CSSProperties = {
  padding: '10px 11px', borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.panel,
};
const hintStyle: React.CSSProperties = { fontSize: 11.5, color: theme.textDim };
const errorStyle: React.CSSProperties = { fontSize: 11, color: theme.danger, overflowWrap: 'anywhere' };
const licenseStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 7, color: theme.gold,
  fontSize: 10.5, lineHeight: 1.45,
};
const smallButton: React.CSSProperties = {
  border: `1px solid ${theme.border}`, borderRadius: 6, background: 'transparent', color: theme.text,
  fontSize: 11, padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap',
};
const installButton: React.CSSProperties = { ...smallButton, borderColor: theme.accent, color: theme.accent };
const progressTrack: React.CSSProperties = {
  height: 4, overflow: 'hidden', borderRadius: 2, background: theme.border,
};
const progressFill: React.CSSProperties = {
  height: '100%', borderRadius: 2, background: theme.accent, transition: 'width 180ms ease',
};
