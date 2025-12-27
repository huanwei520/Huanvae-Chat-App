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
    Write-Host "[ERROR] 配置文件不存在: $ConfigPath" -ForegroundColor Red
    exit 1
}

# 读取配置
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
    Write-Host "[ERROR] 配置文件格式错误，需要 VERSION 和 MESSAGE" -ForegroundColor Red
    exit 1
}

# 检查 tauri.conf.json 中的 Windows 更新器配置
Write-Host "[检查] 验证 Windows 更新器配置..." -ForegroundColor Yellow
$TauriConfPath = "$ProjectRoot\src-tauri\tauri.conf.json"
$TauriConf = Get-Content $TauriConfPath -Raw | ConvertFrom-Json

# 检查 updater.windows.installMode 必须未设置（使用默认完整安装界面）
$UpdaterWindows = $TauriConf.plugins.updater.windows
if ($UpdaterWindows -and $UpdaterWindows.installMode) {
    Write-Host "[ERROR] plugins.updater.windows.installMode 必须移除" -ForegroundColor Red
    Write-Host "        当前值: '$($UpdaterWindows.installMode)'" -ForegroundColor Red
    Write-Host "        不设置 installMode 可让用户选择安装位置" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Windows 更新器配置正确 (使用默认完整安装界面)" -ForegroundColor Green

# ============================================
# 本地构建测试（与 CI 保持一致）
# ============================================
Write-Host ""
Write-Host "[检查] 运行本地构建测试..." -ForegroundColor Yellow

# 1. 运行单元测试
Write-Host "  [1/2] 单元测试..." -ForegroundColor Cyan
$testResult = pnpm test --run 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] 单元测试失败" -ForegroundColor Red
    Write-Host $testResult -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] 单元测试通过" -ForegroundColor Green

# 2. 前端构建测试（包含 TypeScript 严格检查）
Write-Host "  [2/2] 前端构建测试 (tsc && vite build)..." -ForegroundColor Cyan
$buildResult = pnpm build 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] 前端构建失败" -ForegroundColor Red
    Write-Host $buildResult -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] 前端构建通过" -ForegroundColor Green

Write-Host ""
Write-Host "========================================"
Write-Host "  Huanvae Chat App v$Version"
Write-Host "========================================"
Write-Host "  $Message"
Write-Host "========================================"
Write-Host ""

# UTF8 无 BOM 编码
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

# 使用正则表达式替换版本号（保持原有格式）
Write-Host "[1/6] 更新 package.json..." -ForegroundColor Cyan
$content = [System.IO.File]::ReadAllText("$ProjectRoot\package.json", $Utf8NoBom)
$content = $content -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`""
[System.IO.File]::WriteAllText("$ProjectRoot\package.json", $content, $Utf8NoBom)

Write-Host "[2/6] 更新 tauri.conf.json..." -ForegroundColor Cyan
$content = [System.IO.File]::ReadAllText("$ProjectRoot\src-tauri\tauri.conf.json", $Utf8NoBom)
$content = $content -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`""
[System.IO.File]::WriteAllText("$ProjectRoot\src-tauri\tauri.conf.json", $content, $Utf8NoBom)

Write-Host "[3/6] 更新 Cargo.toml..." -ForegroundColor Cyan
$content = [System.IO.File]::ReadAllText("$ProjectRoot\src-tauri\Cargo.toml", $Utf8NoBom)
# 只替换 [package] 部分的 version（文件开头的第一个 version）
$content = $content -replace '(\[package\][\s\S]*?name\s*=\s*"[^"]+"\s*\n)version\s*=\s*"[^"]+"', "`$1version = `"$Version`""
[System.IO.File]::WriteAllText("$ProjectRoot\src-tauri\Cargo.toml", $content, $Utf8NoBom)

# Git 提交
Write-Host "[4/6] Git 提交..." -ForegroundColor Cyan
$commitFile = "$ProjectRoot\.commit_msg"
[System.IO.File]::WriteAllText($commitFile, "v$Version`: $Message", $Utf8NoBom)
git add -A
git commit -F $commitFile
Remove-Item $commitFile -Force -ErrorAction SilentlyContinue

# 创建标签
Write-Host "[5/6] 创建标签 v$Version..." -ForegroundColor Cyan
git tag -d "v$Version" 2>$null
git tag "v$Version"

# 推送
Write-Host "[6/6] 推送到 GitHub..." -ForegroundColor Cyan
git push origin main
git push origin "v$Version" --force

Write-Host ""
Write-Host "========================================"
Write-Host "  发布完成! v$Version" -ForegroundColor Green
Write-Host "========================================"
Write-Host ""
Write-Host "GitHub Actions: https://github.com/huanwei520/Huanvae-Chat-App/actions"
Write-Host "Release: https://github.com/huanwei520/Huanvae-Chat-App/releases/tag/v$Version"
