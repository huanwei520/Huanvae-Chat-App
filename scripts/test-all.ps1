# Huanvae Chat App 完整测试脚本 (Windows)
#
# 功能：
#   运行所有代码质量检查，要求 0 errors, 0 warnings
#   - 后端: cargo clippy (严格模式，禁止任何警告)
#   - 前端: TypeScript + ESLint + 构建测试
#
# 使用方法：
#   .\scripts\test-all.ps1
#   .\scripts\test-all.ps1 -SkipRust       # 跳过 Rust 检查（cargo check / clippy / cargo test）
#   .\scripts\test-all.ps1 -SkipAndroid    # 跳过 Android clippy 检查
#   .\scripts\test-all.ps1 -SkipVpn        # 跳过 VPN 连通性测试
#
# SKIP 不等于 PASS：
#   任何被跳过的检查项（参数显式跳过、或运行期环境缺失如 NDK/target 未装）都会进入
#   跳过登记表，末尾如实列出。只要存在跳过项，就不会打印"所有检查通过!"。
#
#   $env:ALLOW_SKIP  显式放行跳过项（逗号或空格分隔的 id 列表；特殊值 all 放行全部）
#     可用 id: cargo-check / clippy-desktop / clippy-android / cargo-test / vpn-connectivity
#     例: $env:ALLOW_SKIP='clippy-android'; .\scripts\test-all.ps1
#
# 退出码：
#   0  全部真跑通过；或有跳过项但已被 ALLOW_SKIP 显式放行
#   1  有检查项 FAIL
#   2  有检查项被跳过且未显式放行（不视为通过）

