import { defineConfig, loadEnv, searchForWorkspaceRoot, type Plugin } from 'vite';
import { parse as parseDotenv } from 'dotenv';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { serverPlugins } from '../server/plugins/index.ts';
import { seedKeystore, getKey } from '../server/keystore.ts';
import { applyLegacyEnvironmentAliases } from '../shared/product-compat.ts';
import { productAssetsPlugin } from '../server/product-assets.ts';
import { runtimeProfile } from '../server/runtime-profile.ts';

const appPackage = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: unknown };
if (typeof appPackage.version !== 'string') throw new Error('package.json is missing a valid version');
export function applyAuthoritativeLocalProvider(
  env: Record<string, string>,
  source: string,
): void {
  const parsed = parseDotenv(source);
  const fileProvider = parsed.LLM_PROVIDER;
  if (fileProvider !== undefined) env.LLM_PROVIDER = fileProvider.trim();
}

// User/runtime media (public/media/uploads) and on-device models
// (public/media/asr-models) are served at runtime by the upload middleware and
// media-dir resolvers, NEVER from the static `dist/` build output — Vite copies
// the whole `public/` tree into `outDir`, which would otherwise bake gigabytes
// of user uploads into `dist/` on every `vite build`. This plugin strips those
// two runtime-only subtrees from the build output after the build finishes.
// It is pure build-output hygiene: it touches no runtime path, no URL semantics,
// and no persisted data (electron-builder's own `!media/uploads/**` filter stays
// as a second belt-and-suspenders guard).
const USER_MEDIA_IN_BUILD = ['media/uploads', 'media/asr-models'];

function excludeUserMediaFromBuild(): Plugin {
  let outDir = resolve(process.cwd(), 'dist');
  return {
    name: 'yolocut-exclude-user-media',
    apply: 'build',
    configResolved(config) {
      // Honour Vite's resolved `build.outDir` (defaults to <root>/dist), so the
      // prune stays correct even if the build root or output dir is reconfigured.
      outDir = config.build.outDir;
    },
    closeBundle() {
      for (const rel of USER_MEDIA_IN_BUILD) {
        const target = resolve(outDir, rel);
        if (existsSync(target)) {
          try {
            rmSync(target, { recursive: true, force: true });
            process.stdout.write(`[vite] pruned runtime media out of build output: ${rel}\n`);
          } catch {
            // A cleanup failure must never fail the build: the runtime already
            // ignores `dist/media/` and electron-builder filters uploads too.
          }
        }
      }
    },
  };
}

const STARTUP_SURFACE_BUDGETS = [
  { label: 'bootstrap', module: '/src/main.tsx', maxBytes: 300_000 },
  { label: 'dashboard', module: '/src/App.tsx', maxBytes: 1_100_000 },
  { label: 'transcript', module: '/src/media/TranscriptWindowRoot.tsx', maxBytes: 500_000 },
  { label: 'agent', module: '/src/components/chat/AgentWindowRoot.tsx', maxBytes: 5_200_000 },
  { label: 'editor', module: '/src/Editor.tsx', maxBytes: 8_000_000 },
] as const;

/** Guard the complete statically imported graph for each renderer surface.
 * Dynamic workloads such as HEIC, Babel and export rendering are excluded. */
