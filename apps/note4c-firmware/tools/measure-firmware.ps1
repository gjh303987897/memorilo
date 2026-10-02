[CmdletBinding()]
param(
    [ValidateSet('hardware', 'color-test', 'coordinator-test', 'fake')]
    [string]$Variant = 'hardware',

    [string]$TargetDir = (Join-Path ([System.IO.Path]::GetPathRoot([System.IO.Path]::GetTempPath())) 'tmp\mf')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$targetTriple = 'xtensa-esp32s3-espidf'
$artifactName = 'memorilo-device-firmware'
$projectDir = Split-Path -Parent $PSScriptRoot
$repositoryDir = [System.IO.Path]::GetFullPath((Join-Path $projectDir '..\..'))
$targetFullPath = if ([System.IO.Path]::IsPathRooted($TargetDir)) {
    [System.IO.Path]::GetFullPath($TargetDir)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $projectDir $TargetDir))
}
$profileDir = Join-Path $targetFullPath "$targetTriple\release"
$applicationPath = Join-Path $profileDir "$artifactName.bin"
$elfPath = Join-Path $profileDir $artifactName
$partitionTablePath = Join-Path $profileDir 'partition-table.bin'
. (Join-Path $PSScriptRoot 'firmware-partition.ps1')

foreach ($artifact in @($applicationPath, $elfPath, $partitionTablePath)) {
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
        throw "Required firmware artifact is missing: $artifact"
    }
}

$features = switch ($Variant) {
    'hardware' { 'hardware-display' }
    'color-test' { 'hardware-display,color-test' }
    'coordinator-test' { 'hardware-display,coordinator-test' }
    'fake' { 'fake-display (default)' }
}

$revision = (& git -C $repositoryDir rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to read the firmware revision from git.'
}
$firmwareStatus = & git -C $repositoryDir status --porcelain -- apps/note4c-firmware
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to read the firmware worktree state from git.'
}
$dirty = @($firmwareStatus).Count -gt 0
$application = Get-Item -LiteralPath $applicationPath
$elf = Get-Item -LiteralPath $elfPath
if ($application.LastWriteTimeUtc -lt $elf.LastWriteTimeUtc) {
    throw 'Application image predates the release ELF. Regenerate it with the canonical flash preparation path before measuring.'
}
$applicationPartition = Assert-EspApplicationFits `
    -PartitionTablePath $partitionTablePath `
    -ApplicationPath $applicationPath
$applicationHash = (Get-FileHash -LiteralPath $applicationPath -Algorithm SHA256).Hash.ToLowerInvariant()

[pscustomobject]@{
    Revision = $revision
    FirmwareDirty = $dirty
    Variant = $Variant
    CargoFeatures = $features
    EspIdfVersion = 'v5.5.2'
    Target = $targetTriple
    ApplicationBytes = $application.Length
    ApplicationSha256 = $applicationHash
    ApplicationPartition = $applicationPartition.Label
    ApplicationPartitionBytes = $applicationPartition.Size
    ElfBytes = $elf.Length
    ArtifactDirectory = $profileDir
} | Format-List