param(
    [switch]$SkipRust,
    [switch]$SkipAndroid,
    [switch]$SkipVpn
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

$env:Path = "$env:LOCALAPPDATA\pnpm;$env:Path"

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  Huanvae Chat - 代码质量检查" -ForegroundColor Magenta
Write-Host "  要求: 0 errors, 0 warnings" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

$startTime = Get-Date
$allPassed = $true

# 跳过登记表：SKIP 不等于 PASS，末尾汇总要如实列出跳了哪几项、为什么跳
$skipped = @()

function Record-Skip {
    param([string]$Id, [string]$Reason)
    $script:skipped += [PSCustomObject]@{ Id = $Id; Reason = $Reason }
    Write-Host "  ⚠ SKIP: $Reason" -ForegroundColor Yellow
}

# 步骤计数：恒定 6 块（NSIS / package.json / TypeScript / ESLint / 单元测试 / 前端构建）
# + 未跳过 VPN 时 +1（VPN 连通性）
# + 未跳过 Rust 时 +3（cargo check、clippy 桌面、cargo test）+ 未跳过 Android 时再 +1（clippy Android）
$script:totalSteps = 6
if (-not $SkipVpn) { $script:totalSteps += 1 }
if (-not $SkipRust) {
    $script:totalSteps += 3
    if (-not $SkipAndroid) { $script:totalSteps += 1 }
}

$script:step = 0
function Step-Header([string]$Title) {
    $script:step++
    Write-Host "[$script:step/$script:totalSteps] $Title" -ForegroundColor Cyan
}

# 参数显式跳过的项也要登记（否则末尾会把"没跑"当成"跑过且通过"）
if ($SkipRust) {
    $script:skipped += [PSCustomObject]@{ Id = 'cargo-check';    Reason = '-SkipRust 参数显式跳过 cargo check' }
    $script:skipped += [PSCustomObject]@{ Id = 'clippy-desktop'; Reason = '-SkipRust 参数显式跳过 cargo clippy 桌面端' }
    $script:skipped += [PSCustomObject]@{ Id = 'clippy-android'; Reason = '-SkipRust 参数显式跳过 cargo clippy Android' }
    $script:skipped += [PSCustomObject]@{ Id = 'cargo-test';     Reason = '-SkipRust 参数显式跳过 cargo test' }
} elseif ($SkipAndroid) {
    $script:skipped += [PSCustomObject]@{ Id = 'clippy-android'; Reason = '-SkipAndroid 参数显式跳过 cargo clippy Android' }
}
if ($SkipVpn) {
    $script:skipped += [PSCustomObject]@{ Id = 'vpn-connectivity'; Reason = '-SkipVpn 参数显式跳过 VPN 连通性测试' }
}

# ============================================
# 1. Windows NSIS 安装配置检查
# ============================================
Step-Header "Windows NSIS 安装配置检查..."

$tauriConfPath = "$projectRoot\src-tauri\tauri.conf.json"
$nsisHooksPath = "$projectRoot\src-tauri\windows\hooks.nsi"
$tauriContent = Get-Content $tauriConfPath -Raw

if ($tauriContent -match '"nsis"') {
    Write-Host "  ✓ PASS: 使用 NSIS 安装包配置" -ForegroundColor Green

    if ($tauriContent -match '"installerHooks"') {
        Write-Host "  ✓ PASS: 配置了 NSIS 自定义 installerHooks" -ForegroundColor Green

        if (Test-Path $nsisHooksPath) {
            Write-Host "  ✓ PASS: NSIS hooks.nsi 文件存在" -ForegroundColor Green
        } else {
            Write-Host "  ✗ FAIL: NSIS hooks.nsi 文件不存在" -ForegroundColor Red
            $allPassed = $false
        }
    } else {
        Write-Host "  ✗ FAIL: 未配置 NSIS installerHooks（使用默认模板）" -ForegroundColor Red
        $allPassed = $false
    }
} else {
    Write-Host "  ⚠ WARN: 未检测到 NSIS 安装包配置" -ForegroundColor Yellow
}

if ($tauriContent -match '"installMode".*"passive"') {
    Write-Host "  ✓ PASS: 更新器配置为静默安装模式" -ForegroundColor Green
} else {
    Write-Host "  ⚠ WARN: 更新器未配置 installMode: passive" -ForegroundColor Yellow
}

# ============================================
# 2. package.json 验证
# ============================================
Step-Header "package.json 验证..."

$jsonCheckScript = @"
const fs = require('fs');
const content = fs.readFileSync('package.json', 'utf8');
const lines = content.split('\n');
const keyCount = {};
const keyRegex = /^\s*"([^"]+)"\s*:/;
lines.forEach((line, idx) => {
  const match = line.match(keyRegex);
  if (match) {
    const key = match[1];
    if (!keyCount[key]) keyCount[key] = [];
    keyCount[key].push(idx + 1);
  }
});
const duplicates = Object.entries(keyCount).filter(([k, v]) => v.length > 1);
if (duplicates.length > 0) {
  duplicates.forEach(([key, lines]) => {
    console.error('重复键 "' + key + '" 在行: ' + lines.join(', '));
  });
  process.exit(1);
}
try {
  JSON.parse(content);
  console.log('JSON 格式正确');
} catch(e) {
  console.error('JSON 格式错误: ' + e.message);
  process.exit(1);
}
"@
$validateResult = $jsonCheckScript | node 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ PASS: package.json 验证" -ForegroundColor Green
} else {
    Write-Host "  ✗ FAIL: package.json 验证" -ForegroundColor Red
    Write-Host "  $($validateResult.Trim())" -ForegroundColor Red
    $allPassed = $false
}

# ============================================
# 3. TypeScript 类型检查
# ============================================
Step-Header "TypeScript 类型检查..."

pnpm tsc --noEmit 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ PASS: TypeScript" -ForegroundColor Green
} else {
    Write-Host "  ✗ FAIL: TypeScript 类型检查" -ForegroundColor Red
    $allPassed = $false
}

# ============================================
# 4. ESLint 代码检查 (严格模式)
# ============================================
Step-Header "ESLint 代码检查 (0 errors, 0 warnings)..."

