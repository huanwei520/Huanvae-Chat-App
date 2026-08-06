# HuanvaeGuard VPN 连通性测试 (Windows)
#
# 判据是"真握手 + 真收发包 + 端到端 ping"，不是"服务起来了"。
# 已发生过的真实故障：服务状态看着正常，但上下行包**均为 0** —— 隧道从未真正承载过流量。
# 所以本脚本每一项都量真实数字，并把**原始命令输出**打印出来备查，不只打结论。
#
# 本文件是 scripts/hg-connectivity-test.sh (macOS) 的 Windows 侧镜像，五项语义完全一致，
# 平台差异只在取数手段：
#   1. 服务托管态   sc.exe query HuanvaeGuard，必须 STATE : 4  RUNNING（对应 mac 的 launchctl）
#   2/4. 接口统计   Get-NetAdapterStatistics（对应 mac 的 ifconfig / netstat -ibn）
#   5. ping         ping.exe -n（对应 mac 的 ping -c）
#   控制口          固定 127.0.0.1:19198（Windows 侧无多实例概念，不从配置解析）
#
# 五项检查：
#   1. 守护进程被系统真拉起   SCM 报告 RUNNING
#                             （踩过的坑：手工前台跑得起来、但被 SCM 拉不起来 —— 手启成功不算数）
#   2. 隧道接口 + VIP         status JSON 的 active / interface_name / address + 网卡原始信息
#   3. 真实握手               peers[0].last_handshake 必须非 0（0 = 从未握手）
#   4. 真实收发包（两向）     ping 前后各采样一次，**收发必须分开量**，任一方向增量为 0 即 FAIL
#   5. 端到端 ping            丢包率 + 每包 TTL 跳数判定 + 路由不得落在 Loopback
#
# 环境变量：
#   HG_PEER_VIP            对端隧道 VIP（形如 <对端VIP>）。**必需，无默认值**
#   HG_PEER_INITIAL_TTL    对端 OS 的初始 TTL。macOS/Linux 对端填 64，Windows 对端填 128。默认 64
#   HG_CONTROL_PORT        本机守护进程控制口。默认 19198
#   HG_PING_COUNT          ping 包数。默认 10
#   HG_EXPECT_DAEMON_SHA   期望的已装守护进程 sha256。设置了就**断言相等**，不等即 FAIL。默认不校验
#
# 退出码（调用方靠它区分三态）：
#   0 = 五项全过
#   1 = 有项 FAIL（真跑了，没通过）
#   3 = 本机物理上跑不了，**未执行**（HG_PEER_VIP 未设置 / 本机没装该服务 /
#       控制口无应答且服务不存在 / 不是 Windows）。这一态**不是通过也不是失败**，
#       调用方登记为"跳过"。
#
# 用法：
#   $env:HG_PEER_VIP='<对端VIP>'; .\scripts\hg-connectivity-test.ps1
#   $env:HG_PEER_VIP='<对端VIP>'; $env:HG_PEER_INITIAL_TTL='128'; .\scripts\hg-connectivity-test.ps1
#
# 关于 TTL 判据（别改成硬编码 63）：
#   TTL 初值由**应答方 OS**决定（macOS/Linux = 64，Windows = 128）。判"包是否真经过转发"
#   要用「初始 TTL − 实测 TTL == 1」。把判据写死成 TTL == 63，换个 OS 的对端就恒错。
#
# 兼容性：PowerShell 5.1（Windows 自带）。刻意不用 ?: 三元、?? 空合并、-ErrorAction Ignore
#   等 7+ 语法。本文件存为 **UTF-8 with BOM** —— PS 5.1 读无 BOM 的 UTF-8 会按 ANSI 解，
#   中文全变乱码。
#
# 本仓是 PUBLIC 公开仓：脚本内不出现任何私网 IP / 内部主机名 / 真实对端地址，
#   对端一律由 HG_PEER_VIP 注入，注释里只用 <对端VIP> 占位符。
#
# 改本文件时注意：**变量后面紧跟中文字符时必须写 $($var)**，不能写 $var。PowerShell 把
#   汉字视为合法的变量名字符，`"$count非 0"` 会被解析成变量 `$count非` → 取到空值。

