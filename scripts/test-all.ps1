# Huanvae Chat App 完整测试脚本 (Windows)
#
# 功能：
#   运行所有代码质量检查，要求 0 errors, 0 warnings
#   - 后端: cargo clippy (严格模式，禁止任何警告)
#   - 前端: TypeScript + ESLint + 构建测试
#
# 使用方法：
#   .\scripts\test-all.ps1
#   .\scripts\test-all.ps1 -SkipRust       # 跳过 Rust 检查
#   .\scripts\test-all.ps1 -SkipAndroid    # 跳过 Android clippy 检查
#
# SKIP 不等于 PASS：
#   任何被跳过的检查项（参数显式跳过、或运行期环境缺失如 NDK/target 未装）都会进入
#   跳过登记表，末尾如实列出。只要存在跳过项，就不会打印"所有检查通过!"。
#
#   $env:ALLOW_SKIP  显式放行跳过项（逗号或空格分隔的 id 列表；特殊值 all 放行全部）
#     可用 id: cargo-check / clippy-desktop / clippy-android
#     例: $env:ALLOW_SKIP='clippy-android'; .\scripts\test-all.ps1
#
# 退出码：
#   0  全部真跑通过；或有跳过项但已被 ALLOW_SKIP 显式放行
#   1  有检查项 FAIL
#   2  有检查项被跳过且未显式放行（不视为通过）

param(
    [switch]$SkipRust,
    [switch]$SkipAndroid
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
# + 未跳过 Rust 时 +2（cargo check、clippy 桌面）+ 未跳过 Android 时再 +1（clippy Android）
$script:totalSteps = 6
if (-not $SkipRust) {
    $script:totalSteps += 2
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
} elseif ($SkipAndroid) {
    $script:skipped += [PSCustomObject]@{ Id = 'clippy-android'; Reason = '-SkipAndroid 参数显式跳过 cargo clippy Android' }
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
# 结果汇总
# ============================================
$endTime = Get-Date
$duration = [math]::Round(($endTime - $startTime).TotalSeconds, 0)

$canonicalTotal = 9
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
