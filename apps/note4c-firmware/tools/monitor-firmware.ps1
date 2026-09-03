[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^COM\d+$')]
    [string]$Port,

    [string]$TargetDir = (Join-Path ([System.IO.Path]::GetTempPath()) 'memorilo-firmware-target')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$monitorVersion = '1.9.0'
$projectDir = Split-Path -Parent $PSScriptRoot
$targetFullPath = if ([System.IO.Path]::IsPathRooted($TargetDir)) {
    [System.IO.Path]::GetFullPath($TargetDir)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $projectDir $TargetDir))
}
$elfPath = Join-Path $targetFullPath 'xtensa-esp32s3-espidf\release\memorilo-device-firmware'

if ([System.IO.Ports.SerialPort]::GetPortNames() -notcontains $Port) {
    throw "Serial port $Port is not present. Reconnect the target and retry."
}
if (-not (Test-Path -LiteralPath $elfPath -PathType Leaf)) {
    throw "Firmware ELF is missing: $elfPath"
}

$uvx = Get-Command uvx -ErrorAction Stop
if (-not $PSCmdlet.ShouldProcess($Port, 'Open ESP-IDF monitor without resetting the target')) {
    return
}

& $uvx.Source `
    --from "esp-idf-monitor==$monitorVersion" `
    idf-monitor.exe `
    --port $Port `
    --baud 115200 `
    --no-reset `
    --target esp32s3 `
    $elfPath
if ($LASTEXITCODE -ne 0) {
    throw "ESP-IDF monitor exited with code $LASTEXITCODE"
}
