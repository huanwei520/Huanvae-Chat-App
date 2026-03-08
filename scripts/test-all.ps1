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
$totalSteps = 9
if ($SkipRust) { $totalSteps -= 2 }
if ($SkipAndroid) { $totalSteps -= 1 }

# ============================================
# 1. Windows NSIS 安装配置检查
# ============================================
Write-Host "[1/$totalSteps] Windows NSIS 安装配置检查..." -ForegroundColor Cyan

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
Write-Host "[2/$totalSteps] package.json 验证..." -ForegroundColor Cyan

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
Write-Host "[3/$totalSteps] TypeScript 类型检查..." -ForegroundColor Cyan

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
Write-Host "[4/$totalSteps] ESLint 代码检查 (0 errors, 0 warnings)..." -ForegroundColor Cyan

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
Write-Host "[5/$totalSteps] 单元测试..." -ForegroundColor Cyan

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
Write-Host "[6/$totalSteps] 前端构建测试 (检查警告)..." -ForegroundColor Cyan

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
    Write-Host "[7/$totalSteps] Cargo check (编译检查)..." -ForegroundColor Cyan

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
    Write-Host "[8/$totalSteps] Cargo clippy 桌面端 (代码审查 - 禁止警告)..." -ForegroundColor Cyan

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
    Write-Host "[9/$totalSteps] Cargo clippy Android (移动端代码审查)..." -ForegroundColor Cyan

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
        Write-Host "  ⚠ SKIP: Android NDK 未找到 (设置 NDK_HOME 或使用 -SkipAndroid)" -ForegroundColor Yellow
    } else {
        $targetInstalled = rustup target list --installed 2>&1 | Out-String
        if ($targetInstalled -notmatch "aarch64-linux-android") {
            Write-Host "  ⚠ SKIP: aarch64-linux-android 目标未安装" -ForegroundColor Yellow
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

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  耗时: $duration 秒"
Write-Host "========================================" -ForegroundColor Magenta

if ($allPassed) {
    Write-Host ""
    Write-Host "  所有检查通过!" -ForegroundColor Green
    Write-Host "  0 errors, 0 warnings" -ForegroundColor Green
    Write-Host ""
    exit 0
} else {
    Write-Host ""
    Write-Host "  部分检查未通过!" -ForegroundColor Red
    Write-Host "  请修复上述问题后重试" -ForegroundColor Red
    Write-Host ""
    exit 1
}
