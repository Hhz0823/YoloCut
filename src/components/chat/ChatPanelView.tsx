import { useState, type PointerEvent as ReactPointerEvent } from 'react';

import { createPortal } from 'react-dom';
import { theme } from '../../theme';
import { BrandMark, YoloCutWordmark, Icon } from '../icons';
import { AgentChangeLogMenu } from './AgentChangeLogMenu';
import { AgentRunInspector } from './AgentRunInspector';
import { ChatComposer } from './ChatComposer';
import { AutoEditIntakePanel } from './AutoEditIntakePanel';
import { ChatMessage } from './ChatMessage';
import { ChatRunStatus } from './ChatRunStatus.tsx';
import { ExternalProposalCard } from './ExternalProposalCard';
import { ProposalCard } from './ProposalCard';
import { ToolGroupRow } from './ToolGroupRow';
import { groupMessages } from './message-groups';
import { EMPTY_PROJECT_STARTERS, QUICK_ACTIONS } from './chatPanelPresets';
import type { DisplayMessage } from '../../agent/agent-session';
import { readStoredServerRun } from '../../agent/serverRunSessionStorage';
import type { ChatPanelController } from './chatPanelController';
import { CAPABILITY_LABELS, missingCreativeCaps } from './capabilityBanner';
import { LiquidGlassBackdrop } from '../../ui/LiquidGlassBackdrop';
import { DesktopWindowControls } from '../DesktopWindowControls';
import { AgentDockPreview } from './AgentDockPreview';
import {
  agentWorkbenchPointerTarget,
  type AgentDockSide,
  type AgentWorkbenchPlacement,
} from '../../../shared/agent-workbench';

const MESSAGE_WINDOW_SIZE = 40;

function ChangeLogPortal({ controller }: { controller: ChatPanelController }) {
  const { changeLogSlot, agent } = controller;
  if (!changeLogSlot) return null;
  return createPortal(
    <AgentChangeLogMenu
      changeLog={agent.changeLog}
      running={agent.running}
      canRollback={agent.canRollbackChangeSession}
      onRollback={agent.rollbackChangeSession}
    />,
    changeLogSlot,
  );
}

function CollapsedPanel({ controller }: { controller: ChatPanelController }) {
  const { props, t } = controller;
  const dockSide = props.dockSide ?? 'right';
  return <>
    <ChangeLogPortal controller={controller} />
    <aside className="cc-chat-panel collapsed" data-cc-shortcut-surface="agent-chat" tabIndex={-1}
      data-cc-agent-dock={dockSide}
      style={{
        gridColumn: dockSide === 'left' ? 1 : 5,
        gridRow: '2 / 5',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderLeft: dockSide === 'right' ? `1px solid ${theme.border}` : undefined,
        borderRight: dockSide === 'left' ? `1px solid ${theme.border}` : undefined,
        background: theme.panel,
      }}>
      <button type="button" onClick={props.onToggleCollapse} title={t('展开 YoloCut Agent')}
        style={{ background: 'none', border: 'none', color: theme.textDim, cursor: 'pointer', fontSize: 14 }}>
        <span style={{ transform: 'rotate(90deg)', display: 'inline-flex' }}><Icon name="chevronDown" size={14} /></span>
      </button>
      <div className="cc-chat-collapsed-brand">YoloCut</div>
    </aside>
  </>;
}

export function CapabilityBanner({ controller }: { controller: ChatPanelController }) {
  const { props, t } = controller;
  const [dismissed, setDismissed] = useState(false);
  const missing = missingCreativeCaps();
  if (dismissed || !props.onOpenSettings || missing.length === 0) return null;
  const names = missing.map((key) => t(CAPABILITY_LABELS[key] ?? key)).join('、');
  return <div className="cc-chat-capability-banner">
    <span>{t('以下能力未配置，相关功能暂不可用：')}{names}</span>
    <button type="button" onClick={props.onOpenSettings}>{t('去设置配置')}</button>
    <button type="button" className="cc-chat-capability-banner-close" aria-label={t('关闭')}
      onClick={() => setDismissed(true)}>×</button>
  </div>;
}


