import { usePersistedState } from './usePersistedState';
import type { AgentWorkbenchPlacement } from '../../shared/agent-workbench';

const HEADER_HEIGHT = 52;
const COLLAPSED_CHAT_WIDTH = 48;
const BASELINE_WIDTH = 1463;
const BASELINE_CONTENT_HEIGHT = 750;

const DEFAULT_CHAT_RATIO = 360 / BASELINE_WIDTH;
const DEFAULT_LIBRARY_RATIO = 330 / BASELINE_WIDTH;
const DEFAULT_TIMELINE_RATIO = 320 / BASELINE_CONTENT_HEIGHT;
const MIN_CHAT_RATIO = 320 / BASELINE_WIDTH;
const MIN_LIBRARY_RATIO = 176 / BASELINE_WIDTH;
const MIN_PREVIEW_RATIO = 280 / BASELINE_WIDTH;
const MIN_TIMELINE_RATIO = 260 / BASELINE_CONTENT_HEIGHT;
const MIN_UPPER_RATIO = 300 / BASELINE_CONTENT_HEIGHT;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteRatio(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? BASELINE_WIDTH : Math.max(1, window.innerWidth);
}

function contentHeight(): number {
  if (typeof window === 'undefined') return BASELINE_CONTENT_HEIGHT;
  return Math.max(1, window.innerHeight - HEADER_HEIGHT);
}

function normalizeRatios(chat: number, library: number, timeline: number, includeChat: boolean) {
  const chatRatio = clamp(
    finiteRatio(chat, DEFAULT_CHAT_RATIO),
    MIN_CHAT_RATIO,
    1 - MIN_LIBRARY_RATIO - MIN_PREVIEW_RATIO,
  );
  return {
    chatRatio,
    libraryRatio: clamp(
      finiteRatio(library, DEFAULT_LIBRARY_RATIO),
      MIN_LIBRARY_RATIO,
      1 - (includeChat ? chatRatio : 0) - MIN_PREVIEW_RATIO,
    ),
    timelineRatio: clamp(
      finiteRatio(timeline, DEFAULT_TIMELINE_RATIO),
      MIN_TIMELINE_RATIO,
      1 - MIN_UPPER_RATIO,
    ),
  };
}

export interface EditorPanelLayout {
  gridTemplateColumns: string;
  gridTemplateRows: string;
  resizeChat: (delta: number) => void;
  resizeLibrary: (delta: number) => void;
  resizeTimeline: (delta: number) => void;
}

/**
 * Keeps user-resized editor panels as viewport-relative ratios. CSS vw/fr tracks
 * then react to both window resizing and browser zoom without a JS resize loop.
 */
export function useEditorPanelLayout(
  chatCollapsed: boolean,
  placement: AgentWorkbenchPlacement = 'right',
): EditorPanelLayout {
  const [storedChatRatio, setChatRatio] = usePersistedState(
    'yolocut.chatRatio.ui-v3',
    DEFAULT_CHAT_RATIO,
  );
  const [storedLibraryRatio, setLibraryRatio] = usePersistedState(
    'yolocut.libraryRatio.ui-v3',
    DEFAULT_LIBRARY_RATIO,
  );
  const [storedTimelineRatio, setTimelineRatio] = usePersistedState(
    'yolocut.timelineRatio.ui-v3',
    DEFAULT_TIMELINE_RATIO,
  );

  const { chatRatio, libraryRatio, timelineRatio } = normalizeRatios(
    storedChatRatio,
    storedLibraryRatio,
    storedTimelineRatio,
    placement !== 'detached',
  );

  const chatTrack = chatCollapsed ? `${COLLAPSED_CHAT_WIDTH}px` : `${chatRatio * 100}vw`;
  const editorTracks = `${libraryRatio * 100}vw 0 minmax(0, 1fr)`;
  const gridTemplateColumns = placement === 'left'
    ? `${chatTrack} 0 ${editorTracks}`
    : placement === 'right'
      ? `${editorTracks} 0 ${chatTrack}`
      : editorTracks;
  const gridTemplateRows = `${HEADER_HEIGHT}px minmax(0, ${1 - timelineRatio}fr) 0 minmax(0, ${timelineRatio}fr)`;

  const resizeChat = (delta: number) => setChatRatio((current) => roundRatio(clamp(
    finiteRatio(current, DEFAULT_CHAT_RATIO) + delta / viewportWidth(),
    MIN_CHAT_RATIO,
    1 - libraryRatio - MIN_PREVIEW_RATIO,
  )));
  const resizeLibrary = (delta: number) => setLibraryRatio((current) => {
    const chatShare = placement === 'detached'
      ? 0
      : chatCollapsed ? COLLAPSED_CHAT_WIDTH / viewportWidth() : chatRatio;
    return roundRatio(clamp(
      finiteRatio(current, DEFAULT_LIBRARY_RATIO) + delta / viewportWidth(),
      MIN_LIBRARY_RATIO,
      1 - chatShare - MIN_PREVIEW_RATIO,
    ));
  });
  const resizeTimeline = (delta: number) => setTimelineRatio((current) => roundRatio(clamp(
    finiteRatio(current, DEFAULT_TIMELINE_RATIO) - delta / contentHeight(),
    MIN_TIMELINE_RATIO,
    1 - MIN_UPPER_RATIO,
  )));

  return { gridTemplateColumns, gridTemplateRows, resizeChat, resizeLibrary, resizeTimeline };
}
