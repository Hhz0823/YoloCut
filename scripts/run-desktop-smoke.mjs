import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electronPath from 'electron';

const userData = mkdtempSync(join(tmpdir(), 'yolocut-smoke-'));
const profileId = randomUUID();
const isolatedDataDir = join(userData, 'app-data');
const smokeAgentWindow = process.argv.includes('--agent-window');
const smokeRender = process.argv.includes('--render');
const smokePostStartup = process.argv.includes('--post-startup');
const executableArgument = process.argv.find((argument) => argument.startsWith('--executable='));
const executable = executableArgument
  ? resolve(executableArgument.slice('--executable='.length))
  : electronPath;
const packagedExecutable = executable !== electronPath;
const chromeTarget = process.platform === 'win32'
  ? { directory: 'win64', binary: 'chrome-headless-shell.exe' }
  : process.platform === 'darwin'
    ? { directory: process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64', binary: 'chrome-headless-shell' }
    : { directory: 'linux64', binary: 'chrome-headless-shell' };
const stagedBrowser = join(
  process.cwd(),
  'desktop-dist',
  'chrome-headless-shell',
  chromeTarget.directory,
  `chrome-headless-shell-${chromeTarget.directory}`,
  chromeTarget.binary,
);
let result;
try {
  result = spawnSync(executable, [
    `--user-data-dir=${userData}`,
    ...(packagedExecutable ? [] : ['desktop-dist/main.mjs']),
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CC_SMOKE: '1',
      YOLOCUT_DEV_PROFILE_ID: profileId,
      YOLOCUT_DATA_DIR: isolatedDataDir,
      ...(smokeRender ? { CC_SMOKE_RENDER: '1' } : {}),
      ...(smokePostStartup ? { CC_SMOKE_POST_STARTUP: '1' } : {}),
      ...((smokeRender || smokePostStartup) && !packagedExecutable && existsSync(stagedBrowser)
        ? { CC_BROWSER_EXECUTABLE: stagedBrowser }
        : {}),
      ...(smokeAgentWindow ? { CC_SMOKE_AGENT_WINDOW: '1' } : {}),
    },
    stdio: 'inherit',
  });
} finally {
  // Smoke must not compete with or mutate a user's live Chromium cache, and
  // test state must never leak into a later desktop acceptance run.
  rmSync(userData, { recursive: true, force: true });
}

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
