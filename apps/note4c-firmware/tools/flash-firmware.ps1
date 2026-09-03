[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^COM\d+$')]
    [string]$Port,

    [ValidateSet('real', 'color-test', 'fake')]
    [string]$Variant = 'real',

    [string]$TargetDir = (Join-Path ([System.IO.Path]::GetTempPath()) 'memorilo-firmware-target'),

    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$esptoolVersion = '5.4.0'
$targetTriple = 'xtensa-esp32s3-espidf'
$artifactName = 'memorilo-device-firmware'
$projectDir = Split-Path -Parent $PSScriptRoot
$targetFullPath = if ([System.IO.Path]::IsPathRooted($TargetDir)) {
    [System.IO.Path]::GetFullPath($TargetDir)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $projectDir $TargetDir))
}

if ([System.IO.Ports.SerialPort]::GetPortNames() -notcontains $Port) {
    throw "Serial port $Port is not present. Reconnect the target and retry."
}

$uvx = Get-Command uvx -ErrorAction Stop

if (-not $SkipBuild) {
    $espExport = Join-Path $env:USERPROFILE 'export-esp.ps1'
    if (-not (Test-Path -LiteralPath $espExport)) {
        throw "Rust ESP environment script is missing: $espExport"
    }

    . $espExport
    $cargo = Get-Command cargo -ErrorAction Stop
    $cargoArgs = @('build', '--target-dir', $targetFullPath, '--release')
    switch ($Variant) {
        'real' {
            $cargoArgs += @('--no-default-features', '--features', 'real-display')
        }
        'color-test' {
            $cargoArgs += @('--no-default-features', '--features', 'real-display,color-test')
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

Write-Host "Prepared $Variant firmware under $profileDir"
if (-not $PSCmdlet.ShouldProcess($Port, 'Flash bootloader, partition table, and application')) {
    return
}

# Keep the serial interaction to one official esptool session. Repeated probes
# and an immediately attached monitor can wedge Windows usbser on native USB.
& $uvx.Source @esptool `
    --chip esp32s3 `
    --port $Port `
    --baud 460800 `
    --before usb-reset `
    --after hard-reset `
    write-flash `
    --flash-mode dio `
    --flash-freq 80m `
    --flash-size 16MB `
    0x0 $bootloaderPath `
    0x8000 $partitionTablePath `
    0x10000 $applicationPath
if ($LASTEXITCODE -ne 0) {
    throw "Firmware flash failed with exit code $LASTEXITCODE. Reconnect the target and rerun the complete flash command; do not continue with partial writes."
}

Write-Host 'Firmware flash and verification completed. Start the monitor separately only if diagnostics are needed.'
