[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRepository,

  [Parameter(Mandatory = $true)]
  [string]$BuildDirectory,

  [string]$Destination,

  [switch]$AcceptResearchLicense
)

$ErrorActionPreference = 'Stop'
$expectedRevision = '2c33261938da1a41d713768b1b391b4d368d7d2c'
$acceptanceId = 'fish-audio-research-license-2026-03-07'

if (-not $AcceptResearchLicense) {
  throw 'Pass -AcceptResearchLicense only after reading the Fish Audio Research License. Commercial use requires a separate written license.'
}

$sourceRoot = (Resolve-Path -LiteralPath $SourceRepository).Path
$buildRoot = (Resolve-Path -LiteralPath $BuildDirectory).Path
$revision = (& git -C $sourceRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $revision -ne $expectedRevision) {
  throw "s2.cpp source must be pinned to $expectedRevision"
}

if (-not $Destination) {
  $Destination = Join-Path $env:USERPROFILE ".yolocut\runtimes\s2.cpp\$expectedRevision\win32-x64"
}
$destinationParent = Split-Path -Parent $Destination
New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
$resolvedParent = (Resolve-Path -LiteralPath $destinationParent).Path
$resolvedDestination = [IO.Path]::GetFullPath($Destination)
if (-not $resolvedDestination.StartsWith($resolvedParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Runtime destination must remain inside its resolved parent directory.'
}
if (Test-Path -LiteralPath $resolvedDestination) {
  throw "Destination already exists: $resolvedDestination"
}

$inputs = @(
  @{ Name = 's2.exe'; Source = (Join-Path $buildRoot 's2.exe') },
  @{ Name = 'ggml.dll'; Source = (Join-Path $buildRoot 'bin\ggml.dll') },
  @{ Name = 'ggml-base.dll'; Source = (Join-Path $buildRoot 'bin\ggml-base.dll') },
  @{ Name = 'ggml-cpu.dll'; Source = (Join-Path $buildRoot 'bin\ggml-cpu.dll') },
  @{ Name = 'ggml-cuda.dll'; Source = (Join-Path $buildRoot 'bin\ggml-cuda.dll') },
  @{ Name = 'LICENSE.md'; Source = (Join-Path $sourceRoot 'LICENSE.md') }
)
foreach ($input in $inputs) {
  if (-not (Test-Path -LiteralPath $input.Source -PathType Leaf)) {
    throw "Missing runtime artifact: $($input.Source)"
  }
}

$stage = "$resolvedDestination.staging-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($input in $inputs) {
  Copy-Item -LiteralPath $input.Source -Destination (Join-Path $stage $input.Name)
}

$files = foreach ($input in $inputs) {
  $path = Join-Path $stage $input.Name
  $item = Get-Item -LiteralPath $path
  $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $path
  [ordered]@{
    path = $input.Name
    sizeBytes = $item.Length
    sha256 = $hash.Hash.ToLowerInvariant()
  }
}
$manifest = [ordered]@{
  format = 'yolocut-fish-s2-runtime@1'
  sourceRevision = $expectedRevision
  licenseAcceptanceId = $acceptanceId
  platform = 'win32'
  arch = 'x64'
  executable = 's2.exe'
  files = @($files)
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stage 'runtime-manifest.json') -Encoding utf8

$priorPath = $env:PATH
try {
  $env:PATH = "$stage;$priorPath"
  & (Join-Path $stage 's2.exe') --help | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Staged s2.exe self-check failed.' }
} finally {
  $env:PATH = $priorPath
}

Move-Item -LiteralPath $stage -Destination $resolvedDestination
Write-Output $resolvedDestination
