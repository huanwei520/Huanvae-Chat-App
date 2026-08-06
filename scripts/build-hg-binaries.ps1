<#
.SYNOPSIS
    Huanvae Chat App —— HuanvaeGuard 守护进程二进制构建 / 替换脚本 (Windows 宿主)

.DESCRIPTION
    scripts/build-hg-binaries.sh 的同源镜像。差异只在"谁本机构建、谁远程构建"：
      本脚本 (Windows 宿主) : 本机构建 hg-windows，ssh 到 macOS 构建机产出 hg-macos
      build-hg-binaries.sh   : 本机构建 hg-macos，ssh 到 Windows 构建机产出 hg-windows

    为什么有这个脚本：App 发货两个 VPN 守护进程二进制，长期是「手工放进去、来源不明、
    无人验证」的死文件，已连续造成两起生产故障（发货件落后于当前契约 / 签名形态不被
    launchd 接受）。本脚本把它们改成「每次发布前从 HuanvaeGuard 源码仓构建 → 校验 →
    替换」的可复现产物。

.OUTPUTS
    产物落点（相对项目根）
      Windows : src-tauri\resources\HuanvaeGuard\huanvaeguard-svc.exe   (crate hg-windows，产物名 hg-windows.exe，落点改名)
      macOS   : src-tauri\resources\HuanvaeGuard-macos\hg-macos         (crate hg-macos)
      manifest: src-tauri\resources\hg-build-manifest.json

.NOTES
    环境变量
      HG_REPO             HuanvaeGuard 源码仓路径      默认 <项目根>\..\HuanvaeGuard
      HG_MAC_BUILD_HOST   构建 macOS 产物的 ssh 目标（形如 user@host）。**无默认值**
                          —— 本仓是 PUBLIC 公开仓，不写任何内网地址 / 主机名 / 账号
      HG_MAC_BUILD_DIR    该宿主上的构建树路径          默认 /var/lib/build/HuanvaeGuard
      HG_SKIP_MACOS       置 1 时只构建 Windows 侧（临时排障用，默认不跳）

    用法
      powershell -ExecutionPolicy Bypass -File .\scripts\build-hg-binaries.ps1
      $env:HG_MAC_BUILD_HOST='user@host'; .\scripts\build-hg-binaries.ps1
      $env:HG_SKIP_MACOS='1'; .\scripts\build-hg-binaries.ps1     # 仅排障，发布前不许这么跑

    硬性约束
      - 任一步失败立刻 exit 1：绝不回落仓里的旧文件、绝不静默降级。
      - 不在这里设 RUSTFLAGS：HuanvaeGuard 仓的 .cargo/config.toml 已用 --remap-path-prefix
        抹掉构建机路径，环境变量 RUSTFLAGS 会整体覆盖它、把构建机绝对路径重新烘进产物。
      - macOS 产物构建后必须在构建机上 codesign -f -s - 显式重签：linker-signed 形态
        launchd 可能拒绝加载。
      - 替换进落点之前必须过"产物形态断言"：macOS 架构恰好等于 $ExpectedMacArch、
        Windows 是 PE32+ x86-64。构建成功 ≠ 产物能在目标机器上跑，这两条是唯一的机器复查。

    退出码
      0 = 全部产物构建 / 校验 / 替换成功
      1 = 任一环节失败（含泄露扫命中）

    @date 2026-08-06
#>

$ErrorActionPreference = "Continue"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

# ============================================
# 配置
# ============================================
$HgRepo = $env:HG_REPO
if (-not $HgRepo) { $HgRepo = Join-Path $ProjectRoot "..\HuanvaeGuard" }

$MacBuildDir = $env:HG_MAC_BUILD_DIR
if (-not $MacBuildDir) { $MacBuildDir = "/var/lib/build/HuanvaeGuard" }

$MacBuildHost = $env:HG_MAC_BUILD_HOST

$WinDestRel  = "src-tauri\resources\HuanvaeGuard\huanvaeguard-svc.exe"
$MacDestRel  = "src-tauri\resources\HuanvaeGuard-macos\hg-macos"
$ManifestRel = "src-tauri\resources\hg-build-manifest.json"

