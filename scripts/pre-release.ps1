<#
.SYNOPSIS
    Huanvae Chat App 预发布检查脚本

.DESCRIPTION
    在发布新版本前运行，确保代码质量和功能完整性：
    1. TypeScript 类型检查
    2. ESLint 代码规范检查
    3. 单元测试
    4. 构建测试
    5. 人工功能检查清单

.USAGE
    在项目根目录运行: powershell -ExecutionPolicy Bypass -File .\scripts\pre-release.ps1
#>

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

# 颜色输出函数
function Write-Step { param($text) Write-Host "`n$text" -ForegroundColor Cyan }
function Write-Success { param($text) Write-Host $text -ForegroundColor Green }
function Write-Fail { param($text) Write-Host $text -ForegroundColor Red }
function Write-Info { param($text) Write-Host $text -ForegroundColor White }

# 检查结果
$results = @()

Write-Host ""
Write-Host "================================================" -ForegroundColor Magenta
Write-Host "     Huanvae Chat App 预发布检查" -ForegroundColor Magenta
Write-Host "================================================" -ForegroundColor Magenta

# ============================================
# 1. TypeScript 类型检查
# ============================================
Write-Step "[1/5] TypeScript 类型检查..."
try {
    $output = pnpm tsc --noEmit 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Success "  ✓ 类型检查通过"
        $results += @{ name = "TypeScript"; passed = $true }
    } else {
        Write-Fail "  ✗ 类型检查失败"
        Write-Info $output
        $results += @{ name = "TypeScript"; passed = $false }
    }
} catch {
    Write-Fail "  ✗ 类型检查出错: $_"
    $results += @{ name = "TypeScript"; passed = $false }
}

# ============================================
# 2. ESLint 代码检查
# ============================================
Write-Step "[2/5] ESLint 代码检查..."
try {
    $output = pnpm lint 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Success "  ✓ 代码检查通过"
        $results += @{ name = "ESLint"; passed = $true }
    } else {
        Write-Fail "  ✗ 代码检查失败"
        Write-Info $output
        $results += @{ name = "ESLint"; passed = $false }
    }
} catch {
    Write-Fail "  ✗ 代码检查出错: $_"
    $results += @{ name = "ESLint"; passed = $false }
}

# ============================================
# 3. 单元测试
# ============================================
Write-Step "[3/5] 单元测试..."
try {
    $output = pnpm test --run 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Success "  ✓ 单元测试通过"
        $results += @{ name = "单元测试"; passed = $true }
    } else {
        Write-Fail "  ✗ 单元测试失败"
        Write-Info $output
        $results += @{ name = "单元测试"; passed = $false }
    }
} catch {
    Write-Fail "  ✗ 单元测试出错: $_"
    $results += @{ name = "单元测试"; passed = $false }
}

# ============================================
# 4. 前端构建测试
# ============================================
Write-Step "[4/5] 前端构建测试..."
try {
    $output = pnpm build 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Success "  ✓ 前端构建成功"
        $results += @{ name = "前端构建"; passed = $true }
    } else {
        Write-Fail "  ✗ 前端构建失败"
        Write-Info $output
        $results += @{ name = "前端构建"; passed = $false }
    }
} catch {
    Write-Fail "  ✗ 前端构建出错: $_"
    $results += @{ name = "前端构建"; passed = $false }
}

# ============================================
# 5. 人工检查清单
# ============================================
Write-Step "[5/5] 人工功能检查..."
Write-Host ""
Write-Host "请确认以下核心功能正常工作：" -ForegroundColor Yellow
Write-Host ""
Write-Host "  [ ] 登录/登出功能正常" -ForegroundColor White
Write-Host "  [ ] 好友列表正确加载" -ForegroundColor White
Write-Host "  [ ] 群聊列表正确加载" -ForegroundColor White
Write-Host "  [ ] 发送文本消息正常" -ForegroundColor White
Write-Host "  [ ] 发送图片消息正常" -ForegroundColor White
Write-Host "  [ ] 文件上传/下载正常" -ForegroundColor White
Write-Host "  [ ] 图片/视频预览正常" -ForegroundColor White
Write-Host "  [ ] 托盘图标正常显示" -ForegroundColor White
Write-Host "  [ ] 窗口关闭最小化到托盘" -ForegroundColor White
Write-Host "  [ ] 更新检测正常执行" -ForegroundColor White
Write-Host ""

$manualConfirm = Read-Host "所有核心功能确认正常? (y/n)"
if ($manualConfirm -eq 'y' -or $manualConfirm -eq 'Y') {
    Write-Success "  ✓ 人工检查通过"
    $results += @{ name = "人工检查"; passed = $true }
} else {
    Write-Fail "  ✗ 人工检查未通过"
    $results += @{ name = "人工检查"; passed = $false }
}

# ============================================
# 检查结果汇总
# ============================================
Write-Host ""
Write-Host "================================================" -ForegroundColor Magenta
Write-Host "                检查结果汇总" -ForegroundColor Magenta
Write-Host "================================================" -ForegroundColor Magenta
Write-Host ""

$passedCount = 0
$failedCount = 0

foreach ($result in $results) {
    if ($result.passed) {
        Write-Success "  ✓ $($result.name)"
        $passedCount++
    } else {
        Write-Fail "  ✗ $($result.name)"
        $failedCount++
    }
}

Write-Host ""
Write-Host "------------------------------------------------"
Write-Host "  通过: $passedCount / $($results.Count)" -ForegroundColor $(if ($failedCount -eq 0) { "Green" } else { "Yellow" })

if ($failedCount -gt 0) {
    Write-Host ""
    Write-Fail "预发布检查未通过，请修复上述问题后再发布！"
    Write-Host ""
    exit 1
} else {
    Write-Host ""
    Write-Success "预发布检查全部通过！可以执行发布脚本。"
    Write-Host ""
    Write-Info "运行发布命令: powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1"
    Write-Host ""
    exit 0
}

