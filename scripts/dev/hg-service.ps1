<#
.SYNOPSIS
    Dev-only helper for registering and controlling the HuanvaeGuard Windows
    Service without running the NSIS installer.

.DESCRIPTION
    In packaged installs, src-tauri/windows/hooks.nsi registers
    huanvaeguard-svc.exe as a Windows Service at post-install time. During
    'pnpm tauri dev' that hook never runs, so port 19198 stays empty and the
    HuanvaeGuard window shows "Service Not Running".

    This script mirrors the NSIS hook for the dev environment:
        sc.exe create HuanvaeGuard binPath= "<repo>\src-tauri\target\<profile>\HuanvaeGuard\huanvaeguard-svc.exe" ...
        sc.exe start HuanvaeGuard

    Actions:
        install     Register and start the service (reinstalls if already present)
        uninstall   Stop and delete the service
        start       Start an already-registered service
        stop        Stop the service
        restart     stop + start
        status      Print service state + port 19198 listener + binary path

    The script auto-elevates to Administrator when needed (install/uninstall/
    start/stop/restart require SCM write access).

.PARAMETER Action
    One of: install, uninstall, start, stop, restart, status.
    Default: status.

.PARAMETER Profile
    Build profile to locate the binary under src-tauri/target/<profile>/.
    Default: debug.

.EXAMPLE
    pnpm hg:install
    pnpm hg:status
    powershell -ExecutionPolicy Bypass -File scripts/dev/hg-service.ps1 -Action install -Profile release

.NOTES
    Service name:   HuanvaeGuard
    Bind port:      127.0.0.1:19198
    Binary:         src-tauri/target/<profile>/HuanvaeGuard/huanvaeguard-svc.exe
    Start mode:     demand (manual) - matches the NSIS hook so behavior stays
                    consistent between dev and packaged installs.
#>

[CmdletBinding()]
param(
    [ValidateSet('install', 'uninstall', 'start', 'stop', 'restart', 'status')]
    [string]$Action = 'status',

    [ValidateSet('debug', 'release')]
    [string]$Profile = 'debug'
)

$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------
$ServiceName = 'HuanvaeGuard'
$DisplayName = 'HuanvaeGuard VPN Service (Dev)'
$Description = 'Dev-only registration for HuanvaeGuard VPN tunnel (mirrors NSIS hook)'
$BindPort    = 19198

# --------------------------------------------------------------------------
# Resolve paths from script location -> repo root
# --------------------------------------------------------------------------
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$binDir   = Join-Path $repoRoot "src-tauri\target\$Profile\HuanvaeGuard"
$binPath  = Join-Path $binDir 'huanvaeguard-svc.exe'
$wintun   = Join-Path $binDir 'wintun.dll'

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Elevated {
    # Re-launch this script as Administrator, forwarding the same args.
    $scriptPath = $MyInvocation.ScriptName
    if (-not $scriptPath) { $scriptPath = $PSCommandPath }
    $argList = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', "`"$scriptPath`"",
        '-Action', $Action,
        '-Profile', $Profile
    )
    Write-Host "[hg-service] elevating to Administrator..." -ForegroundColor Yellow
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -Wait
    exit $LASTEXITCODE
}

function Get-ServiceState {
    # Returns 'NotInstalled' | 'Stopped' | 'Running' | 'StartPending' | ... | raw
    $raw = & sc.exe query $ServiceName 2>&1
    if ($LASTEXITCODE -ne 0) { return 'NotInstalled' }
    $line = ($raw | Select-String 'STATE').ToString()
    if ($line -match '\s+(\w+)\s*$') { return $Matches[1] }
    return 'Unknown'
}

function Get-PortListener {
    # Returns the PID listening on 127.0.0.1:$BindPort, or $null.
    $raw = netstat -ano | Select-String ":$BindPort\s"
    foreach ($l in $raw) {
        $cols = ($l.ToString() -split '\s+') | Where-Object { $_ -ne '' }
        if ($cols.Count -ge 5 -and $cols[3] -eq 'LISTENING') {
            return [int]$cols[4]
        }
    }
    return $null
}

