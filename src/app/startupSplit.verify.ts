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

console.log('startupSplit.verify: renderer surfaces, dashboard dialogs, and first-run templates are lazy');
