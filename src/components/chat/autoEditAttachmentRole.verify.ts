import assert from 'node:assert/strict';

import type { MediaAsset } from '../../editor/types.ts';
import { attachmentRoleAssetReference, attachmentRoleDocumentLabel } from './chatAttachmentRole.ts';

const asset: MediaAsset = {
  id: 'reference-video', name: 'reference.mp4', kind: 'video',
  src: '/media/uploads/reference.mp4', durationInFrames: 30,
};
const reference = attachmentRoleAssetReference(asset, 'reference-video');
assert.equal((reference as { metadata?: { attachmentRole?: string } }).metadata?.attachmentRole, 'reference-video');
assert.equal(attachmentRoleDocumentLabel('narration-script'), '口播脚本');
assert.equal(attachmentRoleDocumentLabel('edit-script'), '剪辑脚本');
assert.equal(attachmentRoleDocumentLabel(), '文档');

console.log('autoEditAttachmentRole.verify: reference and narration roles survive composer import');
