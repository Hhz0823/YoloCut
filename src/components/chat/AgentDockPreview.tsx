import type { AgentWorkbenchPlacement } from '../../../shared/agent-workbench';
import { useT } from '../../i18n/locale';

export function AgentDockPreview({ target }: { target: AgentWorkbenchPlacement }) {
  const t = useT();
  return (
    <div className="cc-agent-dock-overlay" data-target={target} aria-hidden="true">
      <div className="cc-agent-dock-zone cc-agent-dock-zone--left">
        <span>{t('停靠左侧')}</span>
      </div>
      <div className="cc-agent-dock-zone cc-agent-dock-zone--detached">
        <span>{t('独立窗口')}</span>
      </div>
      <div className="cc-agent-dock-zone cc-agent-dock-zone--right">
        <span>{t('停靠右侧')}</span>
      </div>
    </div>
  );
}