$eslintOutput = pnpm lint 2>&1 | Out-String
$eslintExit = $LASTEXITCODE

if ($eslintExit -eq 0) {
    if ($eslintOutput -match "warning") {
        Write-Host "  ✗ FAIL: ESLint 存在警告" -ForegroundColor Red
        ($eslintOutput -split "`n") | Where-Object { $_ -match "(warning|error)" } | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }
        $allPassed = $false
    } else {
        Write-Host "  ✓ PASS: ESLint (0 errors, 0 warnings)" -ForegroundColor Green
    }
} else {
    Write-Host "  ✗ FAIL: ESLint" -ForegroundColor Red
    ($eslintOutput -split "`n") | Where-Object { $_ -match "(error|warning)" } | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }
    $allPassed = $false
}

# ============================================
# 5. 单元测试
# ============================================
Step-Header "单元测试..."

$testOutput = pnpm test --run 2>&1 | Out-String
$testExit = $LASTEXITCODE

if ($testExit -eq 0) {
    if ($testOutput -match "(\d+) passed") {
        Write-Host "  ✓ PASS: 单元测试 ($($Matches[1]) 个测试)" -ForegroundColor Green
    } else {
        Write-Host "  ✓ PASS: 单元测试" -ForegroundColor Green
    }
} else {
    Write-Host "  ✗ FAIL: 单元测试" -ForegroundColor Red
    ($testOutput -split "`n") | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
    $allPassed = $false
}

# ============================================
# 6. 前端构建测试 (检查警告)
# ============================================
Step-Header "前端构建测试 (检查警告)..."

$buildOutput = pnpm build 2>&1 | Out-String
$buildExit = $LASTEXITCODE