# manifest 里的 path 字段统一用正斜杠，与 sh 版产出的 manifest 保持一致
$WinDestRelJson = "src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe"
$MacDestRelJson = "src-tauri/resources/HuanvaeGuard-macos/hg-macos"

# App 的 macOS 产物目标架构。对齐 .github/workflows/release.yml 的 build matrix：
# macOS 只有一条 `platform: macos-14 / target: aarch64-apple-darwin / name: darwin-aarch64`
# （注释里写明 macos-13 (Intel) 已被 GitHub 废弃），产物是 ..._aarch64.dmg，updater manifest
# 也只有 darwin-aarch64 一个 key —— 即本产品线仅支持 Apple Silicon，守护进程单 arm64 是正确的。
# 这个常量存在的意义是"防漂移"：哪天 DMG 改成 universal 或加回 Intel target，而守护进程还是
# 单 arm64，就会复发「装上去 daemon 起不来」。改产品线时必须连这里一起改。
$ExpectedMacArch = "arm64"

# Windows 守护进程的目标三元组。**故意是 gnu (mingw)，不要改成 msvc**：
# mingw 这一份正是在真 Windows 机上验证过「能被 SCM 拉起 + 能建隧道」的那份。换 msvc 等于
# 重新发一份没人验过的二进制 —— 而"发货二进制无人验证"正是本脚本要根治的病本身。
$ExpectedWinTriple = "x86_64-pc-windows-gnu"

# ============================================
# 辅助函数
# ============================================
function Print-Header($text) {
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Magenta
    Write-Host "  $text" -ForegroundColor Magenta
    Write-Host "================================================" -ForegroundColor Magenta
}

function Print-Step($step, $text) {
    Write-Host "[$step] $text" -ForegroundColor Cyan
}

function Print-Ok($text) {
    Write-Host "  ✓ $text" -ForegroundColor Green
}

function Print-Error($text) {
    Write-Host "  ✗ $text" -ForegroundColor Red
}

function Print-Warn($text) {
    Write-Host "  ⚠ $text" -ForegroundColor Yellow
}

function Print-Info($text) {
    Write-Host "  $text" -ForegroundColor Gray
}

# 远程命令片段里嵌路径：只放行严格字符集，杜绝引号 / 展开 / 命令分隔符注入。
# 与 build-hg-binaries.sh 的同名校验保持一致口径，避免"ps1 能跑、sh 报错"。
# 本脚本据此在拼远程命令时不做额外引号包裹（PowerShell 5.1 向原生命令传递嵌套双引号
# 本身就不可靠），所以这条校验是唯一防线，不能放宽。
function Test-ShellSafePath([string]$p) {
    return ($p -match '^[A-Za-z0-9_./-]+$')
}

function Get-Sha256([string]$path) {
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower()
}

function Get-FileSize([string]$path) {
    return (Get-Item -LiteralPath $path).Length
}

