# Shared implementation for start.bat and stop.bat; compatible with Windows PowerShell 5.1.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Start', 'Stop')]
    [string]$Action,
    [ValidateRange(1024, 65535)]
    [int]$Port = 8000,
    [switch]$NoBrowser,
    [switch]$Cpu
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $repository 'data\launcher'
$statePath = Join-Path $runtime 'app.json'
$pythonPath = Join-Path $repository '.venv\Scripts\python.exe'
$runScript = Join-Path $PSScriptRoot 'run.py'
$stdoutPath = Join-Path $runtime 'server.stdout.log'
$stderrPath = Join-Path $runtime 'server.stderr.log'
$operationLock = $null

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments, [string]$Failure)
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Program @Arguments | Out-Host
        $commandExitCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousPreference }
    if ($commandExitCode -ne 0) { throw "$Failure (exit code $commandExitCode). Fix the error above and run start.bat again." }
}

function Test-Command {
    param([string]$Program, [string[]]$Arguments)
    # Expected probe failures must not become terminating native-stderr errors in PowerShell 5.1.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Program @Arguments 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    }
    finally { $ErrorActionPreference = $previousPreference }
}

function Get-InputHash {
    param([System.IO.FileInfo[]]$Files)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $description = ($Files | Sort-Object FullName | ForEach-Object {
            $stream = [IO.File]::OpenRead($_.FullName)
            try { $fileHash = [BitConverter]::ToString($sha.ComputeHash($stream)) }
            finally { $stream.Dispose() }
            $_.FullName.Substring($repository.Length) + ':' + $fileHash
        }) -join "`n"
        return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($description)))
    }
    finally { $sha.Dispose() }
}

function Get-OwnedProcess {
    param($State)
    # PID alone is unsafe after a reboot or PID reuse. Require creation time and our unique command arguments.
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($State.pid)" -ErrorAction Stop
    if (-not $process) { return $null }
    if ($process.CreationDate.ToUniversalTime().Ticks.ToString() -ne $State.createdTicks) { return $null }
    $command = [string]$process.CommandLine
    $expectedStop = Join-Path $runtime ($State.instance + '.stop')
    if ($command.IndexOf($runScript, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $command.IndexOf($expectedStop, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $null }
    return $process
}

function Read-AppState {
    if (-not (Test-Path -LiteralPath $statePath)) { return $null }
    try {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        $instance = [Guid]::Parse($state.instance)
        if ($instance.ToString() -ne $state.instance -or [int]$state.pid -le 0 -or
            [int]$state.port -lt 1024 -or [int]$state.port -gt 65535 -or
            [string]$state.createdTicks -notmatch '^\d+$') { throw 'Invalid state values.' }
        return $state
    }
    catch {
        throw "Launcher state is invalid: $statePath. No process was stopped. Close any manually started app, remove this state file, and try again."
    }
}

function Test-Healthy {
    param([int]$AppPort)
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$AppPort/api/health" -TimeoutSec 2
        return $health.status -eq 'ok'
    }
    catch { return $false }
}

function Open-App {
    param([int]$AppPort)
    $url = "http://localhost:$AppPort/"
    Write-Host "App ready: $url" -ForegroundColor Green
    Write-Host 'Use stop.bat to stop the app. Your images and settings are kept.'
    if (-not $NoBrowser) {
        try { Start-Process $url }
        catch { Write-Warning "Could not open the browser. Open $url yourself." }
    }
}

function Wait-Ready {
    param($State)
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not (Get-OwnedProcess $State)) {
            if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Tail 20 | Out-Host }
            throw "The server exited before it was ready. See $stderrPath"
        }
        if (Test-Healthy $State.port) { return }
        Start-Sleep -Milliseconds 400
    }
    throw "Startup is taking longer than expected. Check $stderrPath, then rerun start.bat or stop.bat."
}

function Stop-App {
    $state = Read-AppState
    if (-not $state) {
        Write-Host 'The app is already stopped (no instance managed by these scripts).'
        return
    }
    if (-not (Get-OwnedProcess $state)) {
        Remove-Item -LiteralPath $statePath
        Write-Host 'The app is already stopped. Removed its stale launcher record.'
        return
    }
    Write-Host 'Stopping Visual Object Retrieval...'
    $stopPath = Join-Path $runtime ($state.instance + '.stop')
    [IO.File]::WriteAllText($stopPath, 'stop')
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while (Get-OwnedProcess $state) {
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "The app is still shutting down. Check $stderrPath and run stop.bat again."
        }
        Start-Sleep -Milliseconds 300
    }
    Remove-Item -LiteralPath $statePath
    Remove-Item -LiteralPath $stopPath -ErrorAction SilentlyContinue
    Write-Host 'App stopped. Your collection and settings are kept.' -ForegroundColor Green
}

