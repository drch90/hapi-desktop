param(
    [string]$InstallDir,
    [switch]$Restore
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-RegularPath([string]$Path, [bool]$Directory = $false) {
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Linked paths are not supported: $Path"
    }
    if ($item.PSIsContainer -ne $Directory) { throw "Unexpected path type: $Path" }
}

function Get-Digest([string]$Path) {
    Assert-RegularPath $Path
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Find-InstallDirectory {
    $candidates = @()
    if ($env:LOCALAPPDATA) {
        $candidates += Join-Path $env:LOCALAPPDATA 'Programs\HAPI Desktop'
        $candidates += Join-Path $env:LOCALAPPDATA 'Programs\hapi-desktop'
    }
    foreach ($key in @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )) {
        foreach ($entry in @(Get-ItemProperty -Path $key -ErrorAction SilentlyContinue)) {
            if ($entry.PSObject.Properties['DisplayName'] -and $entry.DisplayName -eq 'HAPI Desktop' -and
                $entry.PSObject.Properties['InstallLocation'] -and $entry.InstallLocation) {
                $candidates += $entry.InstallLocation
            }
        }
    }
    $found = @($candidates | Sort-Object -Unique | Where-Object {
        Test-Path -LiteralPath (Join-Path $_ 'HAPI Desktop.exe') -PathType Leaf
    })
    if ($found.Count -eq 1) { return $found[0] }
    # A file picker handles custom locations without guessing between installs.
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    try {
        $picker.Title = 'Select the installed HAPI Desktop.exe'
        $picker.Filter = 'HAPI Desktop|HAPI Desktop.exe'
        if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
            throw 'No installation selected. No files were changed.'
        }
        return Split-Path -Parent $picker.FileName
    } finally { $picker.Dispose() }
}

try {
    $manifestPath = Join-Path $PSScriptRoot 'manifest.json'
    Assert-RegularPath $manifestPath
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.format -ne 1 -or $manifest.product -ne 'HAPI Desktop' -or $manifest.platform -ne 'win32-x64') {
        throw 'Unknown update package.'
    }
    foreach ($version in @($manifest.fromVersion, $manifest.version)) {
        if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\z') { throw 'Invalid package version.' }
    }
    foreach ($hash in @($manifest.baseAsarSha256, $manifest.targetAsarSha256) + @($manifest.allowedExecutableSha256)) {
        if ($hash -notmatch '^[a-f0-9]{64}\z') { throw 'Invalid package checksum.' }
    }
    if (@($manifest.allowedExecutableSha256).Count -eq 0) { throw 'No compatible executable in package.' }
    if (!$InstallDir) { $InstallDir = Find-InstallDirectory }
    $InstallDir = [IO.Path]::GetFullPath($InstallDir)
    Assert-RegularPath $InstallDir $true
    $resources = Join-Path $InstallDir 'resources'
    Assert-RegularPath $resources $true
    $executable = Join-Path $InstallDir 'HAPI Desktop.exe'
    if (@($manifest.allowedExecutableSha256) -notcontains (Get-Digest $executable)) {
        throw 'This installation uses a different executable. Use the full installer.'
    }
    if (@(Get-Process -Name 'HAPI Desktop' -ErrorAction SilentlyContinue).Count -gt 0) {
        throw 'Exit HAPI Desktop from its system tray before updating. No process was stopped.'
    }
    $installed = Join-Path $resources 'app.asar'
    $backup = Join-Path $resources ("app.asar.backup-" + $manifest.fromVersion + '-' + $manifest.baseAsarSha256.Substring(0, 12))
    $currentHash = Get-Digest $installed
    $expectedCurrent = $manifest.baseAsarSha256
    $expectedNew = $manifest.targetAsarSha256
    $source = Join-Path $PSScriptRoot 'resources\app.asar'
    if ($Restore) {
        $expectedCurrent = $manifest.targetAsarSha256
        $expectedNew = $manifest.baseAsarSha256
        $source = $backup
    }
    if ($currentHash -eq $expectedNew) {
        Write-Host 'The requested version is already installed. No files were changed.'
        exit 0
    }
    if ($currentHash -ne $expectedCurrent) {
        throw 'The installed application does not match this package base. Use the full installer.'
    }
    if ((Get-Digest $source) -ne $expectedNew) { throw 'Update or backup checksum mismatch.' }
    if (!$Restore) {
        if (Test-Path -LiteralPath $backup) {
            if ((Get-Digest $backup) -ne $expectedCurrent) { throw 'Existing backup differs. It was preserved.' }
        } else {
            [IO.File]::Copy($installed, $backup, $false)
            if ((Get-Digest $backup) -ne $expectedCurrent) { throw 'Backup checksum mismatch.' }
        }
    }
    # Stage and verify on the same volume; File.Replace keeps the old app intact
    # if access is denied or the running app still holds a lock.
    $temporary = Join-Path $resources ('.hapi-update-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $replaced = $temporary + '.previous'
    $committed = $false
    try {
        [IO.File]::Copy($source, $temporary, $false)
        if ((Get-Digest $temporary) -ne $expectedNew) { throw 'Staged update checksum mismatch.' }
        if ((Get-Digest $installed) -ne $expectedCurrent) { throw 'Installed files changed during update.' }
        [IO.File]::Replace($temporary, $installed, $replaced)
        if ((Get-Digest $installed) -ne $expectedNew) { throw 'Installed checksum mismatch. Restoring the previous application.' }
        $committed = $true
    } catch {
        if ((Test-Path -LiteralPath $replaced) -and (Get-Digest $replaced) -eq $expectedCurrent) {
            [IO.File]::Replace($replaced, $installed, ($temporary + '.failed'))
        }
        throw
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
        if ($committed -and (Test-Path -LiteralPath $replaced)) { Remove-Item -LiteralPath $replaced -Force }
    }
    Write-Host ('Completed. You can now start HAPI Desktop. ' + $(if ($Restore) { 'Backup restored.' } else { 'Version ' + $manifest.version }))
} catch {
    Write-Error -ErrorRecord $_ -ErrorAction Continue
    Write-Host 'If access was denied, run update.cmd or restore.cmd as administrator.'
    exit 1
}
