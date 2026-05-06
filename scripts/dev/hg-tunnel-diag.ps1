<#
.SYNOPSIS
    Correlate ping drops with HuanvaeGuard tunnel handshake events to
    pinpoint the cause of intermittent VPN packet loss.

.DESCRIPTION
    Runs two parallel collectors:
      1. Timestamped ping to the target VPN IP
      2. 1Hz poll of http://127.0.0.1:19198/api/tunnel/status
         (records last_handshake / rx_bytes / tx_bytes)

    After the run, prints a side-by-side timeline so you can visually
    align:
      - packet-loss bursts (>=2 consecutive timeouts)
      - handshake events (last_handshake value resetting to <=5s)
      - rx/tx counter stalls

.PARAMETER Target
    VPN-internal IP to ping. Default 10.0.2.129.

.PARAMETER Duration
    Collection duration in seconds. Default 180 (covers two WG rekey
    cycles at 120s each).

.EXAMPLE
    pwsh scripts/dev/hg-tunnel-diag.ps1
    pwsh scripts/dev/hg-tunnel-diag.ps1 -Target 10.0.2.129 -Duration 300

.NOTES
    Written in ASCII only to stay compatible with Windows PowerShell 5.1
    (which reads non-BOM UTF-8 files as the local ANSI codepage, e.g.
    GBK on Chinese Windows, and chokes on non-ASCII characters inside
    string literals).
#>

[CmdletBinding()]
param(
    [string]$Target   = '10.0.2.129',
    [int]   $Duration = 180
)

$ErrorActionPreference = 'Stop'

$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir  = Join-Path $env:TEMP "hg-diag-$stamp"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$pingLog   = Join-Path $logDir 'ping.log'
$statusLog = Join-Path $logDir 'status.log'

Write-Host ""
Write-Host "=== HuanvaeGuard tunnel diagnostic ===" -ForegroundColor Cyan
Write-Host "  target    : $Target"
Write-Host "  duration  : ${Duration}s"
Write-Host "  log dir   : $logDir"
Write-Host ""

# preflight: tunnel must be up
$pre = try { (Invoke-RestMethod -Uri 'http://127.0.0.1:19198/api/tunnel/status' -TimeoutSec 2) } catch { $null }
if (-not $pre -or -not $pre.data.active) {
    Write-Host "tunnel is not active - click Connect in the HuanvaeGuard window first" -ForegroundColor Red
    exit 1
}

# collector 1: timestamped ping (uses ping.exe for PS 5.1 compatibility)
$pingJob = Start-Job -ScriptBlock {
    param($target, $logFile, $duration)
    $endTime = (Get-Date).AddSeconds($duration)
    while ((Get-Date) -lt $endTime) {
        $t   = Get-Date -Format 'HH:mm:ss.fff'
        $out = & ping.exe -n 1 -w 2000 $target 2>$null
        $ok  = ($LASTEXITCODE -eq 0) -and ($out -match 'TTL=')
        $line = if ($ok) { "$t  OK" } else { "$t  TIMEOUT" }
        Add-Content -Path $logFile -Value $line
    }
} -ArgumentList $Target, $pingLog, $Duration

# collector 2: 1Hz tunnel-status poll
$statusJob = Start-Job -ScriptBlock {
    param($logFile, $duration)
    $endTime = (Get-Date).AddSeconds($duration)
    while ((Get-Date) -lt $endTime) {
        $t = Get-Date -Format 'HH:mm:ss.fff'
        try {
            $r = Invoke-RestMethod -Uri 'http://127.0.0.1:19198/api/tunnel/status' -TimeoutSec 1
            $p = $r.data.peers[0]
            $line = "$t  hs=$($p.last_handshake)  rx=$($p.rx_bytes)  tx=$($p.tx_bytes)"
        } catch {
            $line = "$t  <status-unreachable>"
        }
        Add-Content -Path $logFile -Value $line
        Start-Sleep -Seconds 1
    }
} -ArgumentList $statusLog, $Duration

