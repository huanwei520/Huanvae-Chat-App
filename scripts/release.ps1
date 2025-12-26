# release.ps1 - 自动化版本发布脚本
# 用法: .\scripts\release.ps1 -Version "1.0.3" -Message "新增功能xxx，修复bug xxx"

param(
    [Parameter(Mandatory=$true)]
    [string]$Version,
    
    [Parameter(Mandatory=$true)]
    [string]$Message
)

# 设置 UTF-8 编码
$OutputEncoding = [Console]::OutputEncoding = [Console]::InputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Huanvae Chat App 版本发布脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "版本号: v$Version" -ForegroundColor Yellow
Write-Host "更新日志: $Message" -ForegroundColor Yellow
Write-Host ""

# 切换到项目根目录
Set-Location $ProjectRoot

# 1. 更新 package.json 版本号
Write-Host "[1/7] 更新 package.json 版本号..." -ForegroundColor Green
$packageJson = Get-Content "package.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$packageJson.version = $Version
$packageJson | ConvertTo-Json -Depth 10 | Set-Content "package.json" -Encoding UTF8

# 2. 更新 tauri.conf.json 版本号
Write-Host "[2/7] 更新 tauri.conf.json 版本号..." -ForegroundColor Green
$tauriConf = Get-Content "src-tauri/tauri.conf.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$tauriConf.version = $Version
$tauriConf | ConvertTo-Json -Depth 10 | Set-Content "src-tauri/tauri.conf.json" -Encoding UTF8

# 3. 创建提交消息文件（解决中文编码问题）
Write-Host "[3/7] 准备提交消息..." -ForegroundColor Green
$commitMsgFile = Join-Path $ProjectRoot ".commit_msg_temp"
$commitMessage = "v$Version`: $Message"
[System.IO.File]::WriteAllText($commitMsgFile, $commitMessage, [System.Text.Encoding]::UTF8)

# 4. 暂存所有更改
Write-Host "[4/7] 暂存更改..." -ForegroundColor Green
git add -A

# 5. 提交更改（使用文件传递中文消息）
Write-Host "[5/7] 提交更改..." -ForegroundColor Green
git commit -F $commitMsgFile

# 6. 删除临时文件
Remove-Item $commitMsgFile -Force -ErrorAction SilentlyContinue

# 7. 删除旧标签（如果存在）并创建新标签
Write-Host "[6/7] 创建标签 v$Version..." -ForegroundColor Green
git tag -d "v$Version" 2>$null
git push origin ":refs/tags/v$Version" 2>$null
git tag "v$Version"

# 8. 推送代码和标签
Write-Host "[7/7] 推送到远程仓库..." -ForegroundColor Green
git push origin main
git push origin "v$Version"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  发布完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "版本 v$Version 已推送到 GitHub" -ForegroundColor Green
Write-Host "GitHub Actions 将自动开始构建" -ForegroundColor Yellow
Write-Host ""
Write-Host "查看构建进度:" -ForegroundColor Cyan
Write-Host "https://github.com/huanwei520/Huanvae-Chat-App/actions" -ForegroundColor White
Write-Host ""
Write-Host "查看 Release:" -ForegroundColor Cyan
Write-Host "https://github.com/huanwei520/Huanvae-Chat-App/releases/tag/v$Version" -ForegroundColor White