$ErrorActionPreference = "Continue"

# ============================================
# 常量（Windows 侧固定，无多实例概念）
# ============================================
$SERVICE_NAME = "HuanvaeGuard"
$DEFAULT_CONTROL_PORT = 19198

# ============================================
# 五项登记表（PENDING / PASS / FAIL / NOTRUN）
# ============================================
$script:itemName = @{
    1 = "守护进程被系统真拉起"
    2 = "隧道接口 + VIP"
    3 = "真实握手"
    4 = "真实收发包（两向）"
    5 = "端到端 ping"
}
$script:itemStatus = @{ 1 = "PENDING"; 2 = "PENDING"; 3 = "PENDING"; 4 = "PENDING"; 5 = "PENDING" }
$script:itemReason = @{ 1 = ""; 2 = ""; 3 = ""; 4 = ""; 5 = "" }

function Pass-Item {
    param([int]$Index, [string]$Message)
    $script:itemStatus[$Index] = "PASS"
    Write-Host "  ✓ PASS: $Message" -ForegroundColor Green
}

function Fail-Item {
    # 同一项可多次调用，判据累加（汇总时把每条判据原文都列出来）
    param([int]$Index, [string]$Message)
    $script:itemStatus[$Index] = "FAIL"
    if ($script:itemReason[$Index]) {
        $script:itemReason[$Index] = $script:itemReason[$Index] + " ｜ " + $Message
    } else {
        $script:itemReason[$Index] = $Message
    }
    Write-Host "  ✗ FAIL: $Message" -ForegroundColor Red
}

function NotRun-Item {
    param([int]$Index, [string]$Message)
    $script:itemStatus[$Index] = "NOTRUN"
    $script:itemReason[$Index] = $Message
    Write-Host "  — 未执行: $Message" -ForegroundColor Yellow
}

function Step-Header {
    param([int]$Index, [string]$Title)
    Write-Host ""
    Write-Host "[$Index/5] $Title" -ForegroundColor Cyan
}

function Show-Cmd {
    # 把即将执行的命令原样打出来，便于人工复现
    param([string]$Cmd)
    Write-Host "  > $Cmd" -ForegroundColor DarkGray
}

function Write-Indented {
    param([string]$Text)
    if ($null -eq $Text -or $Text -eq "") {
        Write-Host "      (无输出)"
        return
    }
    foreach ($line in ($Text -split "`r?`n")) {
        Write-Host "      $line"
    }
}

# 本机物理上跑不了 —— 退出码 3，措辞必须明说"未执行"
function Exit-NotRunnable {
    param([string]$Reason)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "  ⚠ 本次未执行：$Reason" -ForegroundColor Yellow
    Write-Host "  未执行 —— 既不是通过也不是失败，不能视为通过" -ForegroundColor Yellow
    Write-Host "  调用方请把本次登记为「跳过」（退出码 3）" -ForegroundColor DarkGray
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
    exit 3
}

# ============================================
# 控制口取数
# ============================================
function Get-StatusRaw {
    # 返回控制口的原始响应文本；拿不到就返回 $null（由调用方判定，不在这里吞成"正常"）
    param([string]$Url)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
        return $resp.Content
    } catch {
        return $null
    }
}