if ($buildExit -eq 0) {
    if ($buildOutput -match "\[plugin vite:reporter\]") {
        # PowerShell 的 2>&1 会将 stderr 包装为 ErrorRecord，先清理格式化噪音
        $cleanBuild = $buildOutput `
            -replace '(?m)^所在位置.*$', '' `
            -replace '(?m)^\+\s+&.*$', '' `
            -replace '(?m)^\+\s+~+.*$', '' `
            -replace '(?m)^\s+\+ CategoryInfo.*$', '' `
            -replace '(?m)^\s+\+ FullyQualifiedErrorId.*$', '' `
            -replace '(?m)^.*:String\).*RemoteException.*$', '' `
            -replace '(?m)^.*NativeCommandError.*$', ''
        # 将清理后的文本按 [plugin vite:reporter] 分段，逐段检查
        $viteBlocks = $cleanBuild -split "\[plugin vite:reporter\]" | Select-Object -Skip 1
        $hasNonDynamic = $false
        foreach ($block in $viteBlocks) {
            $trimmed = $block.Trim()
            if ($trimmed.Length -gt 5 -and $trimmed -notmatch "dynamic import" -and $trimmed -notmatch "dynamically imported") {
                $hasNonDynamic = $true
            }
        }
        if (-not $hasNonDynamic) {
            Write-Host "  ✓ PASS: 前端构建 (仅有无害的动态导入优化提示)" -ForegroundColor Green
        } else {
            Write-Host "  ✗ FAIL: 构建存在 Vite 警告" -ForegroundColor Red
            $allPassed = $false
        }
    } else {
        $buildWarnings = ($buildOutput -split "`n") | Where-Object { $_ -match "^(warning|warn):" -and $_ -notmatch "node_modules" }
        if ($buildWarnings) {
            Write-Host "  ✗ FAIL: 构建存在警告" -ForegroundColor Red
            $buildWarnings | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" }
            $allPassed = $false
        } else {
            Write-Host "  ✓ PASS: 前端构建 (0 warnings)" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  ✗ FAIL: 前端构建" -ForegroundColor Red
    ($buildOutput -split "`n") | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
    $allPassed = $false
}

# ============================================
# 7. Cargo Check (基础编译检查)
# ============================================
if (-not $SkipRust) {
    Step-Header "Cargo check (编译检查)..."

    Push-Location "$projectRoot\src-tauri"

    $cargoCheckOutput = cargo check --message-format=short 2>&1 | Out-String
    $cargoCheckExit = $LASTEXITCODE

    if ($cargoCheckOutput -match "^error") {
        Write-Host "  ✗ FAIL: Cargo check" -ForegroundColor Red
        $allPassed = $false
    } else {
        $cargoWarnings = ($cargoCheckOutput -split "`n") | Where-Object { $_ -match "^warning:" -and $_ -notmatch "warning: build failed" }
        if ($cargoWarnings) {
            Write-Host "  ✗ FAIL: Cargo check 存在警告" -ForegroundColor Red
            $cargoWarnings | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" }
            $allPassed = $false
        } else {
            Write-Host "  ✓ PASS: Cargo check" -ForegroundColor Green
        }
    }

    Pop-Location
}

# ============================================
# 8. Cargo Clippy (代码审查 - 严格模式)
# ============================================
if (-not $SkipRust) {
    Step-Header "Cargo clippy 桌面端 (代码审查 - 禁止警告)..."

    Push-Location "$projectRoot\src-tauri"

    $clippyOutput = cargo clippy --all-targets --all-features -- -D warnings 2>&1 | Out-String
    $clippyExit = $LASTEXITCODE

    if ($clippyExit -eq 0) {
        Write-Host "  ✓ PASS: Cargo clippy 桌面端 (0 warnings)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ FAIL: Cargo clippy 桌面端" -ForegroundColor Red
        ($clippyOutput -split "`n") | Where-Object { $_ -match "^(error|warning)" } | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }
        $allPassed = $false
    }

    Pop-Location
}

# ============================================
# 9. Android Cargo Clippy (移动端代码审查)
# ============================================
if (-not $SkipRust -and -not $SkipAndroid) {
    Step-Header "Cargo clippy Android (移动端代码审查)..."

    $ndkHome = $env:NDK_HOME
    if (-not $ndkHome) {
        $androidSdkNdk = "$env:LOCALAPPDATA\Android\Sdk\ndk"
        if (Test-Path $androidSdkNdk) {
            $ndkDir = Get-ChildItem $androidSdkNdk -Directory | Sort-Object Name -Descending | Select-Object -First 1
            if ($ndkDir) {
                $ndkHome = $ndkDir.FullName
            }
        }
    }

    if (-not $ndkHome -or -not (Test-Path $ndkHome)) {
        Record-Skip -Id 'clippy-android' -Reason 'Android NDK 未找到 (设置 NDK_HOME 或使用 -SkipAndroid)'
    } else {
        $targetInstalled = rustup target list --installed 2>&1 | Out-String
        if ($targetInstalled -notmatch "aarch64-linux-android") {
            Record-Skip -Id 'clippy-android' -Reason 'aarch64-linux-android 目标未安装'
            Write-Host "    运行: rustup target add aarch64-linux-android" -ForegroundColor Gray
        } else {
            Push-Location "$projectRoot\src-tauri"

            $env:CC_aarch64_linux_android = "$ndkHome\toolchains\llvm\prebuilt\windows-x86_64\bin\aarch64-linux-android24-clang.cmd"
            $env:AR_aarch64_linux_android = "$ndkHome\toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-ar.exe"

            $androidClippyOutput = cargo clippy --target aarch64-linux-android -- -D warnings 2>&1 | Out-String
            $androidClippyExit = $LASTEXITCODE

            if ($androidClippyExit -eq 0) {
                Write-Host "  ✓ PASS: Cargo clippy Android (0 warnings)" -ForegroundColor Green
            } else {
                Write-Host "  ✗ FAIL: Cargo clippy Android" -ForegroundColor Red
                ($androidClippyOutput -split "`n") | Where-Object { $_ -match "^(error|warning)" } | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }
                $allPassed = $false
            }

            Pop-Location
        }
    }
}