function AgentDockControls({ controller }: { controller: ChatPanelController }) {
  const { props, t } = controller;
  const side = props.dockSide ?? 'right';
  const action = (next: AgentDockSide) => { void props.onDock?.(next); };
  return <div className="cc-agent-dock-controls" data-cc-agent-no-drag>
    <button type="button" className="cc-header-btn cc-agent-header-action" title={t('停靠左侧')} aria-label={t('停靠左侧')}
      data-active={props.hostMode !== 'detached' && side === 'left'} onClick={() => action('left')}>
      <span className="cc-agent-dock-glyph cc-agent-dock-glyph--left" />
    </button>
    <button type="button" className="cc-header-btn cc-agent-header-action" title={t('拖出为独立窗口')} aria-label={t('拖出为独立窗口')}
      disabled={!props.canDetach || props.hostMode === 'detached'} onClick={() => { void props.onDetach?.(); }}>
      <span className="cc-agent-detach-glyph">↗</span>
    </button>
    <button type="button" className="cc-header-btn cc-agent-header-action" title={t('停靠右侧')} aria-label={t('停靠右侧')}
      data-active={props.hostMode !== 'detached' && side === 'right'} onClick={() => action('right')}>
      <span className="cc-agent-dock-glyph cc-agent-dock-glyph--right" />
    </button>
  </div>;
}

function useAgentHeaderDrag(controller: ChatPanelController) {
  const { props } = controller;
  const [target, setTarget] = useState<AgentWorkbenchPlacement | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (props.hostMode === 'detached' || !props.onDock || !props.onDetach) return;
    if (!(event.target instanceof Element)) return;
    const handle = event.target.closest('[data-cc-agent-drag-handle]');
    if (!handle && event.target.closest('button, input, select, textarea, [data-cc-agent-no-drag]')) return;
    // Cancelling the initial mouse pointerdown makes Electron's Windows input
    // bridge terminate the injected/native mouse stream before mouseMove.
    // The handle is a button with no click action, so the desktop mouse path
    // can keep its default focus behavior while touch/pen still suppress it.
    const contactPointer = event.pointerType === 'touch' || event.pointerType === 'pen';
    if (contactPointer) event.preventDefault();
    const surface = event.currentTarget;
    const pointerId = event.pointerId;
    // Electron's Windows mouse bridge can stop delivering native mouseMove
    // events when capture is taken during pointerdown. Window-level capture
    // listeners already retain mouse drags and the blur fallback completes a
    // tear-off outside the BrowserWindow. Keep pointer capture for touch/pen,
    // where it is needed to preserve the contact stream.
    if (contactPointer) {
      try {
        surface.setPointerCapture(pointerId);
      } catch {
        // Synthetic tests and older embedded Chromium can reject capture; window listeners remain the fallback.
      }
    }
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let ended = false;
    let lastPoint = {
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
    };
    let lastTarget: AgentWorkbenchPlacement = props.dockSide ?? 'right';

    function remember(next: Pick<MouseEvent, 'clientX' | 'clientY' | 'screenX' | 'screenY'>): void {
      lastPoint = {
        clientX: next.clientX,
        clientY: next.clientY,
        screenX: next.screenX,
        screenY: next.screenY,
      };
      lastTarget = agentWorkbenchPointerTarget(
        next.clientX,
        next.clientY,
        window.innerWidth,
        window.innerHeight,
      );
    }

    function cleanup(): void {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finishPointer, true);
      window.removeEventListener('pointercancel', cancelPointer, true);
      window.removeEventListener('mouseup', finishMouse, true);
      window.removeEventListener('blur', finishOnBlur);
      document.documentElement.classList.remove('cc-agent-workbench-dragging');
      try {
        if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
      } catch {
        // The OS can release capture first when the pointer leaves the native window.
      }
    }

    function complete(forceDetached = false): void {
      if (ended) return;
      ended = true;
      cleanup();
      setTarget(null);
      if (!active) return;
      const drop = forceDetached ? 'detached' : lastTarget;
      if (drop === 'detached') {
        void props.onDetach?.({ screenX: lastPoint.screenX, screenY: lastPoint.screenY });
      } else {
        void props.onDock?.(drop);
      }
    }

    function move(next: PointerEvent): void {
      if (next.pointerId !== pointerId) return;
      remember(next);
      if (!active && Math.hypot(next.clientX - startX, next.clientY - startY) < 7) return;
      if (!active) {
        active = true;
        document.documentElement.classList.add('cc-agent-workbench-dragging');
      }
      setTarget(lastTarget);
    }

    function finishPointer(next: PointerEvent): void {
      if (next.pointerId !== pointerId) return;
      remember(next);
      complete();
    }

    function finishMouse(next: MouseEvent): void {
      if (!active || next.button !== 0) return;
      remember(next);
      complete();
    }

    function cancelPointer(next: PointerEvent): void {
      if (next.pointerId !== pointerId) return;
      // Chromium can cancel the pointer when it crosses the BrowserWindow
      // boundary. Once a real drag is active, that is a tear-off gesture.
      complete(active);
    }

    function finishOnBlur(): void {
      // A mouse-up on the desktop can blur Electron before the renderer sees
      // pointerup. Preserve the user's tear-off instead of silently cancelling.
      complete(active);
    }

    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finishPointer, true);
    window.addEventListener('pointercancel', cancelPointer, true);
    window.addEventListener('mouseup', finishMouse, true);
    window.addEventListener('blur', finishOnBlur);
  };
  return { target, onPointerDown };
}

