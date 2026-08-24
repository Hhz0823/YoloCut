import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

import {
  OPEN_SOURCE_AUTO_EDIT_MODEL,
  autoEditHardwarePlan,
  buildAutoEditBatchPrompt,
  type AutoEditAttachmentRole,
  type AutoEditHardwarePlan,
} from '../../../shared/auto-edit-batch';
import type { AutoEditSourceSelection } from '../../../shared/auto-edit-source';
import { VIDEO_FILE_PICKER_ACCEPT, isVideoFileName } from '../../../shared/media-file-extensions';
import { fetchModelPackCatalog, type ModelPackCatalogEntry } from '../../../shared/model-packs';
import { createAutoEditBatch } from '../../persist/autoEditBatchStore';
import { theme } from '../../theme';
import { Icon, type IconName } from '../icons';
import type { ChatPanelController } from './chatPanelController';

const SCRIPT_LIMIT_BYTES = 2 * 1024 * 1024;

interface ScriptInput {
  readonly name: string;
  readonly text: string;
}

function statusText(pack: ModelPackCatalogEntry | null, t: ChatPanelController['t']): string {
  if (!pack) return t('未检测到模型包');
  if (pack.status !== 'installed') return t('模型未安装');
  if (pack.runtimeAvailability?.available === false) return t('llama.cpp 未就绪');
  return t('本地模型已就绪');
}

function roleFiles(event: DragEvent<HTMLElement>): File[] {
  return Array.from(event.dataTransfer.files ?? []);
}

function DropCard({
  icon, title, description, value, onPick, onDrop, disabled,
}: {
  icon: IconName;
  title: string;
  description: string;
  value?: string;
  onPick: () => void;
  onDrop?: (files: File[]) => void;
  disabled?: boolean;
}) {
  return <button
    type="button"
    disabled={disabled}
    onClick={onPick}
    onDragOver={(event) => { if (onDrop) event.preventDefault(); }}
    onDrop={(event) => {
      if (!onDrop) return;
      event.preventDefault();
      onDrop(roleFiles(event));
    }}
    style={{
      minHeight: 74, padding: '10px 11px', display: 'flex', gap: 9, alignItems: 'flex-start',
      textAlign: 'left', border: `1px solid ${theme.borderLight}`, borderRadius: 8,
      background: theme.panelAlt, color: theme.text, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.55 : 1,
    }}
  >
    <span style={{ color: theme.accent, display: 'grid', marginTop: 1 }}><Icon name={icon} size={16} /></span>
    <span style={{ minWidth: 0 }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 650 }}>{title}</span>
      <span style={{ display: 'block', marginTop: 3, fontSize: 10.5, lineHeight: 1.4, color: theme.textDim }}>
        {value || description}
      </span>
    </span>
  </button>;
}

function ModelStatus({ pack, t, onOpenSettings }: {
  pack: ModelPackCatalogEntry | null;
  t: ChatPanelController['t'];
  onOpenSettings?: () => void;
}) {
  const ready = pack?.status === 'installed' && pack.runtimeAvailability?.available !== false;
  return <div style={{
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
    border: `1px solid ${theme.borderLight}`, borderRadius: 8, background: theme.panelAlt,
  }}>
    <Icon name="database" size={15} />
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600 }}>{t('开源参考分析')}</div>
      <div style={{ marginTop: 2, fontSize: 10.5, color: ready ? theme.success : theme.textDim }}>
        {OPEN_SOURCE_AUTO_EDIT_MODEL.packId} · {statusText(pack, t)}
      </div>
    </div>
    {onOpenSettings && !ready && <button type="button" onClick={onOpenSettings} style={smallButton}>
      {t('去设置')}
    </button>}
  </div>;
}

