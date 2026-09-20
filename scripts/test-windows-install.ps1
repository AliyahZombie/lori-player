$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
$bundle = Join-Path $root 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis'
$installers = @(Get-ChildItem $bundle -Filter '*-setup.exe')
if ($installers.Count -ne 1) { throw 'Expected one NSIS installer.' }
$installer = $installers[0]
$hash = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $($installer.Name)" | Set-Content (Join-Path $bundle 'SHA256SUMS.txt') -Encoding ascii
# Exercise spaces and non-ASCII paths without touching any existing application data.
$destination = Join-Path $env:RUNNER_TEMP 'Lori 安装 smoke'
$evidence = Join-Path $root '.qa/windows'
New-Item -ItemType Directory -Force $evidence | Out-Null
$install = Start-Process $installer.FullName -ArgumentList @('/S', "/D=$destination") -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "Installer failed: $($install.ExitCode)" }
$exe = Join-Path $destination 'lori-player.exe'
if (!(Test-Path $exe)) { throw 'Installed application executable missing.' }
foreach ($tool in @('ffmpeg', 'ffprobe')) {
    & (Join-Path $destination "ffmpeg/bin/$tool.exe") -version
    if ($LASTEXITCODE -ne 0) { throw "Installed $tool failed to start." }
}
$application = Start-Process $exe -PassThru
try {
    $deadline = (Get-Date).AddSeconds(45)
    do {
        Start-Sleep -Milliseconds 500
        $application.Refresh()
        if ($application.HasExited) { throw "Application exited: $($application.ExitCode)" }
    } while ($application.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline)
    if ($application.MainWindowHandle -eq 0) { throw 'Main window did not appear.' }
    Start-Sleep -Seconds 3
    $second = Start-Process $exe -PassThru
    if (!$second.WaitForExit(15000)) { throw 'Second instance did not exit.' }
    $application.Refresh()
    if ($application.MainWindowTitle -ne 'Lori Player') {
        throw "Unexpected main window: $($application.MainWindowTitle)"
    }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LoriSmokeWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
}
'@
    [LoriSmokeWindow]::ShowWindow($application.MainWindowHandle, 9) | Out-Null
    [LoriSmokeWindow]::SetWindowPos($application.MainWindowHandle, [IntPtr](-1), 0, 0, 0, 0, 0x43) | Out-Null
    [LoriSmokeWindow]::SetForegroundWindow($application.MainWindowHandle) | Out-Null
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $window = [Windows.Automation.AutomationElement]::FromHandle($application.MainWindowHandle)
    $searchCondition = [Windows.Automation.PropertyCondition]::new(
        [Windows.Automation.AutomationElement]::NameProperty, '搜索音乐')
    $deadline = (Get-Date).AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 500
        $search = $window.FindFirst([Windows.Automation.TreeScope]::Descendants, $searchCondition)
    } while ($null -eq $search -and (Get-Date) -lt $deadline)
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $screen = [Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object Drawing.Bitmap $screen.Width, $screen.Height
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($screen.Location, [Drawing.Point]::Empty, $screen.Size)
        $bitmap.Save((Join-Path $evidence 'installed-player.png'))
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
    if ($null -eq $search) { throw 'WebView did not render the music search control.' }
    "Installed: $exe`nPID: $($application.Id)`nWindow: $($application.MainWindowHandle)`nSHA256: $hash`nSingle instance: passed`nRendered music search: passed" |
        Set-Content (Join-Path $evidence 'smoke.txt')
} finally {
    # CI-only disposable process: the app intentionally hides on window close.
    Get-Process 'lori-player' -ErrorAction SilentlyContinue | Stop-Process -Force
}