# JSON 字符串转义（只需处理反斜杠与双引号；本脚本写入的值不含控制字符）
function ConvertTo-JsonString([string]$s) {
    return $s.Replace('\', '\\').Replace('"', '\"')
}

# 原生命令退出码断言：PowerShell 不会替你判 exe 退出码，每个外部命令后必须显式查一次。
# 故意不做成"接 scriptblock 代跑"的封装 —— PowerShell 的 scriptblock 是动态作用域，
# 跨函数调用时变量解析靠调用栈，读起来比直接判 $LASTEXITCODE 更容易出错。
function Assert-LastExit([string]$What) {
    if ($LASTEXITCODE -ne 0) {
        Print-Error "$What 失败 (exit=$LASTEXITCODE)"
        Remove-TmpDir
        exit 1
    }
}

# ---- 产物形态断言：产物必须真能在目标平台上跑 ----------------------------------
#
# 这两条断言存在的理由，就是本脚本要根治的那类故障：构建"成功"了、替换"成功"了、
# sha 也对得上，但产物在目标机器上根本起不来（架构不符 / 平台不符），而链路上没有
# 任何一步会报错。所以在替换进落点之前，必须直接对二进制本体验一次形态。

# 断言 macOS 产物架构与 App 的 macOS 发布目标一致（产物在构建机上，经 ssh 远程验）
function Assert-MacArch {
    param([string]$Target, [string]$RemotePath)

    # lipo -archs 对 thin 二进制输出 "arm64"，对 universal 输出 "arm64 x86_64"。
    # 这里做**恰好相等**判定而不是"包含"：universal 也要中止 —— 那说明发布目标变了，
    # 需要人来重新决策（守护进程该不该也跟着变 universal），不能由脚本默默放行。
    $archsRaw = (ssh -o BatchMode=yes $Target "bash -lc 'lipo -archs $RemotePath'")
    $archs = ((@($archsRaw) -join ' ') -replace '\s+', ' ').Trim()
    if (-not $archs) {
        Print-Error "lipo -archs 读不出架构，产物可能不是 Mach-O: $RemotePath"
        return $false
    }
    if ($archs -ne $ExpectedMacArch) {
        Print-Error "守护进程架构 $archs 与 App macOS 产物目标架构 $ExpectedMacArch 不一致 —— 装到该架构的 Mac 上守护进程起不来，发布中止。"
        Print-Error "若产品线要覆盖 Intel Mac，需改为 universal2（lipo -create 合 arm64 + x86_64）并同步改本断言。"
        return $false
    }

    $fileRaw = (ssh -o BatchMode=yes $Target "bash -lc 'file -b $RemotePath'")
    $fileOut = ((@($fileRaw) -join ' ')).Trim()
    if ($fileOut -notmatch 'Mach-O' -or $fileOut -notmatch [regex]::Escape($ExpectedMacArch)) {
        Print-Error "file 判定与预期不符（应含 Mach-O 与 $($ExpectedMacArch)）: $fileOut"
        return $false
    }

    # $(...) 显式定界不是多余的：变量名后紧跟中文全角字符时，sh 版实测过 bash 会把该字符
    # 首字节吞进变量名、值静默变空。PowerShell 的分词规则不同（全角括号不是标识符字符），
    # 但本机无 PowerShell 可实测，故按无歧义写法落地。
    Print-Ok "架构断言通过: $($archs)（$($fileOut)）"
    return $true
}

# 读 PE 头的 machine 与可选头 magic。Windows 上没有 file(1)，直接读字节。
# BinaryReader 是小端读取，与 PE 头字节序一致。
function Get-PeInfo([string]$path) {
    $fs = [System.IO.File]::OpenRead($path)
    try {
        if ($fs.Length -lt 0x40) { return $null }
        $br = New-Object System.IO.BinaryReader($fs)
        $fs.Position = 0x3c
        $lfanew = [int]$br.ReadUInt32()
        # COFF header 20 字节 + 可选头 magic 2 字节 => 至少要到 lfanew+26
        if ($lfanew -lt 0 -or ($lfanew + 26) -gt $fs.Length) { return $null }
        $fs.Position = $lfanew
        $sig = $br.ReadBytes(4)
        if ($sig[0] -ne 0x50 -or $sig[1] -ne 0x45 -or $sig[2] -ne 0 -or $sig[3] -ne 0) { return $null }
        $machine = $br.ReadUInt16()
        $fs.Position = $lfanew + 24
        $magic = $br.ReadUInt16()
        return [PSCustomObject]@{ Machine = $machine; Magic = $magic }
    } finally {
        $fs.Dispose()
    }
}

# 断言 Windows 产物是 PE32+ x86-64
function Assert-WinPe([string]$path) {
    $pe = Get-PeInfo $path
    if ($null -eq $pe) {
        Print-Error "PE 头解析失败（不是合法 PE 文件）: $path"
        return $false
    }
    if ($pe.Machine -ne 0x8664) {
        Print-Error "Windows 产物 PE machine 不是 x86-64 —— 装到目标机上服务起不来，发布中止。"
        Print-Error ("machine=0x{0:x4}（期望 0x8664）" -f $pe.Machine)
        return $false
    }
    if ($pe.Magic -ne 0x20b) {
        Print-Error "Windows 产物不是 PE32+（64 位可选头）—— 发布中止。"
        Print-Error ("optional header magic=0x{0:x3}（期望 0x20b）" -f $pe.Magic)
        return $false
    }
    Print-Ok ("PE 断言通过: PE32+ x86-64 (machine=0x{0:x4}, magic=0x{1:x3})" -f $pe.Machine, $pe.Magic)
    return $true
}

# 泄露扫描模式：构建机路径 + RFC1918 私网地址
# 注意：这里的点号都是转义写法（\.），本文件本身不含任何字面私网地址
$LeakPatterns = @(
    '/Users/',
    '/home/[a-z]',
    'C:\\Users',
    '(?<![0-9.])(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]{1,3}\.[0-9]{1,3}'
)

# 二进制里没有 strings 可用，改为整文件读字节 → latin1 解码成字符串 → 正则匹配。
# latin1 是字节↔字符一一对应的编码，不会像 UTF-8 那样在非法序列上丢字节。
function Get-LeakHits {
    param([string]$Path, [int]$Max = 20)

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $text  = [System.Text.Encoding]::GetEncoding('iso-8859-1').GetString($bytes)

    $hits = New-Object System.Collections.ArrayList
    foreach ($pat in $LeakPatterns) {
        foreach ($m in [regex]::Matches($text, $pat)) {
            # 取命中处前后一小段并把不可打印字节替换成 '.'，便于人工判读
            $start = [Math]::Max(0, $m.Index - 24)
            $len   = [Math]::Min($text.Length - $start, $m.Length + 48)
            $ctx   = $text.Substring($start, $len)
            $ctx   = [regex]::Replace($ctx, '[^\x20-\x7E]', '.')
            [void]$hits.Add($ctx)
            if ($hits.Count -ge $Max) { return $hits.ToArray() }
        }
    }
    return $hits.ToArray()
}

# 把本地源码树同步到远程构建机（含未提交改动），保证构建源就是本仓当前代码。
# rsync 在 Windows 上不一定有，缺席时退回 tar 打包 + scp + 远程重建目录（等价 --delete）。
function Sync-SourceToHost {
    param([string]$Target, [string]$RemoteDir)

    $rsync = Get-Command rsync -ErrorAction SilentlyContinue
    if ($rsync) {
        Print-Info "同步源码到构建宿主 (rsync)..."
        rsync -az --delete --exclude 'target/' --exclude '.git/' `
            -e "ssh -o BatchMode=yes" `
            "$HgRepo/" "${Target}:${RemoteDir}/"
        Assert-LastExit "rsync 同步源码"
        return
    }

    $tar = Get-Command tar -ErrorAction SilentlyContinue
    if (-not $tar) {
        Print-Error "既无 rsync 也无 tar，无法把源码同步到构建宿主"
        Print-Info "Windows 10 1803+ 自带 tar.exe；或安装 rsync (Git for Windows / MSYS2) 后重跑"
        Remove-TmpDir
        exit 1
    }

    # tar 兜底路径：打包当前工作树（不是 git archive HEAD）—— 否则未提交改动会被静默丢掉，
    # 远程构建的就不是"本仓当前代码"了。远程先 rm -rf 再解，等价 rsync --delete。
    Print-Info "同步源码到构建宿主 (tar + scp，rsync 缺席)..."
    $localTgz = Join-Path $TmpDir "hg-src.tgz"
    tar -czf $localTgz -C $HgRepo --exclude=./target --exclude=./.git .
    Assert-LastExit "tar 打包源码"

    $remoteTgz = "$RemoteDir.src.tgz"
    scp -o BatchMode=yes $localTgz "${Target}:${remoteTgz}"
    Assert-LastExit "scp 上传源码包"

    ssh -o BatchMode=yes $Target "bash -lc 'rm -rf $RemoteDir && mkdir -p $RemoteDir && tar -xzf $remoteTgz -C $RemoteDir && rm -f $remoteTgz'"
    Assert-LastExit "远程重建构建树"

    Remove-Item -LiteralPath $localTgz -Force -ErrorAction SilentlyContinue
}

# ============================================
# 临时目录：远程产物落地用，退出时清掉
# ============================================
$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("hg-build-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null

function Remove-TmpDir {
    if (Test-Path $TmpDir) { Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue }
}

# ============================================
# 产物登记表
# ============================================
$Artifacts = New-Object System.Collections.ArrayList

Print-Header "HuanvaeGuard 守护进程二进制构建"

# ============================================
# 步骤 1: 校验 HuanvaeGuard 源码仓
# ============================================
Print-Step "1/7" "校验 HuanvaeGuard 源码仓..."

if (-not (Test-Path -LiteralPath $HgRepo -PathType Container)) {
    Print-Error "HG_REPO 不存在: $HgRepo"
    Write-Host ""
    Write-Host "  设置源码仓路径后重跑：`$env:HG_REPO='C:\path\to\HuanvaeGuard'; .\scripts\build-hg-binaries.ps1" -ForegroundColor Yellow
    Remove-TmpDir
    exit 1
}

$HgRepo = (Resolve-Path -LiteralPath $HgRepo).Path

git -C $HgRepo rev-parse --git-dir 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Print-Error "HG_REPO 不是 git 仓库: $HgRepo"
    Remove-TmpDir
    exit 1
}

$SrcCommitRaw = git -C $HgRepo rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or -not $SrcCommitRaw) {
    Print-Error "读不到 HEAD commit: $HgRepo"
    Remove-TmpDir
    exit 1
}
$SrcCommit = ([string]$SrcCommitRaw).Trim()
Print-Ok "源码仓: $HgRepo"
Print-Info "HEAD commit: $SrcCommit"

