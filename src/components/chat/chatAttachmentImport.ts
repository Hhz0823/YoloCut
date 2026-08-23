import { refPromptToken } from '../../agent/selection-refs';
import type { MediaAsset } from '../../editor/types';
import { kindOf } from '../../media/upload';
import {
  parseDocxText,
  parsePdfText,
} from './chatDocumentParse';
import { assertChatDocumentSize, validatedChatDocumentText } from './chatDocumentLimits';
import {
  attachChatAttachmentPlaceholder,
  beginChatAttachmentImport,
  failChatAttachmentImport,
  replaceChatAttachmentPromptToken,
  resolveChatAttachmentImport,
  type ChatAttachmentImportToken,
  type ChatAttachmentLifecycleState,
} from './chatAttachmentLifecycle';
import type { RefItem } from './ChatComposer';
import type { AutoEditAttachmentRole } from '../../../shared/auto-edit-batch';
import { attachmentRoleAssetReference, attachmentRoleDocumentLabel } from './chatAttachmentRole';

type Translate = (key: string) => string;
type UpdateInput = (update: (value: string) => string) => void;

export type ChatMediaImporter = (
  file: File,
  onProgress?: (ratio: number) => void,
  lifecycle?: {
    onPlaceholder?: (asset: MediaAsset) => void;
    onAssetUpdated?: (asset: MediaAsset) => void;
    onFailure?: (asset: MediaAsset | null, error: unknown) => void;
  },
) => Promise<MediaAsset>;

interface AttachmentImportBinding {
  readonly t: Translate;
  readonly onImportMedia: ChatMediaImporter;
  readonly lifecycle: () => ChatAttachmentLifecycleState;
  readonly references: () => RefItem[];
  readonly commitLifecycle: (state: ChatAttachmentLifecycleState) => void;
  readonly commitReferences: (references: RefItem[]) => void;
  readonly updateInput: UpdateInput;
  readonly setError: (message: string | null) => void;
}

const DOCUMENT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.srt', '.csv']);

/** Text document attachments (issue #84): read straight into the composer as
 * editable text; no media-pool asset is created. */
export function chatDocumentKind(file: File): 'text' | 'docx' | 'pdf' | null {
  const lower = file.name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : '';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'text';
  if (ext === '.docx') return 'docx';
  if (ext === '.pdf') return 'pdf';
  return null;
}

async function importDocument(
  binding: AttachmentImportBinding,
  file: File,
  role?: AutoEditAttachmentRole,
): Promise<void> {
  const kind = chatDocumentKind(file);
  let text: string;
  try {
    assertChatDocumentSize(file.size);
    if (kind === 'docx') text = await parseDocxText(await file.arrayBuffer());
    else if (kind === 'pdf') text = await parsePdfText(await file.arrayBuffer());
    else text = validatedChatDocumentText(await file.text());
  } catch (error) {
    binding.setError(error instanceof Error ? binding.t(error.message) : binding.t('文档解析失败'));
    return;
  }
  const roleLabel = attachmentRoleDocumentLabel(role);
  const block = `[${roleLabel}: ${file.name}]\n${text.trim()}\n`;
  binding.updateInput((value) => (value.trim() ? `${value}\n${block}` : block));
}



function acceptPlaceholder(binding: AttachmentImportBinding, token: ChatAttachmentImportToken, asset: MediaAsset, role?: AutoEditAttachmentRole): void {
  const reference = attachmentRoleAssetReference(asset, role);
  const transition = attachChatAttachmentPlaceholder(
    binding.lifecycle(), binding.references(), token, reference,
  );
  binding.commitLifecycle(transition.state);
  if (!transition.accepted) return;
  binding.commitReferences(transition.references);
  const promptToken = refPromptToken(reference);
  binding.updateInput((value) => value.includes(promptToken)
    ? value
    : `${value}${value && !value.endsWith(' ') ? ' ' : ''}${promptToken} `);
}

function acceptReady(binding: AttachmentImportBinding, token: ChatAttachmentImportToken, asset: MediaAsset, role?: AutoEditAttachmentRole): void {
  const reference = attachmentRoleAssetReference(asset, role);
  const transition = resolveChatAttachmentImport(
    binding.lifecycle(), binding.references(), token, reference,
  );
  binding.commitLifecycle(transition.state);
  if (!transition.accepted) return;
  binding.commitReferences(transition.references);
  const previous = transition.previousReference;
  if (previous) {
    binding.updateInput((value) => replaceChatAttachmentPromptToken(value, previous, reference));
  }
}

function acceptFailure(binding: AttachmentImportBinding, token: ChatAttachmentImportToken, reason: unknown): void {
  const transition = failChatAttachmentImport(binding.lifecycle(), binding.references(), token);
  binding.commitLifecycle(transition.state);
  if (!transition.accepted) return;
  binding.commitReferences(transition.references);
  if (transition.previousReference) {
    const escaped = refPromptToken(transition.previousReference)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    binding.updateInput((value) => value.replace(new RegExp(`${escaped}\\s?`, 'g'), '').trimStart());
  }
  binding.setError(reason instanceof Error ? reason.message : binding.t('导入失败'));
}

async function importOne(binding: AttachmentImportBinding, file: File, role?: AutoEditAttachmentRole): Promise<void> {
  const started = beginChatAttachmentImport(binding.lifecycle());
  binding.commitLifecycle(started.state);
  try {
    const ready = await binding.onImportMedia(file, undefined, {
      onPlaceholder: (asset) => acceptPlaceholder(binding, started.token, asset, role),
      onAssetUpdated: (asset) => acceptReady(binding, started.token, asset, role),
      onFailure: (_asset, reason) => acceptFailure(binding, started.token, reason),
    });
    acceptReady(binding, started.token, ready, role);
  } catch (reason) {
    acceptFailure(binding, started.token, reason);
  }
}

/** Build the paste/drop importer while keeping lifecycle transitions outside ChatPanel. */
export interface ChatAttachmentImportOptions {
  readonly role?: AutoEditAttachmentRole;
}

export function createChatAttachmentImporter(binding: AttachmentImportBinding): (
  files: File[],
  options?: ChatAttachmentImportOptions,
) => Promise<void> {
  return async (files, options = {}) => {
    const documents = files.filter((file) => chatDocumentKind(file) !== null);
    const media = files.filter((file) => chatDocumentKind(file) === null && kindOf(file) !== null);
    const unsupported = files.length - documents.length - media.length;
    binding.setError(unsupported > 0
      ? binding.t('已忽略不支持的文件（仅支持 视频 / 图片 / 音频 / GIF / SVG / md / txt / srt / csv / docx / pdf）')
      : null);
    for (const file of documents) await importDocument(binding, file, options.role);
    await Promise.all(media.map((file) => importOne(binding, file, options.role)));
  };
}