function Assert-BinaryExists {
    if (-not (Test-Path $binPath)) {
        Write-Host ""
        Write-Host "[hg-service] binary not found:" -ForegroundColor Red
        Write-Host "             $binPath" -ForegroundColor Red
        Write-Host ""
        Write-Host "Build it first:" -ForegroundColor Yellow
        Write-Host "  pnpm tauri build --debug       # for -Profile debug" -ForegroundColor Gray
        Write-Host "  pnpm tauri build               # for -Profile release" -ForegroundColor Gray
        Write-Host ""
        Write-Host "Or copy from src-tauri/resources/HuanvaeGuard/ manually." -ForegroundColor Gray
        exit 1
    }
    if (-not (Test-Path $wintun)) {
        Write-Host "[hg-service] WARN: wintun.dll missing at $wintun" -ForegroundColor Yellow
        Write-Host "             the service may fail to create the tunnel adapter." -ForegroundColor Yellow
    }
}

function Show-Status {
    Write-Host ""
    Write-Host "=== HuanvaeGuard Service (dev) ===" -ForegroundColor Cyan
    Write-Host "  profile      : $Profile"
    Write-Host "  binary       : $binPath"
    Write-Host "  binary exists: $(Test-Path $binPath)"
    Write-Host "  wintun.dll   : $(Test-Path $wintun)"

    $state = Get-ServiceState
    $stateColor = switch ($state) {
        'Running'      { 'Green' }
        'NotInstalled' { 'Red' }
        default        { 'Yellow' }
    }
    Write-Host "  service      : " -NoNewline
    Write-Host $state -ForegroundColor $stateColor

    $listenerPid = Get-PortListener
    if ($listenerPid) {
        $proc = Get-Process -Id $listenerPid -ErrorAction SilentlyContinue
        $procName = if ($proc) { $proc.ProcessName } else { '?' }
        Write-Host "  port $BindPort : " -NoNewline
        Write-Host "LISTENING (pid=$listenerPid, $procName)" -ForegroundColor Green
    } else {
        Write-Host "  port $BindPort : " -NoNewline
        Write-Host "not listening" -ForegroundColor Red
    }
    Write-Host ""
}

# --------------------------------------------------------------------------
# Action dispatch
# --------------------------------------------------------------------------
if ($Action -eq 'status') {
    Show-Status
    exit 0
}

# install/uninstall always require admin (SCM write).
# start/stop/restart work for non-admin too IF SDDL grants Authenticated Users
# (set up at install time); we try as current user first and only elevate on
# access-denied failures. This avoids UAC prompts during normal dev workflow.
$requiresAdmin = @('install', 'uninstall') -contains $Action
if ($requiresAdmin -and -not (Test-Admin)) {
    Invoke-Elevated
}