$DirtyRaw = @(git -C $HgRepo diff --name-only HEAD)
$DirtyFiles = @($DirtyRaw | Where-Object { $_ -and $_.Trim() } | Select-Object -First 10)
$SrcDirty = ($DirtyFiles.Count -gt 0)

if ($SrcDirty) {
    Print-Warn "源码仓有未提交改动（dirty）—— 构建产物无法由 commit 复现"
    foreach ($f in $DirtyFiles) {
        Write-Host "    $f" -ForegroundColor Yellow
    }
    Print-Info "（以上为前 10 行；完整清单见 git -C <HG_REPO> diff --name-only HEAD）"
} else {
    Print-Ok "源码仓干净（产物可由 commit 复现）"
}

# ============================================
# 步骤 2: 构建 Windows 守护进程（本机）
# ============================================
Print-Step "2/7" "构建 Windows 守护进程 (hg-windows)..."

if ($env:OS -ne 'Windows_NT') {
    Print-Error "Windows 产物必须在 Windows 上构建，当前宿主不是 Windows"
    Write-Host ""
    Write-Host "  macOS 宿主请改用 scripts/build-hg-binaries.sh（它会 ssh 到 Windows 构建机产出 hg-windows.exe）" -ForegroundColor Yellow
    Remove-TmpDir
    exit 1
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Print-Error "找不到 cargo，无法构建 Windows 产物"
    Remove-TmpDir
    exit 1
}