function AgentDragHandle({ controller, active }: { controller: ChatPanelController; active: boolean }) {
  const { t } = controller;
  const label = t('拖动工作台；拖到中间或窗口外可独立打开');
  return <button type="button" className="cc-header-btn cc-agent-header-action cc-agent-drag-handle"
    data-cc-agent-drag-handle data-active={active} title={label} aria-label={label}>
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <circle cx="4" cy="3" r="1" /><circle cx="10" cy="3" r="1" />
      <circle cx="4" cy="7" r="1" /><circle cx="10" cy="7" r="1" />
      <circle cx="4" cy="11" r="1" /><circle cx="10" cy="11" r="1" />
    </svg>
  </button>;
}

function ChatHeader({ controller }: { controller: ChatPanelController }) {
  const { props, t, agent } = controller;
  const drag = useAgentHeaderDrag(controller);
  const detached = props.hostMode === 'detached';
  const isMacDesktop = window.yoloCutDesktop?.platform === 'darwin';
  return <>
    {drag.target && createPortal(<AgentDockPreview target={drag.target} />, document.body)}
    <div className={`cc-chat-header cc-liquid-glass-host${detached ? ' cc-agent-native-drag-region cc-window-titlebar' : ' cc-agent-docked-header'}${detached && isMacDesktop ? ' cc-window-titlebar--mac' : ''}`}
      onPointerDown={drag.onPointerDown}>
    <LiquidGlassBackdrop />
    {detached && <DesktopWindowControls />}
    <div className="cc-chat-brand">
      <BrandMark size={20} />
      <span className="cc-chat-brand-copy">
        <YoloCutWordmark width={102} className="cc-glass-ink" />
        <small className="cc-glass-muted-ink">{t('Agent 工作台')}</small>
      </span>
    </div>
    {!detached && <AgentDragHandle controller={controller} active={drag.target !== null} />}
    <AgentRunInspector projectId={props.projectId} />
    {detached && <span id="cc-agent-change-log-slot" style={{ display: 'contents' }} />}
    <AgentDockControls controller={controller} />
    <button type="button" data-cc-agent-no-drag className="cc-header-btn cc-agent-header-action"
      onClick={agent.clearHistory} disabled={agent.running} title={t('清空对话')} aria-label={t('清空对话')}
      style={{ cursor: agent.running ? 'default' : 'pointer', opacity: agent.running ? 0.4 : 1 }}>
      <Icon name="trash" size={14} />
    </button>
    <button type="button" data-cc-agent-no-drag className="cc-header-btn cc-agent-header-action"
      onClick={props.onToggleCollapse}
      title={detached ? t('停靠回剪辑器') : t('收起 YoloCut Agent')}
      aria-label={detached ? t('停靠回剪辑器') : t('收起 YoloCut Agent')}>
      <span style={{ transform: `rotate(${props.dockSide === 'left' ? '90deg' : '-90deg'})`, display: 'inline-flex' }}><Icon name="chevronDown" size={14} /></span>
    </button>
  </div>
  </>;
}

function ChatOnboarding({ controller }: { controller: ChatPanelController }) {
  const { composer, t } = controller;
  return <div className="cc-chat-onboarding">
    <div className="cc-chat-onboarding-kicker">{t('从这里开工')}</div>
    <h2>{t('从一个剪辑目标开始')}</h2>
    <p>{t('选择工作流，或直接描述你想得到的成片。')}</p>
    <div className="cc-chat-starter-list">
      {EMPTY_PROJECT_STARTERS.map((starter) => (
        <button type="button" key={starter.label} onClick={() => {
          composer.setInput(t(starter.prompt));
          requestAnimationFrame(() => composer.taRef.current?.focus());
        }}>
          <span className="cc-chat-starter-icon"><Icon name={starter.icon} size={16} /></span>
          <span className="cc-chat-starter-copy">
            <strong>{t(starter.label)}</strong><small>{t(starter.description)}</small>
          </span>
          <span className="cc-chat-starter-arrow" aria-hidden="true">→</span>
        </button>
      ))}
    </div>
  </div>;
}

