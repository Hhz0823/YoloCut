import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveAppSurface } from './appSurface';

assert.equal(resolveAppSurface(''), 'main');
assert.equal(resolveAppSurface('?agent-window=1&projectId=p1'), 'agent');
assert.equal(resolveAppSurface('?transcript-window=1'), 'transcript');
assert.equal(
  resolveAppSurface('?agent-window=1&transcript-window=1'),
  'transcript',
  'transcript compatibility route keeps precedence when legacy flags overlap',
);

const mainSource = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(mainSource, /^import App from/m);
assert.doesNotMatch(mainSource, /^import \{ AgentWindowRoot \}/m);
assert.doesNotMatch(mainSource, /^import \{ TranscriptWindowRoot \}/m);
assert.match(mainSource, /import\('\.\/App'\)/);
assert.match(mainSource, /import\('\.\/components\/chat\/AgentWindowRoot'\)/);
assert.match(mainSource, /import\('\.\/media\/TranscriptWindowRoot'\)/);
assert.match(mainSource, /import\('\.\/plugins\/store'\)/);

const dashboardSource = readFileSync(
  new URL('../components/dashboard/DashboardViews.tsx', import.meta.url),
  'utf8',
);
assert.match(dashboardSource, /lazy\(\(\) => import\('\.\/DashboardDialogs'\)\)/);
for (const heavyDialog of [
  'MediaCleanupDialog',
  'ShortcutsDialog',
  'McpGuideDialog',
  'SettingsDialog',
  'StorageMigrationDialog',
]) {
  assert.doesNotMatch(
    dashboardSource,
    new RegExp(`^import .*${heavyDialog}`, 'm'),
    `${heavyDialog} must stay behind the dashboard dialog boundary`,
  );
}

const shellSource = readFileSync(new URL('./appShell.ts', import.meta.url), 'utf8');
assert.match(shellSource, /import\('\.\/firstRunSeed'\)/);
assert.doesNotMatch(shellSource, /import\('\.\.\/editor\/initial'\)/);
assert.match(
  shellSource,
  /setTimeout\([\s\S]*syncAgentBackends/,
  'provider status and local model hashing must wait until after first paint',
);

const dashboardModelSource = readFileSync(
  new URL('../components/dashboard/useDashboardModel.ts', import.meta.url),
  'utf8',
);
assert.match(dashboardModelSource, /THUMB_RENDER_CONCURRENCY = 1/);
assert.match(dashboardModelSource, /THUMB_RENDER_DELAY_MS = 4_000/);
assert.match(dashboardModelSource, /requestIdleCallback/, 'project poster rendering must wait for dashboard idle time');

const updateNoticeSource = readFileSync(
  new URL('../ui/UpstreamUpdateNotice.tsx', import.meta.url),
  'utf8',
);
assert.match(updateNoticeSource, /20_000/, 'automatic release checks must not compete with first paint');

console.log('startupSplit.verify: renderer surfaces, dashboard dialogs, and first-run templates are lazy');