Print-Info "cargo build --release -p hg-windows --target $ExpectedWinTriple ..."
Push-Location $HgRepo
cargo build --release -p hg-windows --target $ExpectedWinTriple
$cargoExit = $LASTEXITCODE
Pop-Location

if ($cargoExit -ne 0) {
    Print-Error "cargo build -p hg-windows 失败 (exit=$cargoExit)"
    Remove-TmpDir
    exit 1
}

$WinArt = Join-Path $HgRepo "target\$ExpectedWinTriple\release\hg-windows.exe"
if (-not (Test-Path -LiteralPath $WinArt -PathType Leaf)) {
    Print-Error "构建声称成功但产物不存在: $WinArt"
    Remove-TmpDir
    exit 1
}
Print-Ok "构建完成: $WinArt"

# --- PE 断言（替换进落点之前）---
if (-not (Assert-WinPe $WinArt)) {
    Remove-TmpDir
    exit 1
}

[void]$Artifacts.Add([PSCustomObject]@{
    Src           = $WinArt
    DestRel       = $WinDestRel
    DestRelJson   = $WinDestRelJson
    Crate         = "hg-windows"
    Target        = $ExpectedWinTriple
    CodesignFlags = ""
    Arch          = ""
    PeMachine     = "x86-64"
    Sha           = ""
})

# ============================================
# 步骤 3: 构建 macOS 守护进程（远程构建机）
# ============================================
Print-Step "3/7" "构建 macOS 守护进程 (hg-macos)..."

$MacBuilt = $false