function EarlierMessagesButton({ controller }: { controller: ChatPanelController }) {
  const { visibleFrom, composer, t, scroll } = controller;
  if (visibleFrom === 0) return null;
  return <button type="button"
    onClick={() => {
      // Keep the current viewport anchored: the newly loaded history is
      // inserted above, so restore the previous bottom offset after render.
      const node = scroll.scrollRef.current;
      const bottomBefore = node ? node.scrollHeight - node.scrollTop : 0;
      composer.setVisibleMessageCount((count) => count + MESSAGE_WINDOW_SIZE);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (node) node.scrollTop = node.scrollHeight - bottomBefore;
      }));
    }}
    style={{ display: 'block', margin: '4px auto 12px', padding: '5px 10px', border: `1px solid ${theme.border}`, borderRadius: 6, background: 'transparent', color: theme.textDim, cursor: 'pointer', fontSize: 12 }}>
    {t('加载更早消息')}（{visibleFrom}）
  </button>;
}

function MessageEntries({ controller }: { controller: ChatPanelController }) {
  const { agent, composer, visibleMessages, visibleFrom } = controller;
  const onRetry = (retry: NonNullable<DisplayMessage['retry']>) => {
    if (!agent.running) void agent.send(retry.text, {
      askOnly: retry.askOnly,
      references: retry.references,
    });
  };
  return <>
    {groupMessages(visibleMessages, visibleFrom).map((item) => item.kind === 'toolgroup' ? (
      <ToolGroupRow key={item.index} name={item.name} items={item.items} />
    ) : (
      <ChatMessage key={item.index} msg={item.msg} running={agent.running}
        retry={item.msg.role === 'user' ? item.msg.retry : undefined}
        streaming={agent.running && item.index === agent.messages.length - 1 && item.msg.role === 'assistant'}
        widgetSubmitted={agent.messages.slice(item.index + 1).some((message) => message.role === 'user')}
        onRetry={onRetry}
        onContinue={item.msg.role === 'continue' && item.index === agent.messages.length - 1 && !agent.running
          ? () => { void agent.send('继续'); } : null}
        onWidgetSubmit={(answer) => {
          if (!agent.running) void agent.send(answer, { askOnly: composer.mode === 'ask' });
        }} />
    ))}
  </>;
}

function AgentRunCards({ controller }: { controller: ChatPanelController }) {
  const { agent, composer, externalProposal, props, streamingThinking, runSeed } = controller;
  const showProposal = agent.proposal
    && !composer.autoApply;
  return <>
    <ChatRunStatus running={agent.running} liveTool={agent.liveTool}
      streamingThinking={streamingThinking} phraseSeed={runSeed}
      startedAt={readStoredServerRun(props.projectId)?.createdAt ?? Date.now()} />
    {showProposal && agent.proposal && (
      <ProposalCard proposal={agent.proposal} onApply={agent.applyProposal} onReject={agent.rejectProposal}
        stale={agent.proposalStale} onForceApply={agent.forceApplyProposal} onRePropose={agent.reProposeStale}
        onPreview={(on) => props.onPreviewState(on ? agent.proposal?.resultState ?? null : null)} />
    )}
    <ExternalProposalCard external={externalProposal} onPreviewState={props.onPreviewState} />
  </>;
}

function ScrollNavigation({ controller }: { controller: ChatPanelController }) {
  const { scroll, t } = controller;
  const target = scroll.target;
  if (!target) return null;
  const label = t(target === 'top' ? '快速到顶部' : '快速到底部');
  return <div className={`cc-chat-scroll-navigation cc-chat-scroll-navigation--${target}`}
    aria-label={t('聊天滚动快捷操作')}>
    <button type="button"
      className={`cc-chat-scroll-navigation-button cc-tip${target === 'bottom' ? ' cc-chat-scroll-navigation-button--bottom cc-tip-up' : ''}`}
      data-tip={label} aria-label={label} onClick={() => scroll.scrollTo(target)}>
      <Icon name="arrowUp" size={14} />
    </button>
  </div>;
}

function MessageWorkspace({ controller }: { controller: ChatPanelController }) {
  const { agent, scroll } = controller;
  return <div className="cc-chat-messages-shell">
    <div ref={scroll.scrollRef} onScroll={scroll.onScroll}
      className={`cc-chat-messages${agent.messages.length === 0 ? ' empty' : ''}`}>
      {agent.messages.length === 0 && <ChatOnboarding controller={controller} />}
      <EarlierMessagesButton controller={controller} />
      <MessageEntries controller={controller} />
      <AgentRunCards controller={controller} />
    </div>
    <ScrollNavigation controller={controller} />
  </div>;
}