function ConvertTo-StatusObject {
    param([string]$Raw)
    if (-not $Raw) { return $null }
    try {
        return ($Raw | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Resolve-AdapterName {
    # status JSON 里的接口名未必等于 Windows 网卡的 Name，逐级放宽匹配；找不到返回 $null
    param([string]$IfName)
    if (-not $IfName) { return $null }

    $a = Get-NetAdapter -Name $IfName -ErrorAction SilentlyContinue
    if ($a) { return $a.Name }

    $a = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
        $_.InterfaceAlias -eq $IfName -or $_.InterfaceDescription -like "*$IfName*"
    } | Select-Object -First 1
    if ($a) { return $a.Name }

    return $null
}

# ============================================
# 前置：环境与参数
# ============================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  HuanvaeGuard VPN 连通性测试 (Windows)" -ForegroundColor Magenta
Write-Host "  判据：真握手 + 真收发包 + 端到端 ping" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta

if ($env:OS -ne "Windows_NT") {
    Exit-NotRunnable "本脚本只覆盖 Windows 侧（sc.exe / Get-NetAdapterStatistics / ping.exe）；macOS 侧请用 scripts/hg-connectivity-test.sh"
}

$peerVip = $env:HG_PEER_VIP
if (-not $peerVip) {
    Exit-NotRunnable "HG_PEER_VIP 未设置（对端隧道 VIP 无默认值，必须显式注入）"
}
if ($peerVip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    Exit-NotRunnable "HG_PEER_VIP 不是合法 IPv4 地址：$peerVip"
}

$peerInitialTtl = 64
if ($env:HG_PEER_INITIAL_TTL) {
    if ($env:HG_PEER_INITIAL_TTL -match '^\d+$') {
        $peerInitialTtl = [int]$env:HG_PEER_INITIAL_TTL
    } else {
        Write-Host "  ⚠ HG_PEER_INITIAL_TTL=`"$($env:HG_PEER_INITIAL_TTL)`" 不是数字，按默认 64 处理" -ForegroundColor Yellow
    }
}

$pingCount = 10
if ($env:HG_PING_COUNT) {
    if ($env:HG_PING_COUNT -match '^[1-9]\d*$') {
        $pingCount = [int]$env:HG_PING_COUNT
    } else {
        Write-Host "  ⚠ HG_PING_COUNT=`"$($env:HG_PING_COUNT)`" 不是正整数，按默认 10 处理" -ForegroundColor Yellow
    }
}

$controlPort = $DEFAULT_CONTROL_PORT
$controlPortSrc = "Windows 侧固定默认端口"
if ($env:HG_CONTROL_PORT) {
    if ($env:HG_CONTROL_PORT -match '^\d+$') {
        $controlPort = [int]$env:HG_CONTROL_PORT
        $controlPortSrc = "环境变量 HG_CONTROL_PORT"
    } else {
        Write-Host "  ⚠ HG_CONTROL_PORT=`"$($env:HG_CONTROL_PORT)`" 不是数字，按默认 $DEFAULT_CONTROL_PORT 处理" -ForegroundColor Yellow
    }
}

$expectSha = $env:HG_EXPECT_DAEMON_SHA
$expectShaText = "（未设置，不校验）"
if ($expectSha) { $expectShaText = $expectSha }

Write-Host ""
Write-Host "  对端 VIP        : $peerVip"
Write-Host "  对端初始 TTL    : $peerInitialTtl  （判据：初始 TTL − 实测 TTL == 1）"
Write-Host "  ping 包数       : $pingCount"
Write-Host "  控制口          : 127.0.0.1:$controlPort  ← $controlPortSrc"
Write-Host "  期望守护进程 SHA: $expectShaText"

# 服务是否存在：不存在 = 本机没装 → 未执行
$scQueryOut = (& sc.exe query $SERVICE_NAME 2>&1 | Out-String)
$serviceExists = $true
if ($LASTEXITCODE -eq 1060 -or $scQueryOut -match '1060') {
    # 1060 = ERROR_SERVICE_DOES_NOT_EXIST
    $serviceExists = $false
}
if (-not $serviceExists) {
    Exit-NotRunnable "本机没装守护进程（sc.exe query $SERVICE_NAME 报 1060：服务不存在）"
}

$statusUrl = "http://127.0.0.1:$controlPort/api/tunnel/status"

$startTime = Get-Date

# ============================================
# 1. 守护进程被系统真拉起（SCM）
# ============================================
Step-Header 1 $script:itemName[1]
Write-Host "  判据：SCM 托管态必须 STATE : 4  RUNNING；" -ForegroundColor DarkGray
Write-Host "  手工前台能跑起来**不算数**（踩过的坑：SCM 拉不起同一个二进制，报 1053）" -ForegroundColor DarkGray

Show-Cmd "sc.exe query $SERVICE_NAME"
Write-Indented $scQueryOut

if ($scQueryOut -match 'STATE\s*:\s*4\s+RUNNING') {
    Pass-Item 1 "SCM 报告 STATE : 4  RUNNING（系统托管路径已真拉起）"
} else {
    Fail-Item 1 "sc.exe query $SERVICE_NAME 输出里没有 `"STATE : 4  RUNNING`"（服务未被 SCM 真拉起）"
}

# 发货件同一性：设置了期望 sha 就断言相等。二进制路径从服务注册项里读，
# 保证校验的正是 SCM 实际会拉起的那个文件，而不是仓库里某份同名副本。
if ($expectSha) {
    Show-Cmd "sc.exe qc $SERVICE_NAME"
    $scConfigOut = (& sc.exe qc $SERVICE_NAME 2>&1 | Out-String)
    Write-Indented $scConfigOut

    $binPath = $null
    $m = [regex]::Match($scConfigOut, 'BINARY_PATH_NAME\s*:\s*(.+)')
    if ($m.Success) {
        $binPath = $m.Groups[1].Value.Trim().Trim('"')
        # 去掉可能跟在 exe 后面的启动参数
        $exeMatch = [regex]::Match($binPath, '^(.*?\.exe)', 'IgnoreCase')
        if ($exeMatch.Success) { $binPath = $exeMatch.Groups[1].Value.Trim('"') }
    }

    if ($binPath -and (Test-Path -LiteralPath $binPath)) {
        Show-Cmd "Get-FileHash -Algorithm SHA256 `"$binPath`""
        $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $binPath
        Write-Indented ($hash | Format-List Algorithm, Hash, Path | Out-String)
        $actualSha = $hash.Hash.ToLower()
        $wantSha = $expectSha.ToLower()
        if ($actualSha -eq $wantSha) {
            Write-Host "  ✓ 守护进程 sha256 与 HG_EXPECT_DAEMON_SHA 一致" -ForegroundColor Green
        } else {
            Fail-Item 1 "已装守护进程 sha256 与期望不符：实测 $actualSha ≠ 期望 $($wantSha)（跑起来的不是这次要发的那份二进制）"
        }
    } else {
        Fail-Item 1 "设置了 HG_EXPECT_DAEMON_SHA，但从服务注册项解析不到可用的二进制路径（解析结果：$binPath），无法校验发货件同一性"
    }
}

# ============================================
# 2. 隧道接口 + VIP
# ============================================
Step-Header 2 $script:itemName[2]
Write-Host "  判据：status JSON 的 active == true，且 interface_name / address 非空" -ForegroundColor DarkGray

Show-Cmd "Invoke-WebRequest $statusUrl"
$statusRaw = Get-StatusRaw -Url $statusUrl
if ($statusRaw) {
    Write-Indented $statusRaw
} else {
    Write-Host "      (控制口无应答)" -ForegroundColor Red
}
$statusObj = ConvertTo-StatusObject -Raw $statusRaw

$active = $null
$tunIf = $null
$tunAddr = $null
$peerObj = $null
if ($statusObj -and $statusObj.data) {
    $active = $statusObj.data.active
    $tunIf = $statusObj.data.interface_name
    $tunAddr = $statusObj.data.address
    if ($statusObj.data.peers -and $statusObj.data.peers.Count -gt 0) {
        $peerObj = $statusObj.data.peers[0]
    }
}
$localVip = $null
if ($tunAddr) { $localVip = ($tunAddr -split '/')[0] }

Write-Host "  解析：active=$active  interface_name=$tunIf  address=$tunAddr" -ForegroundColor DarkGray

$item2Ok = $true
if ($active -ne $true) {
    Fail-Item 2 "status JSON 的 active 不是 true（实测：$active；取不到值时通常是控制口无应答）"
    $item2Ok = $false
}
if (-not $tunIf) {
    Fail-Item 2 "status JSON 取不到 interface_name（隧道接口不存在）"
    $item2Ok = $false
}
if (-not $tunAddr) {
    Fail-Item 2 "status JSON 取不到 address（隧道未分配 VIP）"
    $item2Ok = $false
}

$adapterName = Resolve-AdapterName -IfName $tunIf
if ($tunIf) {
    Show-Cmd "Get-NetAdapter -Name `"$tunIf`""
    if ($adapterName) {
        $adapterInfo = Get-NetAdapter -Name $adapterName -ErrorAction SilentlyContinue |
            Format-List Name, InterfaceAlias, InterfaceDescription, Status, LinkSpeed, ifIndex | Out-String
        Write-Indented $adapterInfo
        Show-Cmd "Get-NetIPAddress -InterfaceAlias `"$adapterName`""
        $ipInfo = Get-NetIPAddress -InterfaceAlias $adapterName -ErrorAction SilentlyContinue |
            Format-List IPAddress, PrefixLength, AddressFamily, InterfaceAlias | Out-String
        Write-Indented $ipInfo
    } else {
        Write-Host "      (系统里找不到这块网卡)" -ForegroundColor Red
        Fail-Item 2 "Get-NetAdapter 找不到接口 $tunIf（status JSON 报了接口名，系统里却没有这块网卡）"
        $item2Ok = $false
    }
}

if ($item2Ok) {
    Pass-Item 2 "隧道 active=true，网卡 $adapterName 存在，VIP $tunAddr"
}

# ============================================
# 3. 真实握手
# ============================================
Step-Header 3 $script:itemName[3]
Write-Host "  判据：peers[0].last_handshake 必须非 0（0 = 从未握手过）" -ForegroundColor DarkGray

$peerPubKey = $null
$lastHandshake = $null
if ($peerObj) {
    $peerPubKey = $peerObj.public_key
    $lastHandshake = $peerObj.last_handshake
}
Write-Host "  解析：peers[0].public_key=$peerPubKey  last_handshake=$lastHandshake" -ForegroundColor DarkGray

if (-not $peerObj) {
    Fail-Item 3 "status JSON 的 peers 为空（没有任何 peer，谈不上握手）"
} elseif ($null -eq $lastHandshake) {
    Fail-Item 3 "status JSON 取不到 peers[0].last_handshake"
} elseif ([int64]$lastHandshake -eq 0) {
    Fail-Item 3 "peers[0].last_handshake == 0（从未握手成功，隧道只是「配上了」而已）"
} else {
    Pass-Item 3 "peers[0].last_handshake = $($lastHandshake)（非 0，握手真发生过）"
}

# ============================================
# 4 + 5：采样 T0 → ping → 采样 T1
# 收发包必须**两向分开量**：只报"通/不通"会把"发出去了没人应"和"压根没发出去"
# 混成同一句话，而这两者根因完全不同 —— 已发生过的故障正是上下行**均为 0**。
# ============================================
function Sample-Counters {
    # 一次采样：控制口 JSON + 网卡统计，**打印出来的那份就是拿去判定的那份**
    param([string]$Label, [string]$AdapterName)

    Write-Host "  —— 采样 $Label ——" -ForegroundColor DarkGray

    Show-Cmd "Invoke-WebRequest $statusUrl"
    $raw = Get-StatusRaw -Url $statusUrl
    if ($raw) { Write-Indented $raw } else { Write-Host "      (控制口无应答)" -ForegroundColor Red }
    $obj = ConvertTo-StatusObject -Raw $raw

    $rx = 0
    $tx = 0
    if ($obj -and $obj.data -and $obj.data.peers -and $obj.data.peers.Count -gt 0) {
        if ($null -ne $obj.data.peers[0].rx_bytes) { $rx = [int64]$obj.data.peers[0].rx_bytes }
        if ($null -ne $obj.data.peers[0].tx_bytes) { $tx = [int64]$obj.data.peers[0].tx_bytes }
    }

    $recvBytes = $null
    $sentBytes = $null
    $recvPkts = $null
    $sentPkts = $null
    if ($AdapterName) {
        Show-Cmd "Get-NetAdapterStatistics -Name `"$AdapterName`""
        $st = Get-NetAdapterStatistics -Name $AdapterName -ErrorAction SilentlyContinue
        if ($st) {
            Write-Indented ($st | Format-List Name, ReceivedBytes, ReceivedUnicastPackets, SentBytes, SentUnicastPackets | Out-String)
            $recvBytes = [int64]$st.ReceivedBytes
            $sentBytes = [int64]$st.SentBytes
            $recvPkts = [int64]$st.ReceivedUnicastPackets
            $sentPkts = [int64]$st.SentUnicastPackets
        } else {
            Write-Host "      (读不到网卡统计)" -ForegroundColor Red
        }
    }

    return [PSCustomObject]@{
        Rx        = $rx
        Tx        = $tx
        RecvBytes = $recvBytes
        SentBytes = $sentBytes
        RecvPkts  = $recvPkts
        SentPkts  = $sentPkts
    }
}

Step-Header 4 $script:itemName[4]
Write-Host "  判据：ping 前后**上行、下行分开量**，两向增量都必须 > 0，任一为 0 即 FAIL" -ForegroundColor DarkGray
Write-Host "  （真实故障形态：服务状态正常但上下行包均为 0 —— 单看状态发现不了）" -ForegroundColor DarkGray

$pingOut = $null
$pingRan = $false

if ((-not $item2Ok) -or (-not $adapterName)) {
    NotRun-Item 4 "第 2 项未通过（拿不到隧道网卡），无法采样收发计数器"
} else {
    $t0 = Sample-Counters -Label "T0（ping 前）" -AdapterName $adapterName

    Write-Host ""
    Write-Host "  触发流量：执行第 5 项的 ping（原始输出见第 5 项）" -ForegroundColor DarkGray
    $pingOut = (& ping.exe -n $pingCount $peerVip 2>&1 | Out-String)
    $pingRan = $true
    Write-Host ""

    $t1 = Sample-Counters -Label "T1（ping 后）" -AdapterName $adapterName

    $dRx = $t1.Rx - $t0.Rx
    $dTx = $t1.Tx - $t0.Tx

    Write-Host ""
    Write-Host "  peer 计数器增量 : rx $($t0.Rx) → $($t1.Rx) (Δ $dRx)   tx $($t0.Tx) → $($t1.Tx) (Δ $dTx)" -ForegroundColor DarkGray

    $haveAdapterStats = ($null -ne $t0.RecvPkts -and $null -ne $t1.RecvPkts)
    $dRecvPkts = $null
    $dSentPkts = $null
    $dRecvBytes = $null
    $dSentBytes = $null
    if ($haveAdapterStats) {
        $dRecvPkts = $t1.RecvPkts - $t0.RecvPkts
        $dSentPkts = $t1.SentPkts - $t0.SentPkts
        $dRecvBytes = $t1.RecvBytes - $t0.RecvBytes
        $dSentBytes = $t1.SentBytes - $t0.SentBytes
        Write-Host "  网卡收包增量    : ReceivedUnicastPackets Δ $dRecvPkts   ReceivedBytes Δ $dRecvBytes" -ForegroundColor DarkGray
        Write-Host "  网卡发包增量    : SentUnicastPackets Δ $dSentPkts   SentBytes Δ $dSentBytes" -ForegroundColor DarkGray
    }

    $item4Ok = $true

    # 上行（发出去了没有）
    if ($dTx -le 0) {
        Fail-Item 4 "上行：peer tx_bytes 增量为 $dTx —— 包压根没发出去（不是网络问题，是本机数据面/控制面问题）"
        $item4Ok = $false
    }
    # 下行（对端应答了没有）
    if ($dRx -le 0) {
        Fail-Item 4 "下行：peer rx_bytes 增量为 $dRx —— 发出去了但对端没有任何应答（网络/加密/对端侧问题）"
        $item4Ok = $false
    }

    if (-not $haveAdapterStats) {
        Fail-Item 4 "读不到 Get-NetAdapterStatistics 计数（网卡 $adapterName），无法独立复核收发两向 —— 未测到即不算通过"
        $item4Ok = $false
    } else {
        if ($dSentPkts -le 0) {
            Fail-Item 4 "上行：SentUnicastPackets 增量为 $dSentPkts —— 网卡侧确认一个包都没发出去"
            $item4Ok = $false
        }
        if ($dRecvPkts -le 0) {
            Fail-Item 4 "下行：ReceivedUnicastPackets 增量为 $dRecvPkts —— 网卡侧确认一个应答包都没收到"
            $item4Ok = $false
        }
    }

    if ($item4Ok) {
        Pass-Item 4 "两向都真有包：下行 rx Δ $dRx 字节 / 收 $dRecvPkts 包，上行 tx Δ $dTx 字节 / 发 $dSentPkts 包"
    }
}

# ============================================
# 5. 端到端 ping
# ============================================
Step-Header 5 $script:itemName[5]
Write-Host "  判据：丢包率不得 100%；每包必须满足「初始 TTL($peerInitialTtl) − TTL == 1」；" -ForegroundColor DarkGray
Write-Host "  路由不得落在 Loopback（落在 Loopback = 本地交付，包永不进隧道）" -ForegroundColor DarkGray

if (-not $pingRan) {
    NotRun-Item 5 "第 2/4 项未通过（拿不到隧道网卡），ping 未执行"
} else {
    Show-Cmd "ping.exe -n $pingCount $peerVip"
    Write-Indented $pingOut

    # TTL= 大小写在中英文系统上都是 TTL=，容错起见忽略大小写
    $ttlMatches = [regex]::Matches($pingOut, 'TTL\s*=\s*(\d+)', 'IgnoreCase')
    $ttls = @()
    foreach ($tm in $ttlMatches) { $ttls += [int]$tm.Groups[1].Value }

    # 丢包率：英文 "(0% loss)" / 中文 "(0% 丢失)"
    $loss = $null
    $lossMatch = [regex]::Match($pingOut, '\(\s*(\d+)\s*%\s*(loss|丢失)\s*\)', 'IgnoreCase')
    if ($lossMatch.Success) {
        $loss = [int]$lossMatch.Groups[1].Value
    } elseif ($ttls.Count -eq 0) {
        # 解析不到丢包率、又一个应答都没有：按全丢处理（比"解析不到就放过"安全）
        $loss = 100
    }

    Write-Host "  解析：丢包率=$loss%  收到应答包=$($ttls.Count) 个  TTL 取值=$($ttls -join ' ')" -ForegroundColor DarkGray

    $item5Ok = $true
    if ($null -eq $loss) {
        Fail-Item 5 "ping 输出里解析不到丢包率（ping 未正常执行，见上方原始输出）"
        $item5Ok = $false
    } elseif ($loss -ge 100) {
        Fail-Item 5 "丢包率 $loss% —— 端到端完全不通"
        $item5Ok = $false
    }

    if ($ttls.Count -eq 0) {
        Fail-Item 5 "没有收到任何带 TTL 的应答包，无法验证转发跳数"
        $item5Ok = $false
    } else {
        $badTtls = @()
        foreach ($t in $ttls) {
            if (($peerInitialTtl - $t) -ne 1) { $badTtls += $t }
        }
        if ($badTtls.Count -gt 0) {
            Fail-Item 5 "有包不满足「初始 TTL($peerInitialTtl) − TTL == 1」：异常 TTL = $($badTtls -join ' ')（包没经过预期的那一跳转发）"
            $item5Ok = $false
        }
    }

    # 路由归属：落在 Loopback = 内核本地交付，包永远不会进隧道
    #（对应 macOS 侧 `route -n get <对端VIP>` 的 flags 含 LOCAL 判定）
    Write-Host ""
    Show-Cmd "Find-NetRoute -RemoteIPAddress $peerVip"
    $routeOut = $null
    $routeObjs = $null
    try {
        $routeObjs = Find-NetRoute -RemoteIPAddress $peerVip -ErrorAction Stop
        $routeOut = ($routeObjs | Format-List InterfaceAlias, InterfaceIndex, IPAddress, NextHop, DestinationPrefix | Out-String)
    } catch {
        $routeOut = "Find-NetRoute 失败: $($_.Exception.Message)"
    }
    Write-Indented $routeOut

    if ($routeObjs) {
        $loopbackHit = $routeObjs | Where-Object { $_.InterfaceAlias -match 'Loopback' } | Select-Object -First 1
        if ($loopbackHit) {
            Fail-Item 5 "Find-NetRoute $peerVip 选中的是 Loopback 接口（InterfaceAlias=$($loopbackHit.InterfaceAlias)）—— 本地交付，包永不进隧道"
            $item5Ok = $false
        }
    } else {
        Fail-Item 5 "Find-NetRoute $peerVip 拿不到路由（去往对端 VIP 没有可用路由）"
        $item5Ok = $false
    }

    if ($item5Ok) {
        Pass-Item 5 "丢包率 $loss%，$($ttls.Count) 个应答包 TTL 均满足「$peerInitialTtl − TTL == 1」，路由未落在 Loopback"
    }
}

# ============================================
# 汇总
# ============================================
$duration = [int]((Get-Date) - $startTime).TotalSeconds

$passCount = 0
$hasFail = $false
$hasNotRun = $false
foreach ($i in 1..5) {
    switch ($script:itemStatus[$i]) {
        "PASS" { $passCount++ }
        "FAIL" { $hasFail = $true }
        default { $hasNotRun = $true }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  VPN 连通性测试汇总" -ForegroundColor Magenta
Write-Host "  耗时: $duration 秒"
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  5 项中真跑通过 $passCount 项" -ForegroundColor Cyan
foreach ($i in 1..5) {
    $name = $script:itemName[$i]
    switch ($script:itemStatus[$i]) {
        "PASS" { Write-Host "  ✓ [$i] $name" -ForegroundColor Green }
        "FAIL" { Write-Host "  ✗ [$i] $name" -ForegroundColor Red }
        default { Write-Host "  — [$i] $($name)（未执行）" -ForegroundColor Yellow }
    }
}

if ($hasFail -or $hasNotRun) {
    Write-Host ""
    Write-Host "  未通过项的判据原文：" -ForegroundColor Red
    foreach ($i in 1..5) {
        if ($script:itemStatus[$i] -ne "PASS" -and $script:itemReason[$i]) {
            Write-Host "  - [$i] $($script:itemName[$i]): $($script:itemReason[$i])" -ForegroundColor Red
        }
    }
}

Write-Host ""
if ($hasFail) {
    Write-Host "  VPN 连通性测试未通过（真跑了，没过）" -ForegroundColor Red
    Write-Host ""
    exit 1
}
if ($hasNotRun) {
    Write-Host "  有项未执行 —— 不视为通过" -ForegroundColor Red
    Write-Host ""
    exit 1
}
Write-Host "  5/5 真跑通过：真握手 + 两向真收发包 + 端到端 ping 均达标" -ForegroundColor Green
Write-Host ""
exit 0
