import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electronPath from 'electron';

const userData = mkdtempSync(join(tmpdir(), 'yolocut-smoke-'));
const smokeAgentWindow = process.argv.includes('--agent-window');
let result;
try {
  result = spawnSync(electronPath, [`--user-data-dir=${userData}`, 'desktop-dist/main.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CC_SMOKE: '1',
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
