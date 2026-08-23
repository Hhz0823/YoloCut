import { theme } from '../theme';
import { UpstreamUpdateNotice } from '../ui/UpstreamUpdateNotice';
import { DesktopWindowControls } from './DesktopWindowControls';
import {
  DashboardContent,
  DashboardDialogs,
  DashboardTitlebarContent,
} from './dashboard/DashboardViews';
import { useDashboardModel, type DashboardProps } from './dashboard/useDashboardModel';
import { LiquidGlassBackdrop } from '../ui/LiquidGlassBackdrop';

export function Dashboard(props: DashboardProps) {
  const model = useDashboardModel(props);
  const isMacDesktop = window.yoloCutDesktop?.platform === 'darwin';
  return (
    <div className="cc-dashboard-shell" style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: theme.bg, color: theme.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' }}>
      <UpstreamUpdateNotice />
      <header className={`cc-dashboard-titlebar cc-liquid-glass-host cc-window-titlebar${isMacDesktop ? ' cc-window-titlebar--mac' : ''}`} style={{ position: 'relative', height: 48, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '0 24px', borderBottom: `1px solid ${theme.border}`, background: theme.panel }}>
        <LiquidGlassBackdrop />
        <DesktopWindowControls />
        <DashboardTitlebarContent model={model} />
      </header>
      <DashboardContent props={props} model={model} />
      <DashboardDialogs model={model} />
    </div>
  );
}
