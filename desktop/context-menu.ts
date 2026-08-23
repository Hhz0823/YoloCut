import type { DesktopLocale } from '../shared/desktop-locale.ts';
import { nativeMenuLabels } from './application-menu.ts';

export interface TextContextMenuParams {
  isEditable: boolean;
  selectionText: string;
  editFlags: Partial<Record<
    'canUndo' | 'canRedo' | 'canCut' | 'canCopy' | 'canPaste' | 'canSelectAll',
    boolean
  >>;
}

export type TextContextMenuItem =
  | {
      role: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';
      label: string;
      enabled: boolean;
    }
  | { type: 'separator' };

/** Build native editing commands without coupling behavior tests to Electron. */
export function buildTextContextMenuTemplate(
  params: TextContextMenuParams,
  locale: DesktopLocale = 'zh',
): TextContextMenuItem[] {
  const label = nativeMenuLabels(locale);
  if (!params.isEditable) {
    if (!params.selectionText) return [];
    return [{ role: 'copy', label: label.copy, enabled: params.editFlags.canCopy !== false }];
  }

  return [
    { role: 'undo', label: label.undo, enabled: !!params.editFlags.canUndo },
    { role: 'redo', label: label.redo, enabled: !!params.editFlags.canRedo },
    { type: 'separator' },
    { role: 'cut', label: label.cut, enabled: !!params.editFlags.canCut },
    { role: 'copy', label: label.copy, enabled: !!params.editFlags.canCopy },
    { role: 'paste', label: label.paste, enabled: !!params.editFlags.canPaste },
    { type: 'separator' },
    { role: 'selectAll', label: label.selectAll, enabled: !!params.editFlags.canSelectAll },
  ];
}
