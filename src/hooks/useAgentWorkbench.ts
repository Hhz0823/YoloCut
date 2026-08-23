import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentDockSide,
  AgentWorkbenchDetachPoint,
  AgentWorkbenchPlacement,
  AgentWorkbenchState,
} from '../../shared/agent-workbench';
import {
  loadAgentWorkbenchDockSide,
  saveAgentWorkbenchDockSide,
} from '../persist/agentWorkbenchPreference';

export interface AgentWorkbenchHost {
  readonly placement: AgentWorkbenchPlacement;
  readonly dockSide: AgentDockSide;
  readonly dockPreview: AgentDockSide | null;
  readonly canDetach: boolean;
  readonly detach: (point?: AgentWorkbenchDetachPoint) => Promise<void>;
  readonly dock: (side: AgentDockSide) => Promise<void>;
}

/** Renderer-side projection of the single desktop Agent workbench host. */
export function useAgentWorkbench(projectId: string): AgentWorkbenchHost {
  const [dockSide, setDockSide] = useState<AgentDockSide>(loadAgentWorkbenchDockSide);
  const [placement, setPlacement] = useState<AgentWorkbenchPlacement>(dockSide);
  const [dockPreview, setDockPreview] = useState<AgentDockSide | null>(null);
  const popupPollRef = useRef<number | null>(null);
  const desktop = window.yoloCutDesktop?.agentWorkbench;

  const applyDesktopState = useCallback((state: AgentWorkbenchState) => {
    if (state.projectId !== projectId) {
      setPlacement((current) => current === 'detached' ? loadAgentWorkbenchDockSide() : current);
      setDockPreview(null);
      return;
    }
    setDockSide(state.dockSide);
    saveAgentWorkbenchDockSide(state.dockSide);
    setPlacement(state.placement);
    setDockPreview(state.dockPreview);
  }, [projectId]);

  useEffect(() => {
    if (!desktop) return undefined;
    let alive = true;
    void desktop.getState().then((state) => {
      if (alive) applyDesktopState(state);
    }).catch(() => undefined);
    const unsubscribe = desktop.subscribe((state) => {
      if (alive) applyDesktopState(state);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [applyDesktopState, desktop]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (event.origin !== window.location.origin || typeof event.data !== 'object' || event.data === null) return;
      const value = event.data as Record<string, unknown>;
      if (value.type !== 'yolocut-agent-dock' || value.projectId !== projectId) return;
      if (value.dockSide !== 'left' && value.dockSide !== 'right') return;
      const next = value.dockSide;
      if (popupPollRef.current !== null) {
        window.clearInterval(popupPollRef.current);
        popupPollRef.current = null;
      }
      setDockSide(next);
      saveAgentWorkbenchDockSide(next);
      setPlacement(next);
      setDockPreview(null);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [projectId]);

  useEffect(() => () => {
    if (popupPollRef.current !== null) window.clearInterval(popupPollRef.current);
  }, []);

  const dock = useCallback(async (side: AgentDockSide): Promise<void> => {
    setDockSide(side);
    saveAgentWorkbenchDockSide(side);
    setPlacement(side);
    setDockPreview(null);
    if (!desktop) return;
    try {
      applyDesktopState(await desktop.dock({ projectId, dockSide: side }));
    } catch {
      // The renderer is already in the requested safe docked layout.
    }
  }, [applyDesktopState, desktop, projectId]);

  const detach = useCallback(async (point?: AgentWorkbenchDetachPoint): Promise<void> => {
    setPlacement('detached');
    setDockPreview(null);
    if (desktop) {
      try {
        applyDesktopState(await desktop.detach({ projectId, dockSide, detachAt: point }));
      } catch {
        setPlacement(dockSide);
      }
      return;
    }
    const url = new URL(window.location.origin);
    url.searchParams.set('agent-window', '1');
    url.searchParams.set('projectId', projectId);
    const popupPosition = point
      ? `,left=${Math.round(point.screenX - 80)},top=${Math.round(point.screenY - 24)}`
      : '';
    const popup = window.open(
      url.href,
      `yolocut-agent-${projectId}`,
      `popup=yes,width=560,height=760${popupPosition}`,
    );
    if (!popup) {
      setPlacement(dockSide);
      return;
    }
    if (popupPollRef.current !== null) window.clearInterval(popupPollRef.current);
    popupPollRef.current = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(popupPollRef.current!);
      popupPollRef.current = null;
      const restoredSide = loadAgentWorkbenchDockSide();
      setDockSide(restoredSide);
      setPlacement(restoredSide);
    }, 300);
  }, [applyDesktopState, desktop, dockSide, projectId]);

  return {
    placement,
    dockSide,
    dockPreview,
    canDetach: Boolean(desktop || typeof window.open === 'function'),
    detach,
    dock,
  };
}
