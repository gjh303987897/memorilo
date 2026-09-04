function Get-EspPartitionTableEntries {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    for ($offset = 0; $offset + 32 -le $bytes.Length; $offset += 32) {
        $magic = [BitConverter]::ToUInt16($bytes, $offset)
        if ($magic -ne 0x50AA) {
            break
        }

        $labelBytes = $bytes[($offset + 12)..($offset + 27)]
        $terminator = [Array]::IndexOf($labelBytes, [byte]0)
        if ($terminator -eq 0) {
            $labelBytes = @()
        } elseif ($terminator -gt 0) {
            $labelBytes = $labelBytes[0..($terminator - 1)]
        }

        [pscustomobject]@{
            Label = [Text.Encoding]::ASCII.GetString($labelBytes)
            Type = $bytes[$offset + 2]
            Subtype = $bytes[$offset + 3]
            Offset = [BitConverter]::ToUInt32($bytes, $offset + 4)
            Size = [BitConverter]::ToUInt32($bytes, $offset + 8)
        }
    }
}

function Get-EspFlashApplicationPartition {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$PartitionTablePath
    )

    $partition = Get-EspPartitionTableEntries -Path $PartitionTablePath |
        Where-Object Type -eq 0 |
        Sort-Object Offset |
        Select-Object -First 1
    if ($null -eq $partition) {
        throw "Partition table contains no application partition: $PartitionTablePath"
    }
    $partition
}

function Assert-EspApplicationFits {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$PartitionTablePath,

        [Parameter(Mandatory = $true)]
        [string]$ApplicationPath
    )

    $partition = Get-EspFlashApplicationPartition -PartitionTablePath $PartitionTablePath
    $applicationBytes = (Get-Item -LiteralPath $ApplicationPath).Length
    if ($applicationBytes -gt $partition.Size) {
        throw "Application image $applicationBytes bytes exceeds partition '$($partition.Label)' capacity $($partition.Size) bytes."
    }
    $partition
}
