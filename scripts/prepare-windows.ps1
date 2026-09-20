$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Monthly archive (upstream retains monthly builds for two years), pinned by SHA-256.
$release = 'autobuild-2026-08-31-13-27'
$archive = 'ffmpeg-n8.1.2-50-g1a748fe2cd-win64-lgpl-shared-8.1.zip'
$sha256 = 'e9712ffbdb03ef71bbab660c75b835bfe698ef6fad0247c76d8d394a39a3db63'
$url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/$release/$archive"
$root = Split-Path $PSScriptRoot -Parent
$destination = Join-Path $root 'src-tauri/vendor/ffmpeg'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    $zip = Join-Path $temporary $archive
    Invoke-WebRequest -Uri $url -OutFile $zip
    if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha256) {
        throw 'FFmpeg checksum mismatch; refusing to package it.'
    }
    Expand-Archive -Path $zip -DestinationPath (Join-Path $temporary 'expanded')
    $package = @(Get-ChildItem (Join-Path $temporary 'expanded') -Directory)
    if ($package.Count -ne 1) { throw 'Unexpected FFmpeg archive layout.' }
    foreach ($tool in @('ffmpeg.exe', 'ffprobe.exe')) {
        if (!(Test-Path (Join-Path $package[0].FullName "bin/$tool"))) {
            throw "Missing decoder: $tool"
        }
    }
    if (!(Get-ChildItem (Join-Path $package[0].FullName 'bin') -Filter '*.dll')) {
        throw 'Missing shared FFmpeg libraries.'
    }
    if (Test-Path $destination) { Remove-Item $destination -Recurse -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
    Copy-Item $package[0].FullName $destination -Recurse
    # Preserve upstream licenses, documentation, libraries and headers together.
    @"
Lori Player distributes unmodified FFmpeg executables and shared libraries.
Distribution: $url
SHA-256: $sha256
Build recipes and dependency source URLs: https://github.com/BtbN/FFmpeg-Builds/tree/$release
FFmpeg source revision: https://github.com/FFmpeg/FFmpeg/commit/1a748fe2cd
FFmpeg license information: https://ffmpeg.org/legal.html
See the upstream license files in this directory and ffmpeg -L / -buildconf.
The shared libraries may be replaced with compatible modified versions.
"@ | Set-Content (Join-Path $destination 'LORI-FFMPEG-NOTICE.txt') -Encoding utf8
    & (Join-Path $destination 'bin/ffmpeg.exe') -version
    if ($LASTEXITCODE -ne 0) { throw 'Bundled FFmpeg failed to start.' }
    & (Join-Path $destination 'bin/ffprobe.exe') -version
    if ($LASTEXITCODE -ne 0) { throw 'Bundled ffprobe failed to start.' }
} finally {
    Remove-Item $temporary -Recurse -Force
}
