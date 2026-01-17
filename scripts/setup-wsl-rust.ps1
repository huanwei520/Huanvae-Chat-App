# Huanvae Chat - WSL Rust Environment Setup
# Usage: .\scripts\setup-wsl-rust.ps1
# 
# This script sets up Rust development environment in WSL2 Ubuntu
# for cross-platform build testing.

param()

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================"
Write-Host "  WSL2 Rust Environment Setup"
Write-Host "========================================"
Write-Host ""

# Check WSL availability
Write-Host "[1/4] Checking WSL2 status..." -ForegroundColor Cyan

$wslList = wsl --list --quiet 2>&1 | Out-String
if (-not ($wslList -match "Ubuntu")) {
    Write-Host "  ERROR: Ubuntu not found in WSL" -ForegroundColor Red
    Write-Host "  Please install first: wsl --install Ubuntu-24.04" -ForegroundColor Yellow
    Write-Host "  Then restart your computer and run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host "  OK: Ubuntu found in WSL" -ForegroundColor Green

# Initialize Ubuntu if first run (create default user)
Write-Host "[2/4] Initializing Ubuntu (if needed)..." -ForegroundColor Cyan

$initCheck = wsl -d Ubuntu -- echo "WSL OK" 2>&1 | Out-String
if ($initCheck -match "WSL OK") {
    Write-Host "  OK: Ubuntu is initialized" -ForegroundColor Green
}
else {
    Write-Host "  Initializing Ubuntu... (this may take a moment)" -ForegroundColor Yellow
    # Ubuntu may need first-time setup, run simple command
    wsl -d Ubuntu -- bash -c "echo 'Ubuntu initialized'"
}

# Install system dependencies
Write-Host "[3/4] Installing system dependencies..." -ForegroundColor Cyan

$installDeps = @"
set -e
export DEBIAN_FRONTEND=noninteractive

# Update package list
sudo apt-get update -qq

# Install essential build tools
sudo apt-get install -y -qq \
    build-essential \
    pkg-config \
    libssl-dev \
    libgtk-3-dev \
    libwebkit2gtk-4.1-dev \
    libappindicator3-dev \
    librsvg2-dev \
    libayatana-appindicator3-dev \
    curl \
    wget \
    file \
    2>/dev/null

echo "System dependencies installed successfully"
"@

wsl -d Ubuntu -- bash -c $installDeps
if ($LASTEXITCODE -eq 0) {
    Write-Host "  OK: System dependencies installed" -ForegroundColor Green
}
else {
    Write-Host "  WARNING: Some dependencies may have failed" -ForegroundColor Yellow
}

# Install Rust
Write-Host "[4/4] Installing Rust toolchain..." -ForegroundColor Cyan

$installRust = @"
set -e

# Check if Rust is already installed
if command -v ~/.cargo/bin/rustc &> /dev/null; then
    echo "Rust is already installed:"
    ~/.cargo/bin/rustc --version
    ~/.cargo/bin/cargo --version
    
    # Update to latest
    ~/.cargo/bin/rustup update stable
else
    # Install Rust via rustup
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
    
    # Source cargo env
    source ~/.cargo/env
    
    echo "Rust installed:"
    ~/.cargo/bin/rustc --version
    ~/.cargo/bin/cargo --version
fi

echo "Rust setup complete"
"@

wsl -d Ubuntu -- bash -c $installRust
if ($LASTEXITCODE -eq 0) {
    Write-Host "  OK: Rust toolchain ready" -ForegroundColor Green
}
else {
    Write-Host "  ERROR: Rust installation failed" -ForegroundColor Red
    exit 1
}

# Verify setup
Write-Host ""
Write-Host "========================================"
Write-Host "  Verification"
Write-Host "========================================"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$wslProjectPath = $projectRoot -replace '\\', '/' -replace '^([A-Za-z]):', { '/mnt/' + $_.Groups[1].Value.ToLower() }

Write-Host ""
Write-Host "Testing cargo check in WSL..." -ForegroundColor Cyan

$verifyCheck = wsl -d Ubuntu -- bash -c "cd '$wslProjectPath/src-tauri' && ~/.cargo/bin/cargo check --message-format=short 2>&1"
$verifyExit = $LASTEXITCODE

if ($verifyExit -eq 0) {
    Write-Host ""
    Write-Host "========================================"
    Write-Host "  SETUP COMPLETE!" -ForegroundColor Green
    Write-Host "========================================"
    Write-Host ""
    Write-Host "WSL2 Rust environment is ready for cross-platform testing." -ForegroundColor Green
    Write-Host "Run .\scripts\test-all.ps1 to include Linux build checks." -ForegroundColor Cyan
    Write-Host ""
}
else {
    Write-Host ""
    Write-Host "========================================"
    Write-Host "  SETUP COMPLETE (with warnings)" -ForegroundColor Yellow
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Rust is installed but cargo check found issues:" -ForegroundColor Yellow
    Write-Host $verifyCheck
    Write-Host ""
    Write-Host "This is expected - you can now catch Linux build errors locally!" -ForegroundColor Cyan
    Write-Host ""
}
