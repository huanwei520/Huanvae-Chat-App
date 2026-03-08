<#
.SYNOPSIS
    Huanvae Chat App 自动化版本发布脚本 (Windows)

.DESCRIPTION
    严格的版本发布流程，确保代码质量和版本一致性
    测试通过后自动推送发布，无需手动确认

.USAGE
    1. 编辑 scripts/release-config.txt 设置版本号和更新说明
    2. 在项目根目录运行: powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1

发布流程:
    1. 读取 release-config.txt 中的目标版本号
    2. 检查当前项目版本号一致性（package.json / Cargo.toml / tauri.conf.json）
    3. 对比配置版本与当前版本
    4. 如果版本不一致，先更新所有版本号
    5. 运行完整测试（前后端 0 errors, 0 warnings）
    6. 测试通过后自动进行 Git 提交、创建标签、推送发布

测试标准:
    - 除了以下已知无害警告外，必须 0 errors, 0 warnings：
      - Vite 动态导入优化提示 (dynamic import will not move module)
      - ESLint no-await-in-loop (已用 eslint-disable 标记的合理用法)
      - console.warn/error 调试日志（允许使用）

@version 3.0
@date 2026-01-25
#>

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

$ConfigPath = Join-Path $ScriptDir "release-config.txt"
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

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

# ============================================
# 读取配置文件
# ============================================
Print-Header "Huanvae Chat App 自动发布"

if (!(Test-Path $ConfigPath)) {
    Print-Error "配置文件未找到: $ConfigPath"
    exit 1
}

$Config = @{}
Get-Content $ConfigPath -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line -and !$line.StartsWith("#")) {
        $parts = $line.Split("=", 2)
        if ($parts.Length -eq 2) {
            $Config[$parts[0].Trim()] = $parts[1].Trim()
        }
    }
}

$TargetVersion = $Config["VERSION"]
$ReleaseMessage = $Config["MESSAGE"]

if (!$TargetVersion -or !$ReleaseMessage) {
    Print-Error "配置格式错误，需要 VERSION 和 MESSAGE"
    Write-Host ""
    Write-Host "配置文件格式示例："
    Write-Host "  VERSION=1.0.25"
    Write-Host "  MESSAGE=mDNS设备下线检测修复、移动端消息气泡宽度优化"
    exit 1
}

Write-Host ""
Write-Host "  目标版本: v$TargetVersion" -ForegroundColor White
Write-Host "  更新说明: $ReleaseMessage" -ForegroundColor Gray
Write-Host ""

# ============================================
# 步骤 1: 检查当前版本号一致性
# ============================================
Print-Step "1/6" "检查当前项目版本号一致性..."

$pkgContent = [System.IO.File]::ReadAllText("$ProjectRoot\package.json", $Utf8NoBom)
$PkgVersion = ""
if ($pkgContent -match '"version":\s*"([^"]+)"') { $PkgVersion = $Matches[1] }

$cargoLines = Get-Content "$ProjectRoot\src-tauri\Cargo.toml" -Encoding UTF8
$CargoVersion = ""
foreach ($line in $cargoLines) {
    if ($line -match '^\s*version\s*=\s*"([^"]+)"') {
        $CargoVersion = $Matches[1]
        break
    }
}

$tauriContent = [System.IO.File]::ReadAllText("$ProjectRoot\src-tauri\tauri.conf.json", $Utf8NoBom)
$TauriVersion = ""
if ($tauriContent -match '"version":\s*"([^"]+)"') { $TauriVersion = $Matches[1] }

Write-Host "  package.json:      $PkgVersion" -ForegroundColor Gray
Write-Host "  Cargo.toml:        $CargoVersion" -ForegroundColor Gray
Write-Host "  tauri.conf.json:   $TauriVersion" -ForegroundColor Gray

if ($PkgVersion -eq $CargoVersion -and $CargoVersion -eq $TauriVersion) {
    $CurrentVersion = $PkgVersion
    Print-Ok "当前版本一致: v$CurrentVersion"
} else {
    Print-Error "当前项目版本号不一致！"
    Write-Host ""
    Write-Host "请先手动统一版本号后再运行发布脚本" -ForegroundColor Red
    exit 1
}

# ============================================
# 步骤 2: 对比目标版本与当前版本
# ============================================
Print-Step "2/6" "对比目标版本与当前版本..."

Write-Host "  当前版本: v$CurrentVersion" -ForegroundColor Gray
Write-Host "  目标版本: v$TargetVersion" -ForegroundColor Gray

$VersionUpdated = $false