export function AutoEditIntakePanel({ controller }: { controller: ChatPanelController }) {
  const { t, props, composer, actions } = controller;
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<AutoEditSourceSelection | null>(null);
  const [editScript, setEditScript] = useState<ScriptInput | null>(null);
  const [narrationScript, setNarrationScript] = useState<ScriptInput | null>(null);
  const [hardware, setHardware] = useState<AutoEditHardwarePlan>(() => autoEditHardwarePlan(null));
  const [pack, setPack] = useState<ModelPackCatalogEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const editInput = useRef<HTMLInputElement>(null);
  const narrationInput = useRef<HTMLInputElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    void window.yoloCutDesktop?.inference.getCapabilities()
      .then((capabilities) => setHardware(autoEditHardwarePlan(capabilities.hardware)))
      .catch(() => setHardware(autoEditHardwarePlan(null)));
    void fetchModelPackCatalog()
      .then((packs) => setPack(packs.find((candidate) => candidate.id === OPEN_SOURCE_AUTO_EDIT_MODEL.packId) ?? null))
      .catch(() => setPack(null));
  }, [open]);

  const referenceIds = useMemo(() => composer.selectedRefs
    .filter((reference) => (reference as { metadata?: { attachmentRole?: string } }).metadata?.attachmentRole === 'reference-video')
    .map((reference) => reference.id), [composer.selectedRefs]);

  const chooseSources = async () => {
    setError(null);
    const api = window.yoloCutDesktop;
    if (!api) {
      setError(t('批量目录只在 YoloCut 桌面版可用。'));
      return;
    }
    try {
      const selected = await api.selectAutoEditSources();
      if (selected) setSelection(selected);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const readScript = async (file: File | undefined, role: 'edit' | 'narration') => {
    if (!file) return;
    setError(null);
    try {
      if (file.size > SCRIPT_LIMIT_BYTES) throw new Error(t('脚本文件不能超过 2MB。'));
      const value = { name: file.name, text: (await file.text()).trim() };
      if (!value.text) throw new Error(t('脚本文件为空。'));
      if (role === 'edit') setEditScript(value);
      else setNarrationScript(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const importReference = (files: File[]) => {
    const videos = files.filter((file) => file.type.startsWith('video/') || isVideoFileName(file.name));
    if (!videos.length) {
      setError(t('成片参考必须是视频文件。'));
      return;
    }
    void actions.importRoleFiles('reference-video' satisfies AutoEditAttachmentRole, videos.slice(0, 4));
  };

  const create = async () => {
    if (!selection || busy) return;
    setBusy(true);
    setError(null);
    try {
      const batch = await createAutoEditBatch({
        ownerProjectId: props.projectId,
        name: `${selection.directoryName} · ${t('批量自动剪辑')}`,
        sourceGrantId: selection.grantId,
        sources: selection.sources,
        editScript: editScript?.text,
        narrationScript: narrationScript?.text,
        referenceAssetIds: referenceIds,
        plannerModelId: OPEN_SOURCE_AUTO_EDIT_MODEL.packId,
        workerConcurrency: hardware.workerConcurrency,
        renderConcurrency: hardware.renderConcurrency,
      });
      composer.setMode('agent');
      composer.setInput(buildAutoEditBatchPrompt(batch));
      setCreatedId(batch.id);
      requestAnimationFrame(() => composer.taRef.current?.focus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const scriptDrop = (role: 'edit' | 'narration') => (files: File[]) => void readScript(files[0], role);

  return <div style={{ marginBottom: 8 }}>
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px',
        border: `1px solid ${theme.borderLight}`, borderRadius: 8, background: open ? theme.panelAlt : 'transparent',
        color: theme.text, cursor: 'pointer', textAlign: 'left',
      }}>
      <Icon name="sparkles" size={15} />
      <span style={{ fontSize: 12, fontWeight: 650 }}>{t('批量自动剪辑')}</span>
      <span style={{ marginLeft: 'auto', fontSize: 10.5, color: theme.textDim }}>{t('最高 10,000 条')}</span>
      <span style={{ display: 'grid', transform: open ? 'rotate(180deg)' : undefined }}>
        <Icon name="chevronDown" size={13} />
      </span>
    </button>
    {open && <div style={{
      marginTop: 6, padding: 10, border: `1px solid ${theme.borderLight}`,
      borderRadius: 8, background: theme.panel, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: 10.5, lineHeight: 1.45, color: theme.textDim }}>
        {t('投递素材目录、剪辑脚本、口播脚本和成片参考。每条素材建立独立工程，队列可暂停、恢复和失败重试。')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 7 }}>
        <DropCard icon="folder" title={t('素材目录')} description={t('选择目录并扫描，最多 10,000 条')}
          value={selection ? t('{name} · {count} 条', { name: selection.directoryName, count: selection.sources.length }) : undefined}
          onPick={() => void chooseSources()} disabled={!window.yoloCutDesktop} />
        <DropCard icon="clipboard" title={t('剪辑脚本')} description={t('点击或拖入 txt / md / srt')}
          value={editScript?.name} onPick={() => editInput.current?.click()} onDrop={scriptDrop('edit')} />
        <DropCard icon="mic" title={t('口播脚本')} description={t('独立于剪辑说明，供 TTS 与字幕使用')}
          value={narrationScript?.name} onPick={() => narrationInput.current?.click()} onDrop={scriptDrop('narration')} />
        <DropCard icon="film" title={t('成片参考')} description={t('只模仿结构、节奏、字幕与调色')}
          value={referenceIds.length ? t('已加入 {count} 个参考', { count: referenceIds.length }) : undefined}
          onPick={() => referenceInput.current?.click()} onDrop={importReference} />
      </div>
      <input ref={editInput} hidden type="file" accept=".txt,.md,.markdown,.srt,.csv" onChange={(event) => void readScript(event.target.files?.[0], 'edit')} />
      <input ref={narrationInput} hidden type="file" accept=".txt,.md,.markdown,.srt,.csv" onChange={(event) => void readScript(event.target.files?.[0], 'narration')} />
      <input ref={referenceInput} hidden type="file" accept={VIDEO_FILE_PICKER_ACCEPT} multiple onChange={(event) => importReference(Array.from(event.target.files ?? []))} />
      <ModelStatus pack={pack} t={t} onOpenSettings={props.onOpenSettings} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10.5, color: theme.textDim }}>
        <span>{hardware.note}</span>
      </div>
      {error && <div role="alert" style={{ fontSize: 10.5, color: theme.danger }}>{error}</div>}
      {createdId && <div role="status" style={{ fontSize: 10.5, color: theme.success }}>
        {t('批次已建立：{id}。提示词已放入输入框，请检查后发送。', { id: createdId })}
      </div>}
      <button type="button" disabled={!selection || busy} onClick={() => void create()} style={{
        ...primaryButton,
        opacity: !selection || busy ? 0.5 : 1,
        cursor: !selection || busy ? 'not-allowed' : 'pointer',
      }}>
        <Icon name="arrowUp" size={13} /> {busy ? t('正在建立批次…') : t('建立批次并交给 Agent')}
      </button>
    </div>}
  </div>;
}

const smallButton: React.CSSProperties = {
  border: `1px solid ${theme.borderLight}`, borderRadius: 6, background: 'transparent',
  color: theme.text, padding: '3px 8px', fontSize: 10.5, cursor: 'pointer',
};

const primaryButton: React.CSSProperties = {
  minHeight: 32, border: `1px solid ${theme.accent}`, borderRadius: 8,
  background: 'transparent', color: theme.accent, display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11.5, fontWeight: 650,
};