function QuickActionSelect({ controller }: { controller: ChatPanelController }) {
  const { agent, composer, t } = controller;
  return <select aria-label={t('快速操作')} value="" disabled={agent.running}
    onChange={(event) => {
      if (!event.target.value) return;
      const action = QUICK_ACTIONS[Number(event.target.value)];
      if (!action) return;
      composer.setInput(t(action.prompt));
      requestAnimationFrame(() => composer.taRef.current?.focus());
    }}
    style={{ width: '100%', marginBottom: 8, border: `1px solid ${theme.border}`, borderRadius: 6, padding: '6px 8px', background: theme.panelAlt, color: theme.text, fontSize: 12 }}>
    <option value="">{t('快速操作…')}</option>
    {QUICK_ACTIONS.map((action, index) => (
      <option key={action.label} value={index}>{t(action.label)}</option>
    ))}
  </select>;
}

function ComposerInput({ controller }: { controller: ChatPanelController }) {
  const { props, agent, composer, actions, references, t } = controller;
  return <ChatComposer
    value={composer.input} onChange={actions.onComposerChange}
    onSubmit={actions.submit} onStop={agent.stop}
    onEnhance={actions.runEnhance} enhancing={composer.enhancing} running={agent.running}
    mode={composer.mode} onModeChange={composer.setMode}
    autoApply={composer.autoApply} onAutoApplyChange={composer.setAutoApply}
    agentSettings={composer.agentSettings} patchAgent={composer.patchAgent}
    contextUsage={agent.contextUsage}
    selecting={composer.selecting} onToggleSelecting={() => composer.setSelecting((value) => !value)}
    creativeMode={props.creativeMode} onCreativeModeChange={props.onCreativeModeChange}
    references={references} onInsertRef={actions.insertRef}
    selectedRefs={composer.selectedRefs} onRemoveRef={actions.removeRef}
    onPasteFiles={actions.importPastedFiles} onDropFiles={actions.importPastedFiles}
    pasting={composer.pendingAttachmentCount > 0}
    pendingAttachmentCount={composer.pendingAttachmentCount}
    pasteError={composer.pasteError} onDismissPasteError={() => composer.setPasteError(null)}
    onDropEditorItem={actions.onDropEditorItem} taRef={composer.taRef}
    placeholder={agent.messages.length === 0
      ? t('描述你想要创建的内容...') : t('告诉 AI 要做哪些修改 - @ 引用素材')} />;
}

function ComposerSection({ controller }: { controller: ChatPanelController }) {
  return <div className="cc-chat-composer-section" style={{ padding: 12, borderTop: `1px solid ${theme.border}`, minWidth: 0, flexShrink: 0, boxSizing: 'border-box' }}>
    <AutoEditIntakePanel controller={controller} />
    <QuickActionSelect controller={controller} />
    <ComposerInput controller={controller} />
  </div>;
}

function ExpandedPanel({ controller }: { controller: ChatPanelController }) {
  const { scroll, props } = controller;
  const dockSide = props.dockSide ?? 'right';
  const detached = props.hostMode === 'detached';
  return <>
    <ChangeLogPortal controller={controller} />
    <aside className={`cc-chat-panel${detached ? ' cc-chat-panel--detached' : ''}`} data-cc-chat-popover-boundary data-cc-shortcut-surface="agent-chat"
      data-cc-agent-dock={detached ? 'detached' : dockSide}
      data-cc-agent-item-count={props.ctx.getState().items.length}
      tabIndex={-1} onKeyDown={scroll.onKeyDown}
      onPointerDownCapture={(event) => {
        if (!(event.target instanceof HTMLElement)) return;
        if (!event.target.closest('button, input, select, textarea, [contenteditable="true"]')) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      style={{
        gridColumn: detached ? undefined : dockSide === 'left' ? 1 : 5,
        gridRow: detached ? undefined : '2 / 5',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: !detached && dockSide === 'right' ? `1px solid ${theme.border}` : undefined,
        borderRight: !detached && dockSide === 'left' ? `1px solid ${theme.border}` : undefined,
        background: theme.panel,
        minHeight: 0,
        minWidth: 0,
        width: detached ? '100%' : undefined,
        height: detached ? '100%' : undefined,
      }}>
      <ChatHeader controller={controller} />
      <CapabilityBanner controller={controller} />
      <div className="cc-chat-workbench-content">
        <MessageWorkspace controller={controller} />
        <ComposerSection controller={controller} />
      </div>
    </aside>
  </>;
}

export function ChatPanelView({ controller }: { controller: ChatPanelController }) {
  return controller.props.collapsed
    ? <CollapsedPanel controller={controller} />
    : <ExpandedPanel controller={controller} />;
}
