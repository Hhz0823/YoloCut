param(
  [Parameter(Mandatory = $true)]
  [string]$Installer,
  [switch]$ExpectUpdateFeed
)

$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$smokeRoot = [IO.Path]::GetFullPath((Join-Path $tempBase "yolocut-installer-smoke-$PID"))
if (-not $smokeRoot.StartsWith("$tempBase\", [StringComparison]::OrdinalIgnoreCase) `
    -or [IO.Path]::GetFileName($smokeRoot) -notlike 'yolocut-installer-smoke-*') {
  throw "Unsafe YoloCut smoke root: $smokeRoot"
}

$installDir = Join-Path $smokeRoot 'app'
$userDataDir = Join-Path $smokeRoot 'user-data'
$installed = $false
$summary = $null

New-Item -ItemType Directory -Path $smokeRoot | Out-Null
try {
  $install = Start-Process -FilePath $installerPath `
    -ArgumentList @('/S', "/D=$installDir") -WindowStyle Hidden -Wait -PassThru
  if ($install.ExitCode -ne 0) {
    throw "YoloCut NSIS installer exited with $($install.ExitCode)"
  }

  $installedExe = Join-Path $installDir 'YoloCut.exe'
  if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
    throw "YoloCut installer did not create $installedExe"
  }
  foreach ($legacyExecutable in @('ChatCut.exe', 'OpenChatCut.exe')) {
    if (Test-Path -LiteralPath (Join-Path $installDir $legacyExecutable)) {
      throw "YoloCut installer unexpectedly retained $legacyExecutable"
    }
  }
  $installed = $true

  $versionInfo = (Get-Item -LiteralPath $installedExe).VersionInfo
  if ($versionInfo.ProductName -ne 'YoloCut') {
    throw "Installed executable ProductName is '$($versionInfo.ProductName)'"
  }
  $packagedJsonPath = Join-Path $installDir 'resources\app\package.json'
  $packagedJson = Get-Content -Raw -Encoding UTF8 -LiteralPath $packagedJsonPath | ConvertFrom-Json
  if ($packagedJson.name -ne 'yolocut') {
    throw "Packaged application name is '$($packagedJson.name)'"
  }
  $updateFeedPath = Join-Path $installDir 'resources\app-update.yml'
  $updateFeedPresent = Test-Path -LiteralPath $updateFeedPath -PathType Leaf
  if ($ExpectUpdateFeed -and -not $updateFeedPresent) {
    throw 'Release YoloCut package is missing its update feed'
  }
  if (-not $ExpectUpdateFeed -and $updateFeedPresent) {
    throw 'Private YoloCut package unexpectedly contains an update feed'
  }
  $updateFeedStatus = if ($updateFeedPresent) { 'enabled-release-build' } else { 'disabled-private-build' }

  $env:CC_SMOKE = '1'
  $env:CC_SMOKE_RENDER = '1'
  $env:CC_SMOKE_MCP_RECOVERY = '1'
  Remove-Item Env:YOLOCUT_DATA_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:YOLOCUT_MACHINE_STATE_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:YOLOCUT_LEGACY_MEDIA_DIR -ErrorAction SilentlyContinue
  $stdoutPath = Join-Path $smokeRoot 'yolocut-smoke.stdout.log'
  $stderrPath = Join-Path $smokeRoot 'yolocut-smoke.stderr.log'
  $smoke = Start-Process -FilePath $installedExe `
    -ArgumentList @("--user-data-dir=$userDataDir") -WindowStyle Hidden -Wait -PassThru `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  if ($smoke.ExitCode -ne 0) {
    $stdout = Get-Content -Raw -ErrorAction SilentlyContinue -LiteralPath $stdoutPath
    $stderr = Get-Content -Raw -ErrorAction SilentlyContinue -LiteralPath $stderrPath
    throw "Installed YoloCut smoke exited with $($smoke.ExitCode)`nSTDOUT:`n$stdout`nSTDERR:`n$stderr"
  }
  $isolatedRuntime = Join-Path $userDataDir 'runtime'
  $isolatedMachineState = Join-Path $userDataDir 'machine-state'
  if (-not (Test-Path -LiteralPath $isolatedRuntime -PathType Container)) {
    throw "YoloCut smoke did not isolate runtime data under $isolatedRuntime"
  }
  if (-not (Test-Path -LiteralPath $isolatedMachineState -PathType Container)) {
    throw "YoloCut smoke did not isolate MCP machine state under $isolatedMachineState"
  }

  $summary = [pscustomobject]@{
    installer = $installerPath
    installedExe = $installedExe
    productName = $versionInfo.ProductName
    fileVersion = $versionInfo.FileVersion
    packageName = $packagedJson.name
    smokeExitCode = $smoke.ExitCode
    isolatedRuntime = $true
    isolatedMachineState = $true
    updateFeed = $updateFeedStatus
  }
} finally {
  $cleanupError = $null
  if ($installed) {
    try {
      $uninstallers = @(Get-ChildItem -LiteralPath $installDir -Filter 'Uninstall*.exe' -File)
      if ($uninstallers.Count -ne 1) {
        throw "Expected one YoloCut uninstaller, found $($uninstallers.Count)"
      }
      $uninstall = Start-Process -FilePath $uninstallers[0].FullName `
        -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
      if ($uninstall.ExitCode -ne 0) {
        throw "YoloCut uninstaller exited with $($uninstall.ExitCode)"
      }
    } catch {
      $cleanupError = $_.Exception.Message
    }
  }
  $resolvedCleanup = [IO.Path]::GetFullPath($smokeRoot)
  if ($resolvedCleanup.StartsWith("$tempBase\", [StringComparison]::OrdinalIgnoreCase) `
      -and [IO.Path]::GetFileName($resolvedCleanup) -like 'yolocut-installer-smoke-*') {
    Remove-Item -LiteralPath $resolvedCleanup -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    throw "Refusing unsafe YoloCut smoke cleanup: $resolvedCleanup"
  }
  if (Test-Path -LiteralPath $resolvedCleanup) {
    $cleanupError = "Failed to clean YoloCut smoke root $resolvedCleanup"
  }
  if ($cleanupError) { throw $cleanupError }
}

$summary | ConvertTo-Json -Depth 3