function startupSurfaceBudget(): Plugin {
  return {
    name: 'yolocut-startup-surface-budget',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
      const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
      const staticClosure = (root: (typeof chunks)[number]): (typeof chunks)[number][] => {
        const seen = new Set<string>();
        const closure: (typeof chunks)[number][] = [];
        const visit = (chunk: (typeof chunks)[number]): void => {
          if (seen.has(chunk.fileName)) return;
          seen.add(chunk.fileName);
          closure.push(chunk);
          for (const fileName of chunk.imports) {
            const dependency = byFile.get(fileName);
            if (dependency) visit(dependency);
          }
        };
        visit(root);
        return closure;
      };
      for (const budget of STARTUP_SURFACE_BUDGETS) {
        const root = chunks.find((chunk) => chunk.moduleIds.some(
          (id) => id.replaceAll('\\', '/').endsWith(budget.module),
        ));
        if (!root) this.error(`[startup-budget] missing ${budget.label} surface (${budget.module})`);
        const closure = staticClosure(root);
        const bytes = closure.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0);
        process.stdout.write(`[startup-budget] ${budget.label}: ${(bytes / 1024).toFixed(1)} KiB / ${(budget.maxBytes / 1024).toFixed(1)} KiB\n`);
        if (bytes > budget.maxBytes) {
          const largest = closure
            .map((chunk) => ({ fileName: chunk.fileName, bytes: Buffer.byteLength(chunk.code) }))
            .sort((left, right) => right.bytes - left.bytes)
            .slice(0, 6)
            .map((entry) => `${entry.fileName} ${(entry.bytes / 1024).toFixed(1)} KiB`)
            .join(', ');
          process.stdout.write(`[startup-budget] ${budget.label} largest: ${largest}\n`);
        }
        if (bytes > budget.maxBytes) {
          this.error(`[startup-budget] ${budget.label} grew to ${bytes} bytes (limit ${budget.maxBytes})`);
        }
      }
    },
  };
}


// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const profile = runtimeProfile();
  // The first isolated start may bootstrap from checkout env. Once profile settings
  // exist, only the wrapper-merged process env is authoritative for that profile.
  const env = profile.mode === 'isolated-dev' && existsSync(profile.keystorePath)
    ? Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    )
    : loadEnv(mode, process.cwd(), '');
  applyLegacyEnvironmentAliases(env);
  // Keep the default checkout's explicit .env.local provider authoritative over
  // unrelated host-shell values; isolated profiles remain wrapper-controlled.
  if (profile.mode !== 'isolated-dev' && existsSync('.env.local')) {
    applyAuthoritativeLocalProvider(env, readFileSync('.env.local', 'utf8'));
  }
  if (profile.mode === 'isolated-dev') {
    process.stdout.write(`[YoloCut] isolated profile ${profile.id} · ${profile.rootDir}\n`);
  }
  // Seed the runtime keystore so the settings UI (POST /api/keys) can override any key
  // live. Server plugins (assembled in server/plugins/index.ts, shared with the
  // Electron embedded server) read the keystore through GETTERS, so a saved value
  // takes effect on the next request with no restart. The `const`s below are only the
  // startup snapshot for the `define` (initial agent capability manifest).
  seedKeystore(env);
  const aaiKey = env.ASSEMBLYAI_API_KEY || '';
  const imageKey = env.IMAGE_API_KEY || env.OPENAI_API_KEY || '';
  const geminiKey = env.GEMINI_API_KEY || '';
  const elevenKey = env.ELEVENLABS_API_KEY || '';
  const doubaoAppId = env.DOUBAO_TTS_APP_ID || '';
  const doubaoAccessKey = env.DOUBAO_TTS_ACCESS_KEY || '';
  const murekaKey = env.MUREKA_API_KEY || '';
  // MiniMax domestic open platform — one key gates TTS / Hailuo video / music / image.
  const minimaxKey = env.MINIMAX_API_KEY || '';
  const seedanceKey = env.SEEDANCE_API_KEY || '';
  const klingKey = env.KLING_API_KEY || '';
  const pexelsKey = env.PEXELS_API_KEY || '';
  const pixabayKey = env.PIXABAY_API_KEY || '';
  const unsplashKey = env.UNSPLASH_ACCESS_KEY || '';
  const freesoundKey = env.FREESOUND_API_KEY || '';
  // Firecrawl (web_browser tool): .env.local or shell export (e.g. search-apis.env)
  const firecrawlKey = env.FIRECRAWL_API_KEY || process.env.FIRECRAWL_API_KEY || '';
  const e2bKey = env.E2B_API_KEY || process.env.E2B_API_KEY || '';
  // E2B_TEMPLATE (+ its process.env fallback) is now read live via the keystore getter below.

  return {
    // Server-computed manifest of which key-gated capabilities are configured,
    // injected for the agent's system prompt (src/agent/capabilities.ts). BOOLEANS
    // ONLY — no key value is ever exposed to the browser.
    define: {
      __APP_VERSION__: JSON.stringify(appPackage.version),
      __CONFIGURED_CAPS__: JSON.stringify({
        image: Boolean(imageKey || geminiKey || minimaxKey),
        voice: Boolean((doubaoAppId && doubaoAccessKey) || elevenKey || minimaxKey),
        video: Boolean(seedanceKey || klingKey || minimaxKey),
        music: Boolean(murekaKey || minimaxKey),
        sound: Boolean(elevenKey),
        stock: Boolean(pexelsKey || pixabayKey || unsplashKey || freesoundKey),
        transcription: Boolean(aaiKey),
        sandbox: Boolean(e2bKey),
        web: Boolean(firecrawlKey),
      }),
    },
    // public/ = user runtime only (media/uploads). Product static files live in assets/
    // and are served/copied by productAssetsPlugin (URLs unchanged: /fonts, /thumbnails, …).
    publicDir: 'public',
    plugins: [react(), productAssetsPlugin(), excludeUserMediaFromBuild(), startupSurfaceBudget(), ...serverPlugins()],
    server: {
      port: 5199,
      strictPort: true,
      // Pre-transform only the bootstrap and dashboard graphs. Paths are
      // root-relative filesystem entries (not URL paths); a leading slash is
      // interpreted as a drive-root path on Windows and produces /@fs errors.
      // The editor remains lazy so development startup does not compile every
      // editing and Agent dependency before a project is opened.
      warmup: {
        clientFiles: ['src/main.tsx', 'src/App.tsx'],
      },
      fs: {
        // Worktrees may symlink node_modules to the primary checkout. Keep
        // imported runtime assets (for example ONNX Runtime WASM) readable.
        allow: [searchForWorkspaceRoot(process.cwd()), realpathSync('node_modules')],
      },
      open: '/',
      proxy: {
        // AssemblyAI transcription — key injected server-side (never in browser).
        '/assemblyai': {
          target: 'https://api.assemblyai.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/assemblyai/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              const ak = getKey('ASSEMBLYAI_API_KEY') || aaiKey;  // live override
              if (ak) proxyReq.setHeader('authorization', ak);
            });
          },
        },
      },
    },
    build: {
      // Babel/Remotion/template catalogs and the on-demand HEIC decoder are
      // intentional named chunks. The startup budget plugin below tracks the
      // eagerly loaded renderer surfaces separately from these rare workloads.
      chunkSizeWarningLimit: 3_200,
      rolldownOptions: {
        checks: {
          // This diagnostic reports host I/O timing rather than a correctness
          // issue and is unstable across local and GitHub-hosted runners.
          pluginTimings: false,
        },
        output: {
          codeSplitting: {
            groups: [
              { name: 'babel', test: /node_modules[\\/]@babel[\\/]standalone/, priority: 30, includeDependenciesRecursively: false },
              { name: 'templates', test: /yolocut-templates\.json/, priority: 25, includeDependenciesRecursively: false },
              { name: 'remotion', test: /node_modules[\\/](?:@remotion|remotion)[\\/]/, priority: 20, includeDependenciesRecursively: false },
              { name: 'heic', test: /node_modules[\\/]heic-to[\\/]/, priority: 18, includeDependenciesRecursively: false },
              { name: 'anthropic', test: /node_modules[\\/]@anthropic-ai[\\/]sdk/, priority: 15, includeDependenciesRecursively: false },
              { name: 'react', test: /node_modules[\\/](?:react|react-dom)[\\/]/, priority: 10 },
            ],
          },
        },
      },
    },
  };
});