if ($env:HG_SKIP_MACOS -eq '1') {
    Print-Warn "HG_SKIP_MACOS=1：跳过 macOS 产物构建"
    Print-Warn "跳过 ≠ 通过：本次不产出 hg-macos，manifest 也不含它，禁止据此发布"
} else {
    if (-not $MacBuildHost) {
        Print-Error "未设置 HG_MAC_BUILD_HOST：本机无法构建 macOS 产物，发布中止"
        Write-Host ""
        Write-Host "  macOS 产物必须在 macOS 构建宿主上产出。设置 ssh 目标后重跑：" -ForegroundColor Yellow
        Write-Host "    `$env:HG_MAC_BUILD_HOST='user@host'; .\scripts\build-hg-binaries.ps1" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  （仅排障可用 `$env:HG_SKIP_MACOS='1' 跳过，但这样产出的结果不许发布）" -ForegroundColor Gray
        Remove-TmpDir
        exit 1
    }

    if (-not (Test-ShellSafePath $MacBuildDir)) {
        Print-Error "HG_MAC_BUILD_DIR 含远程命令不安全的字符，拒绝执行: $MacBuildDir"
        Print-Info "只放行 [A-Za-z0-9_./-]"
        Remove-TmpDir
        exit 1
    }

    Print-Info "构建宿主: <HG_MAC_BUILD_HOST>（不落盘、不入日志）"
    Print-Info "构建树:   $MacBuildDir"

    # 3.1 同步源码：确保远程构建源就是本仓当前代码（含未提交改动）
    Sync-SourceToHost -Target $MacBuildHost -RemoteDir $MacBuildDir
    Print-Ok "源码同步完成"

    $MacArtRemote = "$MacBuildDir/target/release/hg-macos"

    # 3.2 远程构建
    Print-Info "远程 cargo build --release -p hg-macos ..."
    ssh -o BatchMode=yes $MacBuildHost "bash -lc 'cd $MacBuildDir && cargo build --release -p hg-macos'"
    Assert-LastExit "远程 cargo build -p hg-macos"
    Print-Ok "远程构建完成"

    # 3.3 远程显式重签（已定位的故障根因之一：linker-signed 产物 launchd 可能拒绝加载）
    $csBefore = (ssh -o BatchMode=yes $MacBuildHost "bash -lc 'codesign -dv --verbose=4 $MacArtRemote 2>&1 | grep flags= | head -1'")
    if ($csBefore) { $csBefore = ([string]$csBefore).Trim() } else { $csBefore = "" }
    Print-Info "重签前 codesign: $(if ($csBefore) { $csBefore } else { '<无签名信息>' })"

    ssh -o BatchMode=yes $MacBuildHost "bash -lc 'codesign -f -s - $MacArtRemote'"
    Assert-LastExit "远程 codesign 重签"

    $csAfter = (ssh -o BatchMode=yes $MacBuildHost "bash -lc 'codesign -dv --verbose=4 $MacArtRemote 2>&1 | grep flags= | head -1'")
    if ($csAfter) { $csAfter = ([string]$csAfter).Trim() } else { $csAfter = "" }
    Print-Info "重签后 codesign: $(if ($csAfter) { $csAfter } else { '<无签名信息>' })"

    if (-not $csAfter) {
        Print-Error "重签后读不到 codesign flags 行，无法确认签名形态"
        Remove-TmpDir
        exit 1
    }
    if ($csAfter -notmatch 'adhoc') {
        Print-Error "重签后 flags 不含 adhoc —— 签名形态不符合预期"
        Write-Host "    $csAfter" -ForegroundColor Red
        Remove-TmpDir
        exit 1
    }
    if ($csAfter -match 'linker-signed') {
        Print-Error "重签后 flags 仍含 linker-signed —— launchd 可能拒绝加载该产物"
        Write-Host "    $csAfter" -ForegroundColor Red
        Remove-TmpDir
        exit 1
    }
    Print-Ok "签名校验通过: adhoc 且非 linker-signed"

    # --- 架构断言（替换进落点之前；产物在构建机上，经 ssh 远程验）---
    if (-not (Assert-MacArch -Target $MacBuildHost -RemotePath $MacArtRemote)) {
        Remove-TmpDir
        exit 1
    }

    # 3.4 取回构建机的 rustc host triple（manifest 用），再取回产物
    $macTripleLine = (ssh -o BatchMode=yes $MacBuildHost "bash -lc 'rustc -vV | grep ^host:'")
    $MacTriple = ""
    if ($macTripleLine) { $MacTriple = ([string]$macTripleLine).Trim() -replace '^host:\s*', '' }
    if (-not $MacTriple) {
        Print-Error "读不到构建机的 rustc host triple"
        Remove-TmpDir
        exit 1
    }
    Print-Info "构建机 rustc host triple: $MacTriple"

    $MacArtLocal = Join-Path $TmpDir "hg-macos"
    scp -o BatchMode=yes "${MacBuildHost}:${MacArtRemote}" $MacArtLocal
    Assert-LastExit "scp 取回 hg-macos"
    if (-not (Test-Path -LiteralPath $MacArtLocal -PathType Leaf)) {
        Print-Error "scp 声称成功但本地产物不存在: $MacArtLocal"
        Remove-TmpDir
        exit 1
    }
    Print-Ok "产物已取回: $(Get-FileSize $MacArtLocal) bytes"

    [void]$Artifacts.Add([PSCustomObject]@{
        Src           = $MacArtLocal
        DestRel       = $MacDestRel
        DestRelJson   = $MacDestRelJson
        Crate         = "hg-macos"
        Target        = $MacTriple
        CodesignFlags = $csAfter
        Arch          = $ExpectedMacArch
        PeMachine     = ""
        Sha           = ""
    })
    $MacBuilt = $true
}

# ============================================
# 步骤 4: 替换落点 + sha256 校验
# ============================================
Print-Step "4/7" "替换落点并校验 sha256..."

foreach ($a in $Artifacts) {
    $dest = Join-Path $ProjectRoot $a.DestRel

    $srcSha = Get-Sha256 $a.Src

    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $a.Src -Destination $dest -Force

    # 重算落点文件的 sha —— 防"以为替换了其实没替换"
    $destSha = Get-Sha256 $dest

    if ($srcSha -ne $destSha) {
        Print-Error "替换后 sha256 不一致: $($a.DestRel)"
        Write-Host "    源产物: $srcSha" -ForegroundColor Red
        Write-Host "    落点:   $destSha" -ForegroundColor Red
        Remove-TmpDir
        exit 1
    }

    $a.Sha = $destSha
    Print-Ok "$($a.DestRel)  sha256=$destSha"
}

# ============================================
# 步骤 5: 泄露扫描（PUBLIC 仓）
# ============================================
Print-Step "5/7" "泄露扫描（构建机路径 / 私网地址）..."

$LeakFailed = $false
foreach ($a in $Artifacts) {
    $dest = Join-Path $ProjectRoot $a.DestRel
    $hits = @(Get-LeakHits -Path $dest)

    if ($hits.Count -gt 0) {
        Print-Error "命中泄露特征: $($a.DestRel)"
        foreach ($h in $hits) {
            Write-Host "    $h" -ForegroundColor Red
        }
        $LeakFailed = $true
    } else {
        Print-Ok "$($a.DestRel)  未命中"
    }
}

if ($LeakFailed) {
    Write-Host ""
    Print-Error "泄露扫描命中 —— 本仓是 PUBLIC 公开仓，禁止提交 / 发布该产物"
    Write-Host "  排查方向：HuanvaeGuard 仓 .cargo/config.toml 的 --remap-path-prefix 是否覆盖了本次构建机的 home 根，" -ForegroundColor Yellow
    Write-Host "  以及是否有环境变量 RUSTFLAGS 把仓内配置整体覆盖掉了。" -ForegroundColor Yellow
    Remove-TmpDir
    exit 1
}

# ============================================
# 步骤 6: 写 manifest
# ============================================
Print-Step "6/7" "写 build manifest..."

$BuiltAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$ManifestPath = Join-Path $ProjectRoot $ManifestRel

# 手写 JSON：PowerShell 5.1 的 ConvertTo-Json 会把单元素数组降成标量，
# 手写才能保证 schema 稳定（dirty_files / artifacts 恒为数组）。
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("{")
[void]$sb.AppendLine("  ""source_repo_commit"": ""$(ConvertTo-JsonString $SrcCommit)"",")
[void]$sb.AppendLine("  ""source_repo_dirty"": $(if ($SrcDirty) { 'true' } else { 'false' }),")

if ($DirtyFiles.Count -eq 0) {
    [void]$sb.AppendLine("  ""source_repo_dirty_files"": [],")
} else {
    [void]$sb.AppendLine("  ""source_repo_dirty_files"": [")
    for ($j = 0; $j -lt $DirtyFiles.Count; $j++) {
        $sep = ","
        if ($j -eq $DirtyFiles.Count - 1) { $sep = "" }
        [void]$sb.AppendLine("    ""$(ConvertTo-JsonString ($DirtyFiles[$j]))""$sep")
    }
    [void]$sb.AppendLine("  ],")
}

[void]$sb.AppendLine("  ""built_at_utc"": ""$BuiltAt"",")
[void]$sb.AppendLine("  ""artifacts"": [")
for ($i = 0; $i -lt $Artifacts.Count; $i++) {
    $a = $Artifacts[$i]
    $sep = ","
    if ($i -eq $Artifacts.Count - 1) { $sep = "" }
    [void]$sb.AppendLine("    {")
    [void]$sb.AppendLine("      ""path"": ""$(ConvertTo-JsonString ($a.DestRelJson))"",")
    [void]$sb.AppendLine("      ""crate"": ""$(ConvertTo-JsonString ($a.Crate))"",")
    [void]$sb.AppendLine("      ""target"": ""$(ConvertTo-JsonString ($a.Target))"",")
    # 产物形态实测值：macOS 记 arch，Windows 记 pe_machine（各自只有一个有值）
    if ($a.Arch) {
        [void]$sb.AppendLine("      ""arch"": ""$(ConvertTo-JsonString ($a.Arch))"",")
    }
    if ($a.PeMachine) {
        [void]$sb.AppendLine("      ""pe_machine"": ""$(ConvertTo-JsonString ($a.PeMachine))"",")
    }
    if ($a.CodesignFlags) {
        [void]$sb.AppendLine("      ""sha256"": ""$(ConvertTo-JsonString ($a.Sha))"",")
        [void]$sb.AppendLine("      ""codesign_flags"": ""$(ConvertTo-JsonString ($a.CodesignFlags))""")
    } else {
        [void]$sb.AppendLine("      ""sha256"": ""$(ConvertTo-JsonString ($a.Sha))""")
    }
    [void]$sb.AppendLine("    }$sep")
}
[void]$sb.AppendLine("  ]")
[void]$sb.AppendLine("}")

[System.IO.File]::WriteAllText($ManifestPath, $sb.ToString(), $Utf8NoBom)

Print-Ok $ManifestRel
Print-Info "（manifest 只记 commit / 产物 / 签名形态，不含任何主机名、IP、用户名）"

if (-not $MacBuilt) {
    Print-Warn "本次未构建 macOS 产物，manifest 的 artifacts 不完整"
}

# ============================================
# 步骤 7: 汇总
# ============================================
Print-Header "构建完成"

Write-Host ""
Write-Host "  来源 commit: $SrcCommit" -ForegroundColor White
if ($SrcDirty) {
    Write-Host "  来源状态:   dirty（有未提交改动，产物不可由 commit 复现）" -ForegroundColor Yellow
} else {
    Write-Host "  来源状态:   clean" -ForegroundColor Gray
}
Write-Host "  构建时间:   $BuiltAt" -ForegroundColor Gray
Write-Host ""

foreach ($a in $Artifacts) {
    $dest = Join-Path $ProjectRoot $a.DestRel
    Write-Host "  $($a.DestRel)" -ForegroundColor White
    Write-Host "    crate:  $($a.Crate)  ($($a.Target))" -ForegroundColor Gray
    Write-Host "    大小:   $(Get-FileSize $dest) bytes" -ForegroundColor Gray
    Write-Host "    sha256: $($a.Sha)" -ForegroundColor Gray
    if ($a.Arch) {
        Write-Host "    架构:   $($a.Arch)" -ForegroundColor Gray
    }
    if ($a.PeMachine) {
        Write-Host "    PE:     PE32+ $($a.PeMachine)" -ForegroundColor Gray
    }
    if ($a.CodesignFlags) {
        Write-Host "    签名:   $($a.CodesignFlags)" -ForegroundColor Gray
    }
    Write-Host ""
}

if (-not $MacBuilt) {
    Print-Warn "macOS 产物未构建 —— 本次结果不可用于发布"
    Write-Host ""
}

Write-Host "  manifest: $ManifestRel" -ForegroundColor Cyan
Write-Host ""

Remove-TmpDir
exit 0
