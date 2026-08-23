import { useEffect, useState } from 'react';
import type { LiveTool } from '../../agent/agent-session';
import { useT } from '../../i18n/locale';
import { theme } from '../../theme';
import { thinkingPhrase } from './thinkingPhrases';
import { elapsedRunSeconds } from './ChatRunStatus.ts';

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  const seconds = elapsedRunSeconds(startedAt, now);
  return <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.75, flexShrink: 0 }}>{seconds.toFixed(1)}s</span>;
}

export function ChatRunStatus({
  running,
  liveTool,
  streamingThinking,
  phraseSeed,
  startedAt,
}: {
  running: boolean;
  liveTool: LiveTool | null;
  streamingThinking: boolean;
  phraseSeed: number;
  startedAt: number;
}) {
  const t = useT();
  return <>
    {running && liveTool && (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, margin: '9px 0', color: theme.textDim, fontSize: 12.5 }}>
        <span style={{ width: 7, height: 7, borderRadius: 4, background: theme.accent, flexShrink: 0, marginTop: 5 }} />
        <span style={{ minWidth: 0, lineHeight: 1.45 }}>
          <span style={{ fontFamily: 'SFMono-Regular, ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: 0.2 }}>{liveTool.name}</span>
          {liveTool.partial
            ? (
              <span style={{ display: 'block', fontFamily: 'SFMono-Regular, ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, opacity: 0.65, overflowWrap: 'anywhere' }}>
                {liveTool.partial}
              </span>
            )
            : <span style={{ opacity: 0.8 }}> · {t('正在执行…')}</span>}
        </span>
      </div>
    )}
    {running && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: theme.textDim, fontSize: 12.5, margin: '10px 0' }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: theme.accent, flexShrink: 0 }} />
        {streamingThinking ? (
          <>
            <span>{t('思考中…')}</span>
          </>
        ) : <>{t(thinkingPhrase(phraseSeed))}…</>}
        <ElapsedTimer startedAt={startedAt} />
      </div>
    )}
  </>;
}
