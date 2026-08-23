import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { ZCodePublicStatus } from '../../../shared/zcode';
import { useT } from '../../i18n/locale';
import { theme, themeAlpha } from '../../theme';
import { Icon } from '../icons';
import type { KeyStatusResponse } from './settingsSchema';
import { parseZCodeStatus, zcodeStatusTone } from './zcodeConnectionModel';

const APPLIED_FIELDS = [
  'LLM_PROVIDER',
  'LLM_ZCODE_API_KEY',
  'LLM_ZCODE_BASE_URL',
  'LLM_ZCODE_MODEL',
] as const;

interface ConnectResponse {
  readonly status: ZCodePublicStatus;
  readonly settings: KeyStatusResponse;
}

interface ErrorResponse {
  readonly error?: unknown;
  readonly status?: unknown;
}

function safeError(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const error = (value as ErrorResponse).error;
  return typeof error === 'string' && error.length <= 500 ? error : fallback;
}

export function ZCodeConnectionCard({
  onSettingsApplied,
  onModelsDiscovered,
}: {
  onSettingsApplied: (status: KeyStatusResponse, clearedFields: readonly string[]) => void;
  onModelsDiscovered: (name: string, models: readonly string[]) => void;
}) {
  const t = useT();
  const [status, setStatus] = useState<ZCodePublicStatus | null>(null);
  const [busy, setBusy] = useState<'load' | 'connect' | null>('load');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setBusy('load');
    setError(null);
    try {
      const response = await fetch('/api/zcode/status', { signal, cache: 'no-store' });
      const body: unknown = await response.json().catch(() => null);
      const next = parseZCodeStatus(body);
      if (!response.ok || !next) throw new Error(t('无法读取 ZCode 本机状态'));
      setStatus(next);
      if (next.models.length > 0) onModelsDiscovered('LLM_ZCODE_MODEL', next.models);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : t('无法读取 ZCode 本机状态'));
    } finally {
      if (!signal?.aborted) setBusy(null);
    }
  }, [onModelsDiscovered, t]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const connect = async (): Promise<void> => {
    setBusy('connect');
    setError(null);
    try {
      const response = await fetch('/api/zcode/connect', { method: 'POST' });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const maybeStatus = parseZCodeStatus((body as ErrorResponse | null)?.status);
        if (maybeStatus) setStatus(maybeStatus);
        throw new Error(safeError(body, t('ZCode 自动接入失败')));
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(t('ZCode 返回了无效响应'));
      const result = body as Partial<ConnectResponse>;
      const nextStatus = parseZCodeStatus(result.status);
      const settings = result.settings;
      if (!nextStatus || !settings || typeof settings !== 'object') throw new Error(t('ZCode 返回了无效响应'));
      setStatus(nextStatus);
      onModelsDiscovered('LLM_ZCODE_MODEL', nextStatus.models);
      onSettingsApplied(settings, APPLIED_FIELDS);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('ZCode 自动接入失败'));
    } finally {
      setBusy(null);
    }
  };

  const tone = zcodeStatusTone(status);
  const toneColor = tone === 'ready' ? theme.success
    : tone === 'warning' ? theme.gold
      : tone === 'error' ? theme.danger : theme.textDim;
  const statusLabel = busy === 'load' ? t('检测中…')
    : status?.authenticated ? t('已验证')
      : status?.running ? t('网关在线')
        : status?.installed ? t('未运行') : t('未检测到');
  const connectDisabled = busy !== null || status?.supported === false;

  return (
    <section style={card} data-testid="zcode-connection-card" aria-live="polite">
      <div style={summaryRow}>
        <span style={{ ...iconBox, color: toneColor }} aria-hidden><Icon name="plug" size={14} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={titleRow}>
            <b style={title}>{t('本机 ZCode 自动接入')}</b>
            <span style={{ ...statusTag, color: toneColor, borderColor: toneColor }}>{statusLabel}</span>
          </div>
          <div style={detail}>
            {status?.message ?? t('正在检测本机 ZCode Antigravity 网关、端口与模型。')}
          </div>
        </div>
      </div>

      <div style={metrics}>
        <Metric label={t('版本')} value={status?.version ?? '—'} />
        <Metric label={t('本地端口')} value={status?.port ? String(status.port) : '—'} />
        <Metric label={t('模型')} value={status ? String(status.models.length) : '—'} />
        <Metric label={t('本地密钥')} value={status?.keyAvailable ? t('可用') : t('未读取')} />
      </div>

      {status?.models && status.models.length > 0 && (
        <div style={modelRow} title={status.models.join('\n')}>
          {status.models.slice(0, 4).map((model) => <code key={model} style={modelChip}>{model}</code>)}
          {status.models.length > 4 && <span style={moreModels}>+{status.models.length - 4}</span>}
        </div>
      )}

      {error && <div role="alert" style={errorText}>{error}</div>}

      <div style={actions}>
        <button type="button" onClick={() => { void connect(); }} disabled={connectDisabled}
          style={{ ...primaryButton, opacity: connectDisabled ? 0.5 : 1, cursor: connectDisabled ? 'default' : 'pointer' }}>
          <Icon name="sparkles" size={12} />
          {busy === 'connect' ? t('正在接入…') : t('连接并设为 Agent 模型')}
        </button>
        <button type="button" onClick={() => { void refresh(); }} disabled={busy !== null}
          style={{ ...secondaryButton, opacity: busy !== null ? 0.5 : 1, cursor: busy !== null ? 'default' : 'pointer' }}>
          {busy === 'load' ? t('检测中…') : t('重新检测')}
        </button>
      </div>
      <div style={securityNote}>
        <Icon name="lock" size={11} />
        {t('随机 API Key 仅由 YoloCut 服务端读取并保存，不会返回浏览器；OAuth 与账号仍由 ZCode 管理。')}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={metric}>
      <span style={metricLabel}>{label}</span>
      <span style={metricValue} title={value}>{value}</span>
    </div>
  );
}