# ============================================
# 10. Cargo test（Rust 单元测试 + 发货二进制静态守卫）
# ============================================
# 为什么必须有这一块：
#   src-tauri\src\desktop\huanvaeguard_macos.rs 的 #[cfg(test)] 里有两条**发货件守卫** ——
#     · bundled_daemon_binary_understands_every_flag_in_bundled_plist
#       （打包 plist 里每个 -- 开关，都必须真出现在打包二进制的字节里；否则守护进程启动即退、
#         KeepAlive 下崩溃循环，而安装链每一步都"成功"，没有任何地方会报错）
#     · bundled_daemon_binary_leaks_no_build_host_paths
#       （PUBLIC 仓脱敏：发货二进制里不得含 /Users/、/home/、C:\Users 等构建机绝对路径）
#   既有门禁只跑 cargo check + clippy，**从不运行测试** —— 这两条守卫等于没接线。本块把它们接上。
if (-not $SkipRust) {
    Step-Header "Cargo test (Rust 单元测试 + 发货二进制静态守卫)..."

    Push-Location "$projectRoot\src-tauri"

    $cargoTestOutput = cargo test --lib 2>&1 | Out-String
    $cargoTestExit = $LASTEXITCODE

    if ($cargoTestExit -eq 0) {
        if ($cargoTestOutput -match "(\d+) passed") {
            Write-Host "  ✓ PASS: Cargo test ($($Matches[1]) 个测试)" -ForegroundColor Green
        } else {
            Write-Host "  ✓ PASS: Cargo test" -ForegroundColor Green
        }
    } else {
        Write-Host "  ✗ FAIL: Cargo test" -ForegroundColor Red
        # 失败摘要优先打失败用例名 / 编译错误；没匹配到再打末尾 20 行，避免"报了 FAIL 却什么都看不到"
        $cargoTestFailLines = ($cargoTestOutput -split "`n") |
            Where-Object { $_ -match "^(error|failures:|test .* FAILED|test result: FAILED)" } |
            Select-Object -First 20
        if ($cargoTestFailLines) {
            $cargoTestFailLines | ForEach-Object { Write-Host "  $_" }
        } else {
            ($cargoTestOutput -split "`n") | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
        }
        $allPassed = $false
    }

    Pop-Location
}

# ============================================
# 11. VPN 连通性测试（真握手 + 真收发包 + 端到端 ping）
# ============================================
# 判据不是"服务起来了"，而是真握手 + 两向真收发包 + 端到端 ping ——
# 已发生过"服务状态看着正常，但上下行包均为 0"的真实故障，只看状态发现不了。
#
# scripts\hg-connectivity-test.ps1 的退出码是三态，这里必须按三态处理：
#   0 → PASS
#   3 → 本机物理上跑不了（**未执行**）：既不是通过也不是失败 → 登记为跳过，
#       未经 ALLOW_SKIP 显式放行时 test-all 以退出码 2 结束 → 发布中止
#   其它 → FAIL
# 该脚本的**完整原始输出原样打印**（不只打结论）：验收要看五项各自的判据原文与原始命令输出。
if (-not $SkipVpn) {
    Step-Header "VPN 连通性测试 (真握手 + 真收发包 + 端到端 ping)..."

    $vpnScript = "$scriptDir\hg-connectivity-test.ps1"
    $vpnOutput = & powershell -ExecutionPolicy Bypass -File $vpnScript 2>&1 | Out-String
    $vpnExit = $LASTEXITCODE
    Write-Host $vpnOutput

    if ($vpnExit -eq 0) {
        Write-Host "  ✓ PASS: VPN 连通性测试 (5/5 真跑通过)" -ForegroundColor Green
    } elseif ($vpnExit -eq 3) {
        # 取脚本自己打印的"未执行"原因
        $vpnReason = ''
        $vpnReasonMatch = [regex]::Match($vpnOutput, '本次未执行：(.+)')
        if ($vpnReasonMatch.Success) { $vpnReason = $vpnReasonMatch.Groups[1].Value.Trim() }
        if (-not $vpnReason) { $vpnReason = 'hg-connectivity-test.ps1 以退出码 3 结束（未打印具体原因）' }
        Record-Skip -Id 'vpn-connectivity' -Reason "本机不具备执行条件（未设置对端 VIP / 未安装守护进程）：$($vpnReason) —— 须在具备真实对端的机器上跑，或显式 ALLOW_SKIP=vpn-connectivity 放行并如实报告"
    } else {
        Write-Host "  ✗ FAIL: VPN 连通性测试 (退出码 $($vpnExit)，判据原文见上方原始输出)" -ForegroundColor Red
        $allPassed = $false
    }
}

