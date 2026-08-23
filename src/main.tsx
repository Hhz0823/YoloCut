import './index.css';
import './macos-vibrancy.css';
import './liquid-glass.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ComponentType } from 'react';
import { resolveAppSurface, type AppSurface } from './app/appSurface';
import { registerLocalFonts } from './fonts/localFonts';
import { initSkins } from './skins';

// Inject skin variables and apply persistent skin before rendering to avoid flashing the default color in the first frame.
initSkins();

// Register bundled local faces without loading the Google/Remotion font graph.
// TimelineComposition still resolves a requested Google face on demand.
try {
  registerLocalFonts();
} catch {
  // Registration is opportunistic; explicit ensureFont() remains fail-closed.
}

const root = document.getElementById('root');
if (!root) throw new Error('no #root');

const surface = resolveAppSurface(window.location.search);

async function loadSurfaceRoot(target: AppSurface): Promise<ComponentType> {
  if (target === 'transcript') {
    return (await import('./media/TranscriptWindowRoot')).TranscriptWindowRoot;
  }
  if (target === 'agent') {
    return (await import('./components/chat/AgentWindowRoot')).AgentWindowRoot;
  }
  return (await import('./App')).default;
}

// Installed content is irrelevant to the transcript-only window. For the main
// editor and detached Agent it hydrates in parallel, without holding the first
// visible frame behind the plugin registry and its editing dependencies.
if (surface !== 'transcript') {
  void import('./plugins/store')
    .then(({ hydratePlugins }) => hydratePlugins())
    .catch(() => undefined);
}

void loadSurfaceRoot(surface)
  .then((SurfaceRoot) => {
    createRoot(root).render(
      <StrictMode>
        <SurfaceRoot />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    console.error('[startup] failed to load application surface', error);
    root.setAttribute('role', 'alert');
    root.textContent = 'YoloCut failed to start.';
  });
