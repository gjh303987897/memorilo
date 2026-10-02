[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^COM\d+$')]
    [string]$Port,

    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([System.IO.Ports.SerialPort]::GetPortNames() -notcontains $Port) {
    throw "Serial port $Port is not present. Connect NOTE4C in download mode and retry."
}

$python = Get-Command python -ErrorAction Stop
& $python.Source -c 'import esptool' 2>$null
if ($LASTEXITCODE -ne 0) {
    throw 'esptool is unavailable. Activate the ESP-IDF environment first.'
}

$projectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $OutputPath) {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutputPath = Join-Path $projectDir "backups\note4c-full-flash-$timestamp.bin"
}

$outputFullPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    [System.IO.Path]::GetFullPath($OutputPath)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $projectDir $OutputPath))
}
$backupRoot = [System.IO.Path]::GetFullPath((Join-Path $projectDir 'backups'))
if (-not $outputFullPath.StartsWith($backupRoot + [System.IO.Path]::DirectorySeparatorChar,
                                   [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Backup output must be inside $backupRoot"
}
if (Test-Path -LiteralPath $outputFullPath) {
    throw "Refusing to overwrite existing backup: $outputFullPath"
}

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Write-Host "Reading the complete 16 MiB flash from $Port..."
& $python.Source -m esptool --chip esp32s3 --port $Port --baud 460800 read_flash 0x0 0x1000000 $outputFullPath
if ($LASTEXITCODE -ne 0) {
    throw "Flash backup failed with exit code $LASTEXITCODE"
}

$backup = Get-Item -LiteralPath $outputFullPath
if ($backup.Length -ne 0x1000000) {
    throw "Unexpected backup size: $($backup.Length) bytes"
}

$hash = Get-FileHash -LiteralPath $outputFullPath -Algorithm SHA256
Write-Host "Backup complete: $outputFullPath"
Write-Host "Size: $($backup.Length) bytes"
Write-Host "SHA256: $($hash.Hash)"
