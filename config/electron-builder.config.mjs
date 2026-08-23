// Desktop packaging configuration, introduced in M2 and expanded to three targets in M4. Output: release/.
// Run npm run desktop:dist(:mac-x64 / :win). The pipeline is Vite build → esbuild main process
// → prebuild Remotion bundle → prepare target binaries → electron-builder.
// Notes:
// - files includes only the main-process bundle; electron-builder collects production node_modules automatically.
//   @remotion/renderer is required at runtime, while @remotion/bundler is used only during prebuild.
//   Keep only the CC_EB_TARGET compositor package because each one is about 180 MB.
// - asar stays disabled because @remotion/renderer chmods and spawns the compositor at its resolved path.
//   Even when unpacked, an asar path still points inside the archive and chmod fails with ENOTDIR.
//   Expanding real files avoids that failure at the cost of extra small-file I/O during startup.
// - dist and the prebuilt Remotion bundle use extraResources. prepare-target populates the
//   chrome-headless-shell staging directory, main.ts locates it through process.resourcesPath,
//   and the bundle is copied into writable userData on first launch.
// - Without signing credentials, macOS builds use ad-hoc signing and Windows builds trigger SmartScreen.
//   Add certificates and notarization for official distribution.
// - macOS uses a pre-generated standard icns to avoid corrupt 48 px layers during conversion.
//   Windows continues deriving its ico from the web PNG.

// Package names follow @remotion/renderer optionalDependencies: win32 uses -msvc and Linux includes a libc suffix.
const COMPOSITORS = [
  'darwin-arm64', 'darwin-x64', 'win32-x64-msvc',
  'linux-arm64-gnu', 'linux-arm64-musl', 'linux-x64-gnu', 'linux-x64-musl',
];
const ONNX_RUNTIME_TARGETS = [
  'darwin/arm64', 'darwin/x64', 'win32/arm64', 'win32/x64', 'linux/arm64', 'linux/x64',
];
const TARGET_COMPOSITOR = { 'darwin-arm64': 'darwin-arm64', 'darwin-x64': 'darwin-x64', 'win32-x64': 'win32-x64-msvc', 'linux-x64': 'linux-x64-gnu' };
const target = process.env.CC_EB_TARGET ?? `${process.platform}-${process.arch}`;
const keep = TARGET_COMPOSITOR[target] ?? target;
const nativeInferenceSupported = target.startsWith('darwin-')
  || target.startsWith('win32-') || target.startsWith('linux-');
const keepOnnxRuntime = nativeInferenceSupported ? target.replace('-', '/').replace('-msvc', '') : null;
const nativeInferenceWorkers = nativeInferenceSupported
  ? [
      'desktop-dist/native-asr-worker.mjs',
      'desktop-dist/native-semantic-worker.mjs',
      'desktop-dist/native-clap-worker.mjs',
      'desktop-dist/native-rhythm-worker.mjs',
      'desktop-dist/native-tts-worker.mjs',
    ]
  : [];
const onnxRuntimeFilters = keepOnnxRuntime
  ? ONNX_RUNTIME_TARGETS
      .filter((runtimeTarget) => runtimeTarget !== keepOnnxRuntime)
      .map((runtimeTarget) => `!node_modules/onnxruntime-node/bin/napi-v6/${runtimeTarget}/**`)
  : ['!node_modules/onnxruntime-node/**'];
// sqlite-vec publishes separate extension packages whose suffixes do not all
// match Node's process.platform names. Keep only the package for this artifact.
const SQLITE_VEC_PACKAGES = [
  'darwin-arm64', 'darwin-x64', 'windows-x64', 'linux-arm64', 'linux-x64',
];
const TARGET_SQLITE_VEC_PACKAGE = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-x64',
  'win32-x64': 'windows-x64',
  'linux-arm64': 'linux-arm64',
  'linux-x64': 'linux-x64',
};
const keepSqliteVec = TARGET_SQLITE_VEC_PACKAGE[target];
const sqliteVecFilters = SQLITE_VEC_PACKAGES
  .filter((packageSuffix) => packageSuffix !== keepSqliteVec)
  .map((packageSuffix) => `!node_modules/sqlite-vec-${packageSuffix}/**`);