function Find-Python {
    # Prefer stable interpreters supported by the pinned PyTorch wheels; ignore Windows Store aliases.
    $probe = "import sys, struct; raise SystemExit(0 if (3,11) <= sys.version_info[:2] <= (3,14) and struct.calcsize('P') == 8 else 1)"
    if (Get-Command py.exe -ErrorAction SilentlyContinue) {
        foreach ($version in @('-3.12', '-3.13', '-3.11', '-3.14')) {
            if (Test-Command 'py.exe' @($version, '-c', $probe)) {
                Invoke-Checked 'py.exe' @($version, '-m', 'venv', (Join-Path $repository '.venv')) 'Could not create the Python environment'
                return
            }
        }
    }
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($python -and $python.Source -notlike '*\WindowsApps\*') {
        if (Test-Command $python.Source @('-c', $probe)) {
            Invoke-Checked $python.Source @('-m', 'venv', (Join-Path $repository '.venv')) 'Could not create the Python environment'
            return
        }
    }
    throw 'Install 64-bit Python 3.11-3.14 from https://www.python.org/downloads/windows/ (include the Python launcher and Add Python to PATH), then run start.bat again.'
}

function Prepare-Python {
    if (-not (Test-Path -LiteralPath $pythonPath)) {
        Write-Host 'Creating the Python environment...'
        Find-Python
    }
    $versionProbe = "import sys, struct; raise SystemExit(0 if (3,11) <= sys.version_info[:2] <= (3,14) and struct.calcsize('P') == 8 else 1)"
    if (-not (Test-Command $pythonPath @('-c', $versionProbe))) {
        throw 'The .venv environment is unavailable or unsupported. Rename .venv, install Python 3.11-3.14, and rerun start.bat. Your data folder can stay in place.'
    }
    $requirements = Join-Path $repository 'backend\requirements.txt'
    $hash = Get-InputHash @((Get-Item -LiteralPath $requirements), (Get-Item -LiteralPath (Join-Path $repository '.venv\pyvenv.cfg')))
    $stamp = Join-Path $runtime 'python.sha256'
    $probe = "import importlib.metadata as m; [m.version(n) for n in ('fastapi', 'uvicorn', 'python-multipart', 'sqlalchemy', 'pydantic', 'pydantic-settings', 'ultralytics', 'torch', 'torchvision', 'opencv-python', 'Pillow', 'numpy')]"
    $complete = Test-Command $pythonPath @('-c', $probe)
    if ($complete -and (Test-Path -LiteralPath $stamp) -and (Get-Content -LiteralPath $stamp -Raw).Trim() -eq $hash) {
        Write-Host 'Python dependencies are ready.'
        return
    }
    Write-Host 'Preparing Python dependencies (the first setup can take several minutes)...'
    Invoke-Checked $pythonPath @('-m', 'pip', 'install', '--upgrade', 'pip') 'Could not prepare pip'
    if (-not (Test-Command $pythonPath @('-c', 'import torch, torchvision'))) {
        $wheel = 'cpu'
        if (-not $Cpu -and (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue)) {
            if (Test-Command 'nvidia-smi.exe' @('--query-gpu=name', '--format=csv,noheader')) { $wheel = 'cu128' }
        }
        Write-Host "Installing PyTorch 2.11 / torchvision 0.26 ($wheel)..."
        Invoke-Checked $pythonPath @('-m', 'pip', 'install', 'torch==2.11.0', 'torchvision==0.26.0', '--index-url', "https://download.pytorch.org/whl/$wheel") 'Could not install PyTorch; check internet access and your Python version'
    }
    else { Write-Host 'Keeping the existing PyTorch installation.' }
    Invoke-Checked $pythonPath @('-m', 'pip', 'install', '-r', $requirements) 'Could not install the backend dependencies'
    Invoke-Checked $pythonPath @('-m', 'pip', 'check') 'Python dependencies are inconsistent'
    Invoke-Checked $pythonPath @('-c', 'import fastapi, uvicorn, ultralytics, torch, torchvision') 'The Python dependencies could not load'
    [IO.File]::WriteAllText($stamp, $hash)
}