if ($CurrentVersion -eq $TargetVersion) {
    Print-Ok "版本号已是目标版本，无需更新"
} else {
    Print-Warn "版本号需要更新: v$CurrentVersion → v$TargetVersion"

    Write-Host ""
    Write-Host "  正在更新版本号..." -ForegroundColor Cyan

    # 更新 package.json
    $content = [System.IO.File]::ReadAllText("$ProjectRoot\package.json", $Utf8NoBom)
    $content = $content -replace "`"version`":\s*`"$([regex]::Escape($CurrentVersion))`"", "`"version`": `"$TargetVersion`""
    [System.IO.File]::WriteAllText("$ProjectRoot\package.json", $content, $Utf8NoBom)

    # 更新 tauri.conf.json
    $content = [System.IO.File]::ReadAllText("$ProjectRoot\src-tauri\tauri.conf.json", $Utf8NoBom)
    $content = $content -replace "`"version`":\s*`"$([regex]::Escape($CurrentVersion))`"", "`"version`": `"$TargetVersion`""
    [System.IO.File]::WriteAllText("$ProjectRoot\src-tauri\tauri.conf.json", $content, $Utf8NoBom)

    # 更新 Cargo.toml
    $content = [System.IO.File]::ReadAllText("$ProjectRoot\src-tauri\Cargo.toml", $Utf8NoBom)
    $pattern = '(\[package\][\s\S]*?name\s*=\s*"[^"]+"\s*\n)version\s*=\s*"[^"]+"'
    $replacement = "`$1version = `"$TargetVersion`""
    $content = $content -replace $pattern, $replacement
    [System.IO.File]::WriteAllText("$ProjectRoot\src-tauri\Cargo.toml", $content, $Utf8NoBom)

    # 验证更新
    $newPkgContent = [System.IO.File]::ReadAllText("$ProjectRoot\package.json", $Utf8NoBom)
    $NewPkg = ""
    if ($newPkgContent -match '"version":\s*"([^"]+)"') { $NewPkg = $Matches[1] }

    $newCargoLines = Get-Content "$ProjectRoot\src-tauri\Cargo.toml" -Encoding UTF8
    $NewCargo = ""
    foreach ($line in $newCargoLines) {
        if ($line -match '^\s*version\s*=\s*"([^"]+)"') {
            $NewCargo = $Matches[1]
            break
        }
    }

    $newTauriContent = [System.IO.File]::ReadAllText("$ProjectRoot\src-tauri\tauri.conf.json", $Utf8NoBom)
    $NewTauri = ""
    if ($newTauriContent -match '"version":\s*"([^"]+)"') { $NewTauri = $Matches[1] }

    if ($NewPkg -eq $TargetVersion -and $NewCargo -eq $TargetVersion -and $NewTauri -eq $TargetVersion) {
        Print-Ok "版本号更新成功: v$TargetVersion"
        $VersionUpdated = $true
    } else {
        Print-Error "版本号更新失败！"
        Write-Host "  package.json:    $NewPkg"
        Write-Host "  Cargo.toml:      $NewCargo"
        Write-Host "  tauri.conf.json: $NewTauri"
        exit 1
    }
}

# ============================================
# 步骤 3: 运行完整测试
# ============================================
Print-Step "3/6" "运行完整代码质量测试..."
Write-Host ""
Write-Host "  测试标准: 前后端 0 errors, 0 warnings" -ForegroundColor Yellow
Write-Host "  (忽略: Vite动态导入提示、已标记的await-in-loop、console调试日志)" -ForegroundColor Gray
Write-Host ""

& powershell -ExecutionPolicy Bypass -File "$ScriptDir\test-all.ps1"
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Print-Error "测试检查未通过！请修复所有问题后再发布"
    Write-Host ""

    if ($VersionUpdated) {
        Write-Host "提示: 版本号已更新到 v$TargetVersion，可以继续修复问题后重新运行发布脚本" -ForegroundColor Yellow
    }
    exit 1
}

Write-Host ""
Print-Ok "所有测试检查通过！"

# ============================================
# 步骤 4: 同步依赖
# ============================================
Print-Step "4/6" "同步 pnpm-lock.yaml..."

$installResult = pnpm install --frozen-lockfile 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) {
    Print-Ok "依赖已同步 (frozen-lockfile)"
} else {
    $installResult = pnpm install 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
        Print-Ok "依赖已同步"
    } else {
        Print-Error "pnpm install 失败"
        exit 1
    }
}

# ============================================
# 步骤 5: Git 提交和标签
# ============================================
Print-Step "5/6" "Git 提交和创建标签..."

$CommitMsg = "v${TargetVersion}: $ReleaseMessage"

git diff --quiet 2>$null
$gitDiffExit = $LASTEXITCODE
git diff --staged --quiet 2>$null
$gitDiffStagedExit = $LASTEXITCODE

if ($gitDiffExit -eq 0 -and $gitDiffStagedExit -eq 0) {
    Print-Warn "没有检测到文件变更"

    $tagExists = git tag -l "v$TargetVersion" 2>&1 | Out-String
    if ($tagExists.Trim() -match "v$([regex]::Escape($TargetVersion))") {
        Print-Warn "标签 v$TargetVersion 已存在，将强制更新"
        git tag -d "v$TargetVersion" 2>$null
    }
} else {
    git add -A
    $commitFile = "$ProjectRoot\.commit_msg"
    [System.IO.File]::WriteAllText($commitFile, $CommitMsg, $Utf8NoBom)
    git commit -F $commitFile
    Remove-Item $commitFile -Force -ErrorAction SilentlyContinue
    Print-Ok "Git 提交完成"
}

git tag -d "v$TargetVersion" 2>$null
git tag "v$TargetVersion"
Print-Ok "标签 v$TargetVersion 已创建"

# ============================================
# 步骤 6: 自动推送到 GitHub
# ============================================
Print-Step "6/6" "推送到 GitHub..."

Write-Host ""
Write-Host "  推送分支: main" -ForegroundColor White
Write-Host "  推送标签: v$TargetVersion" -ForegroundColor White
Write-Host ""

git push origin main
git push origin "v$TargetVersion" --force

Print-Ok "推送完成"

# ============================================
# 发布完成
# ============================================
Print-Header "发布完成! v$TargetVersion"

Write-Host ""
Write-Host "  版本: v$TargetVersion" -ForegroundColor White
Write-Host "  $ReleaseMessage" -ForegroundColor Gray
Write-Host ""
Write-Host "  GitHub Actions:" -ForegroundColor Cyan
Write-Host "    https://github.com/huanwei520/Huanvae-Chat-App/actions"
Write-Host ""
Write-Host "  Release 页面:" -ForegroundColor Cyan
Write-Host "    https://github.com/huanwei520/Huanvae-Chat-App/releases/tag/v$TargetVersion"
Write-Host ""
