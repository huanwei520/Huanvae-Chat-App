# Huanvae Chat - Full Test Script
# Usage: .\scripts\test-all.ps1

param()

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

# Determine pnpm command (direct or via npx)
$env:Path = "$env:LOCALAPPDATA\pnpm;$env:Path"
$pnpmCmd = "pnpm"
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    $pnpmCmd = "npx pnpm"
}

Write-Host ""
Write-Host "========================================"
Write-Host "  Huanvae Chat - Code Quality Check"
Write-Host "  Requirement: 0 errors, 0 warnings"
Write-Host "========================================"
Write-Host ""

$startTime = Get-Date
$allPassed = $true

# 1. package.json duplicate key check (using Node.js for accurate parsing)
Write-Host "[1/5] package.json validation..." -ForegroundColor Cyan
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
    console.error('Duplicate key "' + key + '" at lines: ' + lines.join(', '));
  });
  process.exit(1);
}
try {
  JSON.parse(content);
  console.log('Valid JSON, no duplicate top-level keys');
} catch(e) {
  console.error('Invalid JSON: ' + e.message);
  process.exit(1);
}
"@
$result = $jsonCheckScript | node 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  PASS: package.json validation" -ForegroundColor Green
}
else {
    Write-Host "  FAIL: package.json validation" -ForegroundColor Red
    Write-Host "  $result" -ForegroundColor Red
    $allPassed = $false
}

# 2. TypeScript
Write-Host "[2/5] TypeScript type check..." -ForegroundColor Cyan
$null = Invoke-Expression "$pnpmCmd tsc --noEmit" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  PASS: TypeScript" -ForegroundColor Green
}
else {
    Write-Host "  FAIL: TypeScript" -ForegroundColor Red
    $allPassed = $false
}

# 3. ESLint
Write-Host "[3/5] ESLint check (strict)..." -ForegroundColor Cyan
$null = Invoke-Expression "$pnpmCmd lint" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  PASS: ESLint (0 errors, 0 warnings)" -ForegroundColor Green
}
else {
    Write-Host "  FAIL: ESLint" -ForegroundColor Red
    Invoke-Expression "$pnpmCmd lint"
    $allPassed = $false
}

# 4. Unit Tests
Write-Host "[4/5] Unit tests..." -ForegroundColor Cyan
$testOutput = Invoke-Expression "$pnpmCmd test --run" 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) {
    if ($testOutput -match "(\d+) passed") {
        Write-Host "  PASS: Unit tests ($($Matches[1]) tests)" -ForegroundColor Green
    }
    else {
        Write-Host "  PASS: Unit tests" -ForegroundColor Green
    }
}
else {
    Write-Host "  FAIL: Unit tests" -ForegroundColor Red
    Write-Host $testOutput
    $allPassed = $false
}

# 5. Build (with Vite warning check)
Write-Host "[5/5] Frontend build (checking for warnings)..." -ForegroundColor Cyan
$buildOutput = Invoke-Expression "$pnpmCmd build" 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) {
    # Check for Vite optimization warnings
    if ($buildOutput -match "\[plugin vite:reporter\]") {
        Write-Host "  WARN: Build has Vite optimization warnings" -ForegroundColor Yellow
        # Extract warning count
        $warningMatches = [regex]::Matches($buildOutput, "\[plugin vite:reporter\]")
        Write-Host "  Found $($warningMatches.Count) optimization warning(s)" -ForegroundColor Yellow
        $allPassed = $false
    }
    else {
        Write-Host "  PASS: Build (0 warnings)" -ForegroundColor Green
    }
}
else {
    Write-Host "  FAIL: Build" -ForegroundColor Red
    Write-Host $buildOutput
    $allPassed = $false
}

# Summary
$endTime = Get-Date
$duration = ($endTime - $startTime).TotalSeconds

Write-Host ""
Write-Host "========================================"
Write-Host "  Duration: $([math]::Round($duration, 2)) seconds"
Write-Host "========================================"

if ($allPassed) {
    Write-Host ""
    Write-Host "  ALL CHECKS PASSED!" -ForegroundColor Green
    Write-Host "  0 errors, 0 warnings" -ForegroundColor Green
    Write-Host ""
    exit 0
}
else {
    Write-Host ""
    Write-Host "  SOME CHECKS FAILED!" -ForegroundColor Red
    Write-Host ""
    exit 1
}