# ============================================
# 结果汇总
# ============================================
$endTime = Get-Date
$duration = [math]::Round(($endTime - $startTime).TotalSeconds, 0)

# 全量口径固定 11 项，与本脚本的 11 个检查块一一对应；跳过项不计入"真跑通过"
$canonicalTotal = 11
$skipCount = $skipped.Count
$ranCount = $canonicalTotal - $skipCount

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  耗时: $duration 秒"
Write-Host "========================================" -ForegroundColor Magenta

if ($skipCount -gt 0) {
    Write-Host ""
    Write-Host "  ⚠ 本次有 $skipCount 项被跳过（未真跑）：" -ForegroundColor Yellow
    foreach ($s in $skipped) {
        Write-Host "    - $($s.Id): $($s.Reason)" -ForegroundColor Yellow
    }
}

if (-not $allPassed) {
    Write-Host ""
    Write-Host "  部分检查未通过!" -ForegroundColor Red
    Write-Host "  请修复上述问题后重试" -ForegroundColor Red
    Write-Host ""
    exit 1
}

if ($skipCount -eq 0) {
    Write-Host ""
    Write-Host "  所有检查通过!" -ForegroundColor Green
    Write-Host "  $canonicalTotal/$canonicalTotal 真跑通过, 0 errors, 0 warnings" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# 有跳过项：只有被 ALLOW_SKIP 显式放行的才算过，否则退出码 2（跳过未放行）
$allowRaw = $env:ALLOW_SKIP
$allowList = @()
if ($allowRaw) {
    $allowList = $allowRaw -split '[,\s]+' | Where-Object { $_ }
}
$allowAll = $allowList -contains 'all'
$unapproved = @($skipped | Where-Object { -not ($allowAll -or ($allowList -contains $_.Id)) })

if ($unapproved.Count -eq 0) {
    Write-Host ""
    Write-Host "  ⚠ 放行：本次有 $skipCount 项被跳过（ALLOW_SKIP 显式放行）" -ForegroundColor Yellow
    Write-Host "  真跑通过 $ranCount/$canonicalTotal, 0 errors, 0 warnings" -ForegroundColor Green
    Write-Host ""
    exit 0
}

Write-Host ""
Write-Host "  ✗ 有 $($unapproved.Count) 项被跳过且未显式放行 —— 不视为通过" -ForegroundColor Red
foreach ($u in $unapproved) {
    Write-Host "    - $($u.Id): $($u.Reason)" -ForegroundColor Red
}
Write-Host ""
Write-Host "  真跑通过 $ranCount/$($canonicalTotal)（其余未跑）" -ForegroundColor Yellow
Write-Host "  如确认可接受，显式放行后重跑，例如：" -ForegroundColor Yellow
Write-Host "    `$env:ALLOW_SKIP='clippy-android'; .\scripts\test-all.ps1" -ForegroundColor Yellow
Write-Host "    （多项用逗号分隔；`$env:ALLOW_SKIP='all' 放行全部）" -ForegroundColor Yellow
Write-Host ""
exit 2
