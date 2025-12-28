<#
.SYNOPSIS
    Huanvae Chat App 自动化版本发布脚本

.DESCRIPTION
    通过读取 release-config.txt 配置文件进行版本发布
    自动更新版本号、提交代码、创建标签、推送到GitHub触发构建

.USAGE
    1. 编辑 scripts/release-config.txt 设置版本号和更新说明
    2. 在项目根目录运行: powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1
#>

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

$ConfigPath = Join-Path $ScriptDir "release-config.txt"

if (!(Test-Path $ConfigPath)) {
    Write-Host "[ERROR] Config file not found: $ConfigPath" -ForegroundColor Red
    exit 1
}

# Read config
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

$Version = $Config["VERSION"]
$Message = $Config["MESSAGE"]

if (!$Version -or !$Message) {
    Write-Host "[ERROR] Config format error, need VERSION and MESSAGE" -ForegroundColor Red
    exit 1
}

# Check tauri.conf.json Windows updater config
Write-Host "[Check] Validating Windows updater config..." -ForegroundColor Yellow
$TauriConfPath = "$ProjectRoot\src-tauri\tauri.conf.json"
$TauriConf = Get-Content $TauriConfPath -Raw | ConvertFrom-Json

# Check updater.windows.installMode must not be set
$UpdaterWindows = $TauriConf.plugins.updater.windows
if ($UpdaterWindows -and $UpdaterWindows.installMode) {
    Write-Host "[ERROR] plugins.updater.windows.installMode must be removed" -ForegroundColor Red
    Write-Host "        Current: '$($UpdaterWindows.installMode)'" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Windows updater config correct" -ForegroundColor Green

# ============================================
# Sync dependency lockfile
# ============================================
Write-Host ""
Write-Host "[Check] Syncing pnpm-lock.yaml..." -ForegroundColor Yellow
$installResult = pnpm install 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] pnpm install failed" -ForegroundColor Red
    Write-Host $installResult -ForegroundColor Red
    exit 1
}
Write-Host "[OK] pnpm-lock.yaml synced" -ForegroundColor Green

# ============================================
# Local build test
# ============================================
Write-Host ""
Write-Host "[Check] Running local build tests..." -ForegroundColor Yellow

# 1. Unit tests
Write-Host "  [1/2] Unit tests..." -ForegroundColor Cyan
$testResult = pnpm test --run 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Unit tests failed" -ForegroundColor Red
    Write-Host $testResult -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Unit tests passed" -ForegroundColor Green

# 2. Frontend build test
Write-Host "  [2/2] Frontend build test..." -ForegroundColor Cyan
$buildResult = pnpm build 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Frontend build failed" -ForegroundColor Red
    Write-Host $buildResult -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Frontend build passed" -ForegroundColor Green

Write-Host ""
Write-Host "========================================"
Write-Host "  Huanvae Chat App v$Version"
Write-Host "========================================"
Write-Host "  $Message"
Write-Host "========================================"
Write-Host ""

# UTF8 without BOM
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

# Update version using regex
Write-Host "[1/6] Updating package.json..." -ForegroundColor Cyan
$content = [System.IO.File]::ReadAllText("$ProjectRoot\package.json", $Utf8NoBom)
$content = $content -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`""
[System.IO.File]::WriteAllText("$ProjectRoot\package.json", $content, $Utf8NoBom)

Write-Host "[2/6] Updating tauri.conf.json..." -ForegroundColor Cyan
$content = [System.IO.File]::ReadAllText("$ProjectRoot\src-tauri\tauri.conf.json", $Utf8NoBom)
$content = $content -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`""
[System.IO.File]::WriteAllText("$ProjectRoot\src-tauri\tauri.conf.json", $content, $Utf8NoBom)

Write-Host "[3/6] Updating Cargo.toml..." -ForegroundColor Cyan
$content = [System.IO.File]::ReadAllText("$ProjectRoot\src-tauri\Cargo.toml", $Utf8NoBom)
$pattern = '(\[package\][\s\S]*?name\s*=\s*"[^"]+"\s*\n)version\s*=\s*"[^"]+"'
$replacement = "`$1version = `"$Version`""
$content = $content -replace $pattern, $replacement
[System.IO.File]::WriteAllText("$ProjectRoot\src-tauri\Cargo.toml", $content, $Utf8NoBom)

# Git commit
Write-Host "[4/6] Git commit..." -ForegroundColor Cyan
$commitFile = "$ProjectRoot\.commit_msg"
$commitMsg = "v" + $Version + ": " + $Message
[System.IO.File]::WriteAllText($commitFile, $commitMsg, $Utf8NoBom)
git add -A
git commit -F $commitFile
Remove-Item $commitFile -Force -ErrorAction SilentlyContinue

# Create tag
Write-Host "[5/6] Creating tag v$Version..." -ForegroundColor Cyan
git tag -d "v$Version" 2>$null
git tag "v$Version"

# Push
Write-Host "[6/6] Pushing to GitHub..." -ForegroundColor Cyan
git push origin main
git push origin "v$Version" --force

Write-Host ""
Write-Host "========================================"
Write-Host "  Release complete! v$Version" -ForegroundColor Green
Write-Host "========================================"
Write-Host ""
Write-Host "GitHub Actions: https://github.com/huanwei520/Huanvae-Chat-App/actions"
Write-Host "Release: https://github.com/huanwei520/Huanvae-Chat-App/releases/tag/v$Version"
