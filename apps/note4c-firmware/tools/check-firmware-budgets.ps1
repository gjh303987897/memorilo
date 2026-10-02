[CmdletBinding()]
param(
    [ValidateSet('foundation', 'provisioning', 'connected-content', 'audio-update')]
    [string]$Stage = 'provisioning',

    [string]$DiagnosticsLog,

    [switch]$AcknowledgeMissingRuntimeMeasurements,

    [switch]$AcknowledgeExternalPowerReview,

    [string]$TargetDir = (Join-Path ([System.IO.Path]::GetPathRoot([System.IO.Path]::GetTempPath())) 'tmp\mf')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$budgets = @{
    'foundation' = @{
        ApplicationBytes = 600KB
        ElfBytes = 1536KB
        MinimumInternalBytes = 280KB
        MinimumPsramBytes = 7936KB
        MinimumStackBytes = 1536
        MaximumRefreshMilliseconds = 27000
    }
    'provisioning' = @{
        ApplicationBytes = 1280KB
        ElfBytes = 2304KB
        MinimumInternalBytes = 220KB
        MinimumPsramBytes = 7168KB
        MinimumStackBytes = 1536
        MaximumRefreshMilliseconds = 27000
    }
    'connected-content' = @{
        ApplicationBytes = 2304KB
        ElfBytes = 4096KB
        MinimumInternalBytes = 160KB
        MinimumPsramBytes = 6144KB
        MinimumStackBytes = 1536
        MaximumRefreshMilliseconds = 27000
    }
    'audio-update' = @{
        ApplicationBytes = 3072KB
        ElfBytes = 6144KB
        MinimumInternalBytes = 128KB
        MinimumPsramBytes = 4096KB
        MinimumStackBytes = 1536
        MaximumRefreshMilliseconds = 27000
    }
}

$targetFullPath = [System.IO.Path]::GetFullPath($TargetDir)
$profileDir = Join-Path $targetFullPath 'xtensa-esp32s3-espidf\release'
$applicationPath = Join-Path $profileDir 'memorilo-device-firmware.bin'
$elfPath = Join-Path $profileDir 'memorilo-device-firmware'
$partitionTablePath = Join-Path $profileDir 'partition-table.bin'
$budget = $budgets[$Stage]
$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $toolsDir 'firmware-partition.ps1')

foreach ($artifact in @($applicationPath, $elfPath, $partitionTablePath)) {
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
        throw "Required release artifact is missing: $artifact"
    }
}

$application = Get-Item -LiteralPath $applicationPath
$elf = Get-Item -LiteralPath $elfPath
$applicationBytes = $application.Length
$elfBytes = $elf.Length
$applicationPartition = Get-EspFlashApplicationPartition -PartitionTablePath $partitionTablePath
$failures = [System.Collections.Generic.List[string]]::new()

if ($application.LastWriteTimeUtc -lt $elf.LastWriteTimeUtc) {
    $failures.Add('application image predates the release ELF; regenerate it with the canonical flash preparation path')
}

if ($applicationBytes -gt $budget.ApplicationBytes) {
    $failures.Add("application image $applicationBytes exceeds $($budget.ApplicationBytes) bytes")
}
if ($elfBytes -gt $budget.ElfBytes) {
    $failures.Add("ELF $elfBytes exceeds $($budget.ElfBytes) bytes")
}
if ($applicationBytes -gt $applicationPartition.Size) {
    $failures.Add("application image $applicationBytes exceeds partition '$($applicationPartition.Label)' capacity $($applicationPartition.Size) bytes")
}

$runtime = $null
$refreshDuration = $null
if ($DiagnosticsLog) {
    $logPath = [System.IO.Path]::GetFullPath($DiagnosticsLog)
    if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
        throw "Diagnostics log is missing: $logPath"
    }
    $content = Get-Content -Raw -LiteralPath $logPath
    $snapshotMatches = [regex]::Matches(
        $content,
        'DIAG snapshot event=ui_loop_ready[^\r\n]*min_free_internal_bytes=(?<internal>\d+)[^\r\n]*min_free_psram_bytes=(?<psram>\d+)[^\r\n]*stack_high_water_bytes=(?<stack>\d+)'
    )
    if ($snapshotMatches.Count -gt 0) {
        $match = $snapshotMatches[$snapshotMatches.Count - 1]
        $runtime = @{
            MinimumInternalBytes = [long]$match.Groups['internal'].Value
            MinimumPsramBytes = [long]$match.Groups['psram'].Value
            StackBytes = [long]$match.Groups['stack'].Value
        }
    }
    $refreshMatches = [regex]::Matches($content, 'DIAG refresh_end[^\r\n]*duration_ms=(?<duration>\d+)')
    if ($refreshMatches.Count -gt 0) {
        $refreshDuration = [long]$refreshMatches[$refreshMatches.Count - 1].Groups['duration'].Value
    }
}

if ($null -eq $runtime -or $null -eq $refreshDuration) {
    if (-not $AcknowledgeMissingRuntimeMeasurements) {
        $failures.Add('runtime DIAG evidence is missing; provide -DiagnosticsLog or explicitly acknowledge review')
    }
} else {
    if ($runtime.MinimumInternalBytes -lt $budget.MinimumInternalBytes) {
        $failures.Add("minimum internal RAM $($runtime.MinimumInternalBytes) is below $($budget.MinimumInternalBytes) bytes")
    }
    if ($runtime.MinimumPsramBytes -lt $budget.MinimumPsramBytes) {
        $failures.Add("minimum PSRAM $($runtime.MinimumPsramBytes) is below $($budget.MinimumPsramBytes) bytes")
    }
    if ($runtime.StackBytes -lt $budget.MinimumStackBytes) {
        $failures.Add("main-task stack margin $($runtime.StackBytes) is below $($budget.MinimumStackBytes) bytes")
    }
    if ($refreshDuration -gt $budget.MaximumRefreshMilliseconds) {
        $failures.Add("refresh duration $refreshDuration exceeds $($budget.MaximumRefreshMilliseconds) ms")
    }
}

if (-not $AcknowledgeExternalPowerReview) {
    $failures.Add('external idle/refresh/post-refresh current review is not acknowledged')
}

[pscustomobject]@{
    Stage = $Stage
    ApplicationBytes = $applicationBytes
    ApplicationBudgetBytes = $budget.ApplicationBytes
    ElfBytes = $elfBytes
    ElfBudgetBytes = $budget.ElfBytes
    ApplicationPartition = $applicationPartition.Label
    ApplicationPartitionBytes = $applicationPartition.Size
    RuntimeEvidence = $null -ne $runtime
    PowerReviewAcknowledged = [bool]$AcknowledgeExternalPowerReview
} | Format-List

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ }
    throw "Firmware acceptance failed with $($failures.Count) issue(s)."
}

Write-Host 'Firmware acceptance budgets passed.' -ForegroundColor Green