switch ($Action) {
    'install' {
        Assert-BinaryExists

        $state = Get-ServiceState
        if ($state -ne 'NotInstalled') {
            Write-Host "[hg-service] service already exists (state=$state) - reinstalling to refresh binPath..." -ForegroundColor Yellow
            & sc.exe stop $ServiceName 2>&1 | Out-Null
            Start-Sleep -Seconds 2
            & sc.exe delete $ServiceName 2>&1 | Out-Null
            Start-Sleep -Seconds 1
        }

        Write-Host "[hg-service] creating service..." -ForegroundColor Cyan
        # sc.exe requires a space after '=' in binPath=, start=, DisplayName=
        & sc.exe create $ServiceName binPath= "`"$binPath`"" start= demand DisplayName= "$DisplayName" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "sc.exe create failed (exit=$LASTEXITCODE)" }

        & sc.exe description $ServiceName "$Description" | Out-Null

        # 授予 Authenticated Users 启停权限（非管理员 Tauri 进程也能控制）
        # SDDL 说明（D: = DACL, A = Allow, AU = Authenticated Users (S-1-5-11))
        #   CC = SERVICE_QUERY_CONFIG, LC = SERVICE_QUERY_STATUS, SW = SERVICE_ENUMERATE_DEPENDENTS
        #   RP = SERVICE_START,         WP = SERVICE_STOP,         LO = SERVICE_INTERROGATE
        #   CR = SERVICE_USER_DEFINED_CONTROL, RC = READ_CONTROL
        # 前 4 条是默认 ACL（SY/BA/IU/SU），末尾 (A;;CCLCSWRPWPLOCRRC;;;AU) 是新增项
        Write-Host "[hg-service] granting SERVICE_START/STOP to Authenticated Users..." -ForegroundColor Cyan
        $sddl = 'D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)(A;;CCLCSWRPWPLOCRRC;;;AU)'
        & sc.exe sdset $ServiceName $sddl | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[hg-service] WARN: sdset failed (exit=$LASTEXITCODE) - Tauri app will not be able to auto-start/stop the service" -ForegroundColor Yellow
        }

        Write-Host "[hg-service] starting service..." -ForegroundColor Cyan
        & sc.exe start $ServiceName | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[hg-service] sc.exe start failed (exit=$LASTEXITCODE)" -ForegroundColor Red
            Write-Host "             check Event Viewer > Windows Logs > System for 'HuanvaeGuard'." -ForegroundColor Yellow
            Show-Status
            exit 1
        }

        Start-Sleep -Seconds 1
        Show-Status
    }

    'uninstall' {
        $state = Get-ServiceState
        if ($state -eq 'NotInstalled') {
            Write-Host "[hg-service] service not installed - nothing to do." -ForegroundColor Yellow
            exit 0
        }
        Write-Host "[hg-service] stopping service..." -ForegroundColor Cyan
        & sc.exe stop $ServiceName 2>&1 | Out-Null
        Start-Sleep -Seconds 2
        Write-Host "[hg-service] deleting service..." -ForegroundColor Cyan
        & sc.exe delete $ServiceName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "sc.exe delete failed (exit=$LASTEXITCODE)" }
        Show-Status
    }

    'start' {
        $state = Get-ServiceState
        if ($state -eq 'NotInstalled') {
            Write-Host "[hg-service] service not installed - run '-Action install' first." -ForegroundColor Red
            exit 1
        }
        if ($state -eq 'Running') {
            Write-Host "[hg-service] already running." -ForegroundColor Green
            Show-Status
            exit 0
        }
        & sc.exe start $ServiceName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "sc.exe start failed (exit=$LASTEXITCODE)" }
        Start-Sleep -Seconds 1
        Show-Status
    }

    'stop' {
        $state = Get-ServiceState
        if ($state -eq 'NotInstalled') {
            Write-Host "[hg-service] service not installed - nothing to stop." -ForegroundColor Yellow
            exit 0
        }
        if ($state -eq 'Stopped') {
            Write-Host "[hg-service] already stopped." -ForegroundColor Yellow
            exit 0
        }
        & sc.exe stop $ServiceName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "sc.exe stop failed (exit=$LASTEXITCODE)" }
        Start-Sleep -Seconds 1
        Show-Status
    }

    'restart' {
        $state = Get-ServiceState
        if ($state -ne 'NotInstalled' -and $state -ne 'Stopped') {
            & sc.exe stop $ServiceName 2>&1 | Out-Null
            Start-Sleep -Seconds 2
        }
        if ($state -eq 'NotInstalled') {
            Write-Host "[hg-service] service not installed - run '-Action install' first." -ForegroundColor Red
            exit 1
        }
        & sc.exe start $ServiceName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "sc.exe start failed (exit=$LASTEXITCODE)" }
        Start-Sleep -Seconds 1
        Show-Status
    }
}
