[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^COM\d+$')]
    [string]$Port,

    [ValidateSet('hardware', 'color-test', 'coordinator-test', 'fake')]
    [string]$Variant = 'hardware',

    [ValidateSet(115200, 230400, 460800)]
    [int]$Baud = 460800,

    [string]$TargetDir = (Join-Path ([System.IO.Path]::GetPathRoot([System.IO.Path]::GetTempPath())) 'tmp\mf'),

    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$esptoolVersion = '5.4.0'
$targetTriple = 'xtensa-esp32s3-espidf'
$artifactName = 'memorilo-device-firmware'
$projectDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'firmware-partition.ps1')
$partitionCsvPath = Join-Path $projectDir 'partitions.csv'
$targetFullPath = if ([System.IO.Path]::IsPathRooted($TargetDir)) {
    [System.IO.Path]::GetFullPath($TargetDir)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $projectDir $TargetDir))
}

$uvx = Get-Command uvx -ErrorAction Stop
$uv = Get-Command uv -ErrorAction Stop

if (-not $SkipBuild) {
    $espExport = Join-Path $env:USERPROFILE 'export-esp.ps1'
    if (-not (Test-Path -LiteralPath $espExport)) {
        throw "Rust ESP environment script is missing: $espExport"
    }

    . $espExport
    $cargo = Get-Command cargo -ErrorAction Stop
    $cargoArgs = @('build', '--target-dir', $targetFullPath, '--release')
    switch ($Variant) {
        'hardware' {
            $cargoArgs += @('--no-default-features', '--features', 'hardware-display')
        }
        'color-test' {
            $cargoArgs += @('--no-default-features', '--features', 'hardware-display,color-test')
        }
        'coordinator-test' {
            $cargoArgs += @('--no-default-features', '--features', 'hardware-display,coordinator-test')
        }
        'fake' {}
    }

    Push-Location $projectDir
    try {
        & $cargo.Source @cargoArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Firmware build failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

$profileDir = Join-Path $targetFullPath "$targetTriple\release"
$elfPath = Join-Path $profileDir $artifactName
$bootloaderPath = Join-Path $profileDir 'bootloader.bin'
$partitionTablePath = Join-Path $profileDir 'partition-table.bin'
$applicationPath = Join-Path $profileDir "$artifactName.bin"

foreach ($artifact in @($elfPath, $bootloaderPath, $partitionTablePath)) {
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
        throw "Required firmware artifact is missing: $artifact"
    }
}

$partitionGenerator = Join-Path $env:USERPROFILE '.espressif\esp-idf\v5.5.2\components\partition_table\gen_esp32part.py'
foreach ($input in @($partitionCsvPath, $partitionGenerator)) {
    if (-not (Test-Path -LiteralPath $input -PathType Leaf)) {
        throw "Required partition input is missing: $input"
    }
}
& $uv.Source run --no-project python $partitionGenerator $partitionCsvPath $partitionTablePath
if ($LASTEXITCODE -ne 0) {
    throw "Partition table generation failed with exit code $LASTEXITCODE"
}

$esptool = @('--from', "esptool==$esptoolVersion", 'esptool')
& $uvx.Source @esptool --chip esp32s3 elf2image `
    --flash-mode dio `
    --flash-freq 80m `
    --flash-size 16MB `
    --output $applicationPath `
    $elfPath
if ($LASTEXITCODE -ne 0) {
    throw "Application image generation failed with exit code $LASTEXITCODE"
}

& $uvx.Source @esptool image-info $applicationPath
if ($LASTEXITCODE -ne 0) {
    throw "Application image validation failed with exit code $LASTEXITCODE"
}

$applicationPartition = Assert-EspApplicationFits `
    -PartitionTablePath $partitionTablePath `
    -ApplicationPath $applicationPath
$applicationOffset = '0x{0:X}' -f $applicationPartition.Offset

Write-Host "Prepared $Variant firmware for partition '$($applicationPartition.Label)' at $applicationOffset ($($applicationPartition.Size) bytes) under $profileDir"
if (-not $PSCmdlet.ShouldProcess($Port, 'Flash bootloader, partition table, and application')) {
    return
}

if ([System.IO.Ports.SerialPort]::GetPortNames() -notcontains $Port) {
    throw "Serial port $Port is not present. Reconnect the target and retry."
}

# Keep the serial interaction to one official esptool session. ESP32-S3
# `hard-reset` clears the USB force-download state before resetting the chip;
# a watchdog or soft reset can leave a successfully written device in the ROM
# loader instead of booting the application.
& $uvx.Source @esptool `
    --chip esp32s3 `
    --port $Port `
    --baud $Baud `
    --before usb-reset `
    --after hard-reset `
    write-flash `
    --flash-mode dio `
    --flash-freq 80m `
    --flash-size 16MB `
    0x0 $bootloaderPath `
    0x8000 $partitionTablePath `
    $applicationOffset $applicationPath
if ($LASTEXITCODE -ne 0) {
    throw "Firmware flash failed with exit code $LASTEXITCODE. Reconnect the target and rerun the complete flash command; do not continue with partial writes."
}

Write-Host 'Firmware flash and verification completed. Start the monitor separately only if diagnostics are needed.'