const card: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 13px',
  background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 6,
  boxShadow: `inset 3px 0 0 ${theme.accent}`,
};
const summaryRow: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 9 };
const iconBox: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 27, height: 27,
  flex: '0 0 27px', borderRadius: 5, background: themeAlpha.ink(0.05), border: `1px solid ${theme.border}`,
};
const titleRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 };
const title: CSSProperties = { minWidth: 0, color: theme.text, fontSize: 12, lineHeight: 1.35 };
const statusTag: CSSProperties = {
  flex: '0 0 auto', padding: '1px 6px', border: '1px solid', borderRadius: 8,
  fontSize: 9.5, lineHeight: 1.35,
};
const detail: CSSProperties = { marginTop: 3, color: theme.textDim, fontSize: 10.5, lineHeight: 1.45 };
const metrics: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1,
  overflow: 'hidden', border: `1px solid ${theme.border}`, borderRadius: 5, background: theme.border,
};
const metric: CSSProperties = { minWidth: 0, padding: '7px 8px', background: theme.panelAlt };
const metricLabel: CSSProperties = { display: 'block', color: theme.textDim, fontSize: 9.5, lineHeight: 1.3 };
const metricValue: CSSProperties = {
  display: 'block', marginTop: 2, overflow: 'hidden', color: theme.text, fontSize: 11,
  fontWeight: 600, lineHeight: 1.3, textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const modelRow: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5 };
const modelChip: CSSProperties = {
  maxWidth: 155, overflow: 'hidden', padding: '2px 6px', color: theme.textMuted,
  background: theme.panelAlt, border: `1px solid ${theme.border}`, borderRadius: 4,
  fontSize: 9.5, textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const moreModels: CSSProperties = { color: theme.textDim, fontSize: 9.5 };
const actions: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7 };
const primaryButton: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 29, padding: '5px 10px',
  color: theme.textStrong, background: theme.panelAlt, border: `1px solid ${theme.borderLight}`,
  borderRadius: 8, font: 'inherit', fontSize: 10.5, fontWeight: 600,
};
const secondaryButton: CSSProperties = {
  minHeight: 29, padding: '5px 10px', color: theme.text, background: 'transparent',
  border: `1px solid ${theme.border}`, borderRadius: 5, font: 'inherit', fontSize: 10.5,
};
const securityNote: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 5, color: theme.textDim, fontSize: 9.5, lineHeight: 1.45,
};
const errorText: CSSProperties = {
  padding: '6px 8px', color: theme.danger, background: themeAlpha.ink(0.04),
  border: `1px solid ${theme.border}`, borderRadius: 4, fontSize: 10.5, lineHeight: 1.4,
};