Write-Host "collecting... (${Duration}s) - Ctrl+C to stop early" -ForegroundColor Yellow
Wait-Job -Job $pingJob, $statusJob -Timeout $Duration | Out-Null
Stop-Job $pingJob, $statusJob -ErrorAction SilentlyContinue
Remove-Job $pingJob, $statusJob -ErrorAction SilentlyContinue

# ----- analysis -----
Write-Host "`n=== Event timeline ===" -ForegroundColor Cyan

# 1. loss bursts (>=2 consecutive timeouts)
$pingLines = Get-Content $pingLog
$bursts = @()
$inBurst = $false; $burstStart = $null; $burstCount = 0
foreach ($l in $pingLines) {
    if ($l -match 'TIMEOUT') {
        if (-not $inBurst) { $burstStart = ($l -split '\s+')[0]; $burstCount = 1; $inBurst = $true }
        else { $burstCount++ }
    } else {
        if ($inBurst -and $burstCount -ge 2) {
            $bursts += [pscustomobject]@{ start = $burstStart; count = $burstCount }
        }
        $inBurst = $false
    }
}
if ($inBurst -and $burstCount -ge 2) {
    $bursts += [pscustomobject]@{ start = $burstStart; count = $burstCount }
}

$totalPings    = $pingLines.Count
$totalTimeouts = ($pingLines | Where-Object { $_ -match 'TIMEOUT' }).Count
$lossPct       = if ($totalPings) { [math]::Round(100 * $totalTimeouts / $totalPings, 1) } else { 0 }
Write-Host ("  loss rate       : {0}% ({1}/{2})" -f $lossPct, $totalTimeouts, $totalPings)
Write-Host ("  burst count     : {0}" -f $bursts.Count)
foreach ($b in $bursts) {
    Write-Host ("    {0}  {1} consecutive timeouts" -f $b.start, $b.count) -ForegroundColor Yellow
}

# 2. handshake events (last_handshake drops from large to <=5)
Write-Host "`n  handshake events (hs reset to <=5):"
$prev = 999
$statusLines = Get-Content $statusLog
foreach ($l in $statusLines) {
    if ($l -match 'hs=(\d+)') {
        $hs = [int]$Matches[1]
        if ($prev -gt 30 -and $hs -le 5) {
            $t = ($l -split '\s+')[0]
            Write-Host ("    {0}  (hs: {1} -> {2})" -f $t, $prev, $hs) -ForegroundColor Green
        }
        $prev = $hs
    }
}

# 3. rx/tx freeze detection (same counter for >=3s)
Write-Host "`n  rx/tx freeze points (>= 3s no change):"
$prevRx = -1; $prevTx = -1; $freezeStart = $null; $freezeSec = 0
foreach ($l in $statusLines) {
    if ($l -match 'rx=(\d+)\s+tx=(\d+)') {
        $rx = [int]$Matches[1]; $tx = [int]$Matches[2]
        if ($rx -eq $prevRx -and $tx -eq $prevTx) {
            if (-not $freezeStart) { $freezeStart = ($l -split '\s+')[0] }
            $freezeSec++
        } else {
            if ($freezeSec -ge 3) {
                Write-Host ("    {0}  frozen {1}s at rx={2} tx={3}" -f $freezeStart, $freezeSec, $prevRx, $prevTx) -ForegroundColor Yellow
            }
            $freezeStart = $null; $freezeSec = 0
        }
        $prevRx = $rx; $prevTx = $tx
    }
}

Write-Host "`n  raw logs:" -ForegroundColor DarkGray
Write-Host "    $pingLog"
Write-Host "    $statusLog"
Write-Host ""

# 4. interpretation hints
Write-Host "=== How to read ===" -ForegroundColor Cyan
Write-Host "  * burst time matches handshake time -> handshake packets dropped"
Write-Host "    (WG is fine, obfuscation/NAT/ISP drops kill rekey packets)"
Write-Host "  * bursts evenly spread, unrelated to handshake -> upstream UDP jitter"
Write-Host "  * rx/tx frozen during burst -> tunnel truly dead, not just ICMP"
Write-Host "  * rx/tx keeps growing during burst -> ICMP rate-limited, real traffic OK"
Write-Host ""
