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

Write-Host ""
Write-Host "========================================"
Write-Host "  Huanvae Chat App v$Version"
Write-Host "========================================"
Write-Host "  $Message"
Write-Host "========================================"
Write-Host ""

# 使用正则表达式替换版本号（保持原有格式）
Write-Host "[1/6] 更新 package.json..." -ForegroundColor Cyan
$content = [System.IO.File]::ReadAllText("$ProjectRoot\package.json", [System.Text.Encoding]::UTF8)
$content = $content -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`""
[System.IO.File]::WriteAllText("$ProjectRoot\package.json", $content, [System.Text.Encoding]::UTF8)

Write-Host "[2/6] 更新 tauri.conf.json..." -ForegroundColor Cyan
$content = [System.IO.File]::ReadAllText("$ProjectRoot\src-tauri\tauri.conf.json", [System.Text.Encoding]::UTF8)
$content = $content -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`""
[System.IO.File]::WriteAllText("$ProjectRoot\src-tauri\tauri.conf.json", $content, [System.Text.Encoding]::UTF8)

Write-Host "[3/6] 更新 Cargo.toml..." -ForegroundColor Cyan
$content = [System.IO.File]::ReadAllText("$ProjectRoot\src-tauri\Cargo.toml", [System.Text.Encoding]::UTF8)
# 只替换 [package] 部分的 version（文件开头的第一个 version）
$content = $content -replace '(\[package\][\s\S]*?name\s*=\s*"[^"]+"\s*\n)version\s*=\s*"[^"]+"', "`$1version = `"$Version`""
[System.IO.File]::WriteAllText("$ProjectRoot\src-tauri\Cargo.toml", $content, [System.Text.Encoding]::UTF8)

# Git 提交
Write-Host "[4/6] Git 提交..." -ForegroundColor Cyan
$commitFile = "$ProjectRoot\.commit_msg"
[System.IO.File]::WriteAllText($commitFile, "v$Version`: $Message", [System.Text.Encoding]::UTF8)
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
