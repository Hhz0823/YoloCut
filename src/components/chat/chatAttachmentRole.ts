import type { AutoEditAttachmentRole } from '../../../shared/auto-edit-batch';
import type { AgentReference } from '../../agent/context';
import type { MediaAsset } from '../../editor/types';

export function attachmentRoleDocumentLabel(role?: AutoEditAttachmentRole): string {
  return role === 'edit-script'
    ? '剪辑脚本'
    : role === 'narration-script'
      ? '口播脚本'
      : '文档';
}

export function attachmentRoleAssetReference(
  asset: MediaAsset,
  role?: AutoEditAttachmentRole,
): AgentReference {
  return {
    id: asset.id, name: asset.name, kind: asset.kind,
    ...(role ? { metadata: { attachmentRole: role } } : {}),
  };
}
