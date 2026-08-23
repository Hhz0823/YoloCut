// Trusted editor connection center for the authenticated Streamable HTTP MCP endpoint.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { editorBootstrapInfo } from '../../agent/editor-credential';
import {
  fetchMcpConnectionManifest,
  mcpConnectionSnippets,
  mcpEndpoint,
  mcpStarterPrompt,
  probeMcpConnection,
  type McpConnectionManifestView,
  type McpConnectionSnippet,
  type McpProbeResult,
  type McpToolExposureMode,
} from '../../agent/mcp-connection';
import { theme } from '../../theme';
import { useT } from '../../i18n/locale';
import { Icon } from '../icons';

function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      style={{
        flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '4px 9px', border: `1px solid ${theme.border}`, borderRadius: 5,
        background: theme.hover, color: copied ? theme.accent : theme.textMuted,
        fontSize: 11, cursor: 'pointer',
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={11} />
      {copied ? t('已复制') : (label ?? t('复制到剪贴板'))}
    </button>
  );
}

function Metric({ label, value, tone = 'normal' }: {
  label: string;
  value: string;
  tone?: 'normal' | 'good' | 'warn';
}) {
  const color = tone === 'good' ? theme.success : tone === 'warn' ? theme.gold : theme.text;
  return (
    <div style={{
      minWidth: 0, padding: '8px 10px', borderRadius: 6,
      border: `1px solid ${theme.borderLight}`, background: theme.inset,
    }}>
      <div style={{ color: theme.textDim, fontSize: 10.5, marginBottom: 3 }}>{label}</div>
      <div style={{ color, fontSize: 13, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
    </div>
  );
}

function readinessCopy(manifest: McpConnectionManifestView | null): {
  title: string;
  detail: string;
  tone: 'good' | 'warn';
} {
  if (manifest?.readiness.fullEditing === 'ready') {
    return {
      title: '完整功能已就绪',
      detail: '已有工程编辑器在线，内置 Agent 的核心工具目录已完整映射给外部 MCP。',
      tone: 'good',
    };
  }
  if (manifest?.readiness.fullEditing === 'catalog_mismatch') {
    return {
      title: '编辑器在线，但工具目录不完整',
      detail: '请刷新或更新 YoloCut；连接中心会列出缺失工具，不能把当前状态视为完整接入。',
      tone: 'warn',
    };
  }
  return {
    title: 'MCP 服务可连接，完整剪辑需打开工程',
    detail: '未打开工程时只提供安全的 server-direct 数据工具；生成、画面检查、上传、渲染、导出与人工审核需要在线编辑器。',
    tone: 'warn',
  };
}

export function McpGuideDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [exposure, setExposure] = useState<McpToolExposureMode>('full');
  const [activeSnippet, setActiveSnippet] = useState<McpConnectionSnippet['id']>('codex-powershell');
  const [mcpToken, setMcpToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState(false);
  const [manifest, setManifest] = useState<McpConnectionManifestView | null>(null);
  const [diagnosticError, setDiagnosticError] = useState('');
  const [probe, setProbe] = useState<McpProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const endpoint = mcpEndpoint(window.location.origin, exposure);
  const snippetList = useMemo(
    () => mcpToken ? mcpConnectionSnippets(endpoint, mcpToken) : [],
    [endpoint, mcpToken],
  );
  const selectedSnippet = snippetList.find((snippet) => snippet.id === activeSnippet) ?? snippetList[0];
  const readiness = readinessCopy(manifest);

  async function refreshManifest(signal?: AbortSignal): Promise<McpConnectionManifestView> {
    const next = await fetchMcpConnectionManifest(signal);
    setManifest(next);
    setDiagnosticError('');
    return next;
  }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void editorBootstrapInfo().then(
      (info) => { if (active) setMcpToken(info.mcpToken); },
      () => { if (active) setTokenError(true); },
    );
    void refreshManifest(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setDiagnosticError(error instanceof Error ? error.message : String(error));
      }
    });
    return () => { active = false; controller.abort(); };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  async function runProbe(): Promise<void> {
    if (!mcpToken || probing) return;
    setProbing(true);
    setProbe(null);
    setDiagnosticError('');
    try {
      const [, nextProbe] = await Promise.all([
        refreshManifest(),
        probeMcpConnection(endpoint, mcpToken),
      ]);
      if (!nextProbe.hasConnectionManifest) {
        throw new Error(t('MCP 工具目录缺少 get_connection_manifest'));
      }
      setProbe(nextProbe);
    } catch (error) {
      setDiagnosticError(error instanceof Error ? error.message : String(error));
    } finally {
      setProbing(false);
    }
  }

  const codeStyle: CSSProperties = {
    margin: 0, padding: '9px 11px', border: `1px solid ${theme.borderLight}`, borderRadius: 6,
    background: theme.inset, color: theme.text, fontSize: 11.5, lineHeight: 1.55,
    fontFamily: 'SFMono-Regular, ui-monospace, SFMono-Regular, Menlo, monospace',
    whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'text',
  };
  const sectionStyle: CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 7, padding: '11px 12px',
    border: `1px solid ${theme.borderLight}`, borderRadius: 8, background: theme.panel,
  };

  const dialog = (
    <div className="cc-modal-backdrop" data-cc-mcp-guide-backdrop onPointerDown={onClose}>
      <div
        className="cc-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cc-mcp-guide-title"
        data-cc-mcp-guide-dialog
        style={{ width: 'min(760px, calc(100vw - 32px))', gap: 10, maxHeight: 'calc(100vh - 48px)', overflowY: 'auto' }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8 }}>
          <Icon name="plug" size={15} />
          <strong id="cc-mcp-guide-title" style={{ fontSize: 14 }}>{t('Agent 连接中心 (MCP)')}</strong>
          <span style={{ color: theme.textDim, fontSize: 11 }}>Streamable HTTP · Bearer</span>
          <button type="button" autoFocus onClick={onClose} style={{ marginLeft: 'auto', padding: '3px 9px' }}>{t('关闭')}</button>
        </div>
        <div style={{ color: theme.textMuted, fontSize: 12, lineHeight: 1.55 }}>
          {t('Codex、Claude Code、Gemini CLI、Cursor 与其他 MCP Agent 可连接同一套 EditorCore 工具。完整能力以在线编辑器和工具覆盖自检为准。')}
        </div>

        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
            <span style={{
              width: 8, height: 8, marginTop: 5, borderRadius: 4, flex: '0 0 auto',
              background: readiness.tone === 'good' ? theme.success : theme.gold,
            }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: readiness.tone === 'good' ? theme.success : theme.gold, fontSize: 13, fontWeight: 700 }}>
                {t(readiness.title)}
              </div>
              <div style={{ color: theme.textMuted, fontSize: 11.5, lineHeight: 1.5, marginTop: 2 }}>{t(readiness.detail)}</div>
            </div>
            <button
              type="button"
              disabled={!mcpToken || probing}
              onClick={() => { void runProbe(); }}
              style={{ marginLeft: 'auto', flex: '0 0 auto', padding: '6px 11px' }}
            >
              {probing ? t('正在执行真实 MCP 握手…') : t('运行连接自检')}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 7 }}>
            <Metric label={t('核心工具覆盖')} value={manifest
              ? `${manifest.capabilityCoverage.availableCanonicalToolCount}/${manifest.capabilityCoverage.canonicalToolCount}`
              : '—'} tone={manifest?.capabilityCoverage.complete ? 'good' : 'warn'} />
            <Metric label={t('在线编辑器')} value={manifest ? String(manifest.editors.liveCount) : '—'} tone={manifest?.editors.liveCount ? 'good' : 'warn'} />
            <Metric label={t('当前能力层级')} value={manifest?.session.availableToolTier ?? '—'} />
            <Metric label={t('MCP 工具目录')} value={probe ? String(probe.toolCount) : (manifest ? String(manifest.session.fullToolCount) : '—')} tone={probe ? 'good' : 'normal'} />
          </div>
          {probe && <div style={{ color: theme.accent, fontSize: 11.5 }}>
            {t('真实握手通过：{server} · 协议 {protocol} · {count} 个当前可见工具', {
              server: probe.serverName, protocol: probe.protocolVersion, count: probe.toolCount,
            })}
          </div>}
          {diagnosticError && <div role="alert" style={{ color: theme.danger, fontSize: 11.5, lineHeight: 1.45 }}>
            {t('连接自检失败：{message}', { message: diagnosticError })}
          </div>}
          {!!manifest?.capabilityCoverage.missingCanonicalTools.length && <details style={{ color: theme.gold, fontSize: 11 }}>
            <summary style={{ cursor: 'pointer' }}>{t('查看缺失工具 ({n})', { n: manifest.capabilityCoverage.missingCanonicalTools.length })}</summary>
            <div style={{ marginTop: 5, fontFamily: 'SFMono-Regular, ui-monospace, monospace', wordBreak: 'break-all' }}>
              {manifest.capabilityCoverage.missingCanonicalTools.join(', ')}
            </div>
          </details>}
        </section>

        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 650 }}>{t('工具暴露模式')}</span>
            {(['full', 'progressive'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => { setExposure(mode); setProbe(null); }}
                style={{
                  padding: '4px 9px', fontSize: 11,
                  borderColor: exposure === mode ? theme.accent : theme.border,
                  color: exposure === mode ? theme.accent : theme.textMuted,
                }}
              >
                {mode === 'full' ? t('完整（推荐）') : t('渐进')}
              </button>
            ))}
            <span style={{ color: theme.textDim, fontSize: 10.5 }}>
              {exposure === 'full'
                ? t('兼容会缓存固定工具列表的 Agent。')
                : t('仅用于支持 tools/list_changed 的 Agent。')}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600 }}>{t('端点地址')}</span>
            <CopyButton text={endpoint} />
          </div>
          <pre style={codeStyle}>{endpoint}</pre>
        </section>

        <section style={sectionStyle}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {snippetList.map((snippet) => (
              <button
                key={snippet.id}
                type="button"
                onClick={() => setActiveSnippet(snippet.id)}
                style={{
                  padding: '4px 8px', fontSize: 10.5,
                  borderColor: activeSnippet === snippet.id ? theme.accent : theme.border,
                  color: activeSnippet === snippet.id ? theme.accent : theme.textMuted,
                }}
              >{snippet.label}</button>
            ))}
          </div>
          {selectedSnippet ? <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 650 }}>{selectedSnippet.label}</span>
              <CopyButton text={selectedSnippet.code} />
            </div>
            <pre style={codeStyle}>{selectedSnippet.code}</pre>
          </> : <div style={{ color: tokenError ? theme.danger : theme.textMuted, fontSize: 12 }}>
            {tokenError ? t('无法读取 MCP 连接令牌，请从受信任的编辑器窗口重试。') : t('正在读取 MCP 连接令牌…')}
          </div>}
          <div style={{ color: theme.gold, fontSize: 11, lineHeight: 1.45 }}>
            {t('配置片段包含本机访问令牌。只粘贴到你信任的 Agent 客户端，不要提交到 Git、聊天记录或公开配置。')}
          </div>
        </section>

        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 650 }}>{t('完整剪辑调用顺序')}</span>
            <CopyButton text={mcpStarterPrompt()} label={t('复制 Agent 启动提示')} />
          </div>
          <ol style={{ margin: 0, paddingLeft: 20, color: theme.textMuted, fontSize: 11.5, lineHeight: 1.7 }}>
            <li><code>yolocut_status</code> → <code>get_connection_manifest</code> <span style={{ color: theme.textDim }}>（{t('旧版 Agent 配置仍可连接')}）</span></li>
            <li><code>list_projects</code> → <code>target_project</code></li>
            <li><code>load_skill</code> / <code>ToolSearch</code></li>
            <li><code>begin_edit_session</code> → {t('携带 editSessionId 读取并剪辑')}</li>
            <li><code>review_edit_session</code> → <code>get_edit_session</code> → <strong>status=applied</strong></li>
          </ol>
          <div style={{ color: theme.textDim, fontSize: 11, lineHeight: 1.5 }}>
            {t('离线 server-direct 仅用于安全的数据型剪辑并要求 auto；画面检查、AI 生成、素材上传、联网、预设、渲染、导出和人工审核都必须保持目标工程编辑器在线。')}
          </div>
        </section>

        <div style={{ color: theme.textDim, fontSize: 11, lineHeight: 1.5, borderTop: `1px solid ${theme.borderLight}`, paddingTop: 8 }}>
          {t('MCP 端点始终要求 Bearer 令牌。令牌在首次启动时生成并保存在本机，重启后保持不变，配置一次即可持续使用；YOLOCUT_MCP_TOKEN 环境变量可覆盖。令牌只在当前受信任编辑器会话中显示，不写入工程、聊天或浏览器存储。')}
        </div>
      </div>
    </div>
  );
  // The editor top bar uses backdrop-filter for vibrancy. In Chromium that
  // establishes a containing block for fixed descendants, which previously
  // positioned this viewport modal relative to the 48 px title bar and pushed
  // most of it above the window. Keep viewport dialogs at document.body.
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
