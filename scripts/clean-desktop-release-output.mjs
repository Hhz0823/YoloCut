import { readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SUPPORTED_TARGETS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'win32-x64',
  'linux-x64',
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function targetSpec(target, version) {
  const escapedVersion = escapeRegex(version);
  switch (target) {
    case 'darwin-arm64':
      return {
        directories: ['mac-arm64'],
        metadata: ['latest-arm64-mac.yml', 'latest.yml'],
        artifact: new RegExp(`^YoloCut-v${escapedVersion}-arm64\\.(?:dmg|zip)(?:\\.blockmap)?$`),
      };
    case 'darwin-x64':
      return {
        directories: ['mac'],
        metadata: ['latest-x64-mac.yml', 'latest.yml'],
        artifact: new RegExp(`^YoloCut-v${escapedVersion}-x64\\.(?:dmg|zip)(?:\\.blockmap)?$`),
      };
    case 'win32-x64':
      return {
        directories: ['win-unpacked'],
        metadata: ['latest-x64.yml', 'latest.yml'],
        artifact: new RegExp(`^(?:YoloCut-v${escapedVersion}-x64\\.exe(?:\\.blockmap)?|yolocut-${escapedVersion}-x64\\.nsis\\.7z)$`, 'i'),
      };
    case 'linux-x64':
      return {
        directories: ['linux-unpacked'],
        metadata: ['latest-x64-linux.yml', 'latest.yml'],
        artifact: new RegExp(`^YoloCut-v${escapedVersion}-x86_64\\.AppImage(?:\\.blockmap)?$`),
      };
    default:
      throw new Error(`unsupported desktop release target: ${target}`);
  }
}

function assertReleasePath(root, candidate) {
  const normalizedRoot = resolve(root);
  const releaseRoot = resolve(normalizedRoot, 'release');
  const normalizedCandidate = resolve(candidate);
  if (dirname(releaseRoot) !== normalizedRoot || !normalizedCandidate.startsWith(`${releaseRoot}${sep}`)) {
    throw new Error(`refusing to clean outside the project release directory: ${normalizedCandidate}`);
  }
  return normalizedCandidate;
}

export async function cleanDesktopReleaseOutput({ root, target, version }) {
  if (!SUPPORTED_TARGETS.has(target)) {
    throw new Error(`unsupported desktop release target: ${target}`);
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid desktop release version: ${version}`);
  }

  const releaseRoot = resolve(root, 'release');
  const spec = targetSpec(target, version);
  const names = await readdir(releaseRoot).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const selected = new Set([
    'builder-debug.yml',
    'builder-effective-config.yaml',
    ...spec.metadata,
    ...spec.directories,
    ...names.filter((name) => spec.artifact.test(name)),
  ]);

  for (const name of selected) {
    const candidate = assertReleasePath(root, join(releaseRoot, name));
    await rm(candidate, { recursive: true, force: true });
  }

  console.log(`[release-clean] ${target} removed ${selected.size} target-specific output paths`);
  return [...selected].sort();
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    throw new Error(`target required; use one of: ${[...SUPPORTED_TARGETS].join(', ')}`);
  }
  const packageJson = JSON.parse(await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8'));
  await cleanDesktopReleaseOutput({ root: PROJECT_ROOT, target, version: packageJson.version });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`[release-clean] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