function Prepare-Frontend {
    $frontend = Join-Path $repository 'frontend'
    $files = @(Get-ChildItem -LiteralPath (Join-Path $frontend 'src') -File -Recurse)
    $files += @(Get-ChildItem -LiteralPath (Join-Path $frontend 'public') -File -Recurse -ErrorAction SilentlyContinue)
    $files += @(Get-ChildItem -LiteralPath $frontend -File | Where-Object { $_.Name -notlike '*.tsbuildinfo' })
    $hash = Get-InputHash $files
    $stamp = Join-Path $runtime 'frontend.sha256'
    $index = Join-Path $frontend 'dist\index.html'
    if ((Test-Path -LiteralPath $index) -and (Test-Path -LiteralPath $stamp) -and (Get-Content -LiteralPath $stamp -Raw).Trim() -eq $hash) {
        Write-Host 'The interface is ready.'
        return
    }
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $node -or -not $npm) {
        throw 'Install Node.js 24 LTS from https://nodejs.org/ (include npm and Add to PATH), reopen your terminal, and run start.bat again.'
    }
    if (-not (Test-Command $node.Source @('-e', "const [a,b]=process.versions.node.split('.').map(Number); process.exit((a===22 && b>=12) || a>=24 ? 0 : 1)"))) {
        throw 'Node.js is too old. Install Node.js 24 LTS from https://nodejs.org/ and rerun start.bat.'
    }
    Push-Location -LiteralPath $frontend
    try {
        Write-Host 'Installing and building the interface...'
        Invoke-Checked $npm.Source @('ci', '--no-audit', '--no-fund') 'Could not install the interface dependencies'
        Invoke-Checked $npm.Source @('run', 'build') 'Could not build the interface'
    }
    finally { Pop-Location }
    [IO.File]::WriteAllText($stamp, $hash)
}

try {
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    try {
        $operationLock = [IO.File]::Open((Join-Path $runtime 'operation.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    }
    catch { throw 'Another start or stop operation is in progress. Let it finish, then try again.' }
    if ($Action -eq 'Stop') { Stop-App; exit 0 }

    Write-Host 'Visual Object Retrieval' -ForegroundColor Cyan
    $state = Read-AppState
    if ($state -and (Get-OwnedProcess $state)) {
        if ($state.port -ne $Port) { throw "The app is already running on port $($state.port). Use stop.bat first, or start.bat -Port $($state.port)." }
        if ($Cpu) { Write-Host 'To change to CPU mode, run stop.bat first, then start.bat -Cpu.' }
        Write-Host 'The app is already running; reusing it.'
        Wait-Ready $state
        Open-App $state.port
        exit 0
    }
    if ($state) { Remove-Item -LiteralPath $statePath }
    # Check availability before any installation. Never stop an unrelated process to free the port.
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    $listener.ExclusiveAddressUse = $true
    try { $listener.Start() }
    catch { throw "Port $Port is in use. Close the manually started app with Ctrl+C, or use start.bat -Port 8002." }
    finally { $listener.Stop() }

    Push-Location -LiteralPath $repository
    try {
        Prepare-Python
        Prepare-Frontend
        $envPath = Join-Path $repository '.env'
        if (-not (Test-Path -LiteralPath $envPath)) {
            Copy-Item -LiteralPath (Join-Path $repository '.env.example') -Destination $envPath
        }
        if ($Cpu) { $env:VOR_DEVICE = 'cpu' }
        $instance = [Guid]::NewGuid().ToString()
        $stopPath = Join-Path $runtime ($instance + '.stop')
        $serverArguments = @(('"' + $runScript + '"'), '--port', $Port.ToString(), '--shutdown-file', ('"' + $stopPath + '"'), '--log-dir', ('"' + $runtime + '"'))
        Write-Host 'Starting the app...'
        [IO.File]::WriteAllText($stdoutPath, '')
        [IO.File]::WriteAllText($stderrPath, '')
        # Keep ShellExecute enabled: redirecting here makes descendants retain captured caller pipes.
        # run.py writes its own logs so the launcher can exit while the server remains running.
        $serverProcess = Start-Process -FilePath $pythonPath -ArgumentList $serverArguments -WorkingDirectory $repository -WindowStyle Hidden -PassThru
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($serverProcess.Id)"
        if (-not $processInfo) { throw "The server could not start. See $stderrPath" }
        $state = [pscustomobject]@{
            pid = $serverProcess.Id
            createdTicks = $processInfo.CreationDate.ToUniversalTime().Ticks.ToString()
            instance = $instance
            port = $Port
        }
        $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
        Wait-Ready $state
        Open-App $Port
    }
    finally { Pop-Location }
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    if ($operationLock) { $operationLock.Dispose() }
}