const updateChannel = target.includes('arm64') ? 'latest-arm64' : 'latest-x64';
const hasMacSigningCertificate = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const releaseRepository = (process.env.YOLOCUT_RELEASE_REPOSITORY ?? process.env.GITHUB_REPOSITORY ?? '').trim();
const releaseRepositoryMatch = /^([^/\s]+)\/([^/\s]+)$/.exec(releaseRepository);
if (releaseRepository && !releaseRepositoryMatch) {
  throw new Error('YOLOCUT_RELEASE_REPOSITORY must use owner/repository format');
}
const publish = releaseRepositoryMatch
  ? [{
      provider: 'github',
      owner: releaseRepositoryMatch[1],
      repo: releaseRepositoryMatch[2],
      channel: updateChannel,
    }]
  : [];

export default {
  appId: 'dev.yolocut.desktop',
  productName: 'YoloCut',
  artifactName: '${productName}-v${version}-${arch}.${ext}',
  directories: { output: 'release' },
  // 7z LZMA maximum compression for the distributable installers (dmg/zip/nsis/AppImage).
  // Trade-off: noticeably slower packaging time in exchange for a smaller final download.
  // The app.asar content itself is handled by the `compression` setting; native binaries
  // (onnxruntime-node, ffmpeg-static, @remotion/compositor) remain unpacked per their filters.
  compression: 'maximum',
  // A local/private build must not silently update itself from upstream
  // YoloCut. CI or an official YoloCut build opts into its own repository.
  publish,
  files: [
    'desktop-dist/main.mjs',
    'desktop-dist/preload.cjs',
    ...nativeInferenceWorkers,
    'package.json',
    'THIRD_PARTY_NOTICES.md',
    // Keep only the target compositor; renderer selects its package from process.platform at runtime.
    ...COMPOSITORS.filter((c) => c !== keep).map((c) => `!node_modules/@remotion/compositor-${c}/**`),
    // onnxruntime-node publishes every platform in one package; ship only this artifact's binary.
    ...onnxRuntimeFilters,
    // sqlite-vec (semantic vectors): ship only the target platform's vec0 extension.
    ...sqliteVecFilters,
  ],
  asar: false,
  extraResources: [
    // Exclude media/uploads because Vite copies all of public/ into dist, which would embed gigabytes of user assets.
    // uploadsMiddleware serves /media/uploads directly from the asset directory (userData in packaged builds),
    // so resources/dist never needs those files.
    { from: 'dist', to: 'dist', filter: ['**/*', '!media/uploads/**'] },
    { from: 'desktop-dist/remotion-bundle', to: 'remotion-bundle' },
    { from: 'desktop-dist/chrome-headless-shell', to: 'chrome-headless-shell' },
  ],
  npmRebuild: false,
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.video',
    icon: 'assets/branding/yolocut-icon.icns',
    entitlements: 'desktop/entitlements.mac.plist',
    entitlementsInherit: 'desktop/entitlements.mac.plist',
    // Hardened runtime is required for Developer ID distribution. Ad-hoc local
    // and CI packages have no notarization identity, so enabling it only adds
    // library-validation restrictions without a security benefit.
    hardenedRuntime: hasMacSigningCertificate,
    // Sign the bundle ad hoc without a Developer ID so Finder still treats it as executable.
    // When CI injects CSC_LINK / CSC_NAME, electron-builder selects the official certificate automatically.
    ...(hasMacSigningCertificate ? {} : { identity: '-' }),
  },
  win: {
    target: ['nsis'],
    icon: 'public/yolocut-icon.png',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  linux: {
    target: ['AppImage'],
    icon: 'public/yolocut-icon.png',
    category: 'AudioVideo',
    // Keep the executable name stable for release/linux-unpacked/yolocut and CI smoke tests.
    executableName: 'yolocut',
    // Pair with package.json desktopName so desktop environments associate the window with its .desktop entry.
    syncDesktopName: true,
  },
};
