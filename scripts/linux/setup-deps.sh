#!/bin/bash
#
# Huanvae Chat App Linux 开发环境设置脚本
#
# 功能：
#   自动检测发行版并安装开发所需的依赖
#   包括 Tauri 开发依赖、Rust 工具链、pnpm 等
#
# 使用方法：
#   ./scripts/linux/setup-deps.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

echo ""
echo -e "${MAGENTA}========================================${NC}"
echo -e "${MAGENTA}  Huanvae Chat Linux 开发环境设置${NC}"
echo -e "${MAGENTA}========================================${NC}"
echo ""

# ============================================
# 检测发行版
# ============================================
echo -e "${CYAN}[1/5] 检测 Linux 发行版...${NC}"

DISTRO=""
PKG_MANAGER=""

if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
fi

case "$DISTRO" in
    ubuntu|debian|linuxmint|pop)
        PKG_MANAGER="apt"
        echo -e "  ${GREEN}检测到: $PRETTY_NAME (Debian 系)${NC}"
        ;;
    fedora|rhel|centos|rocky|almalinux)
        PKG_MANAGER="dnf"
        echo -e "  ${GREEN}检测到: $PRETTY_NAME (RHEL 系)${NC}"
        ;;
    arch|manjaro|endeavouros)
        PKG_MANAGER="pacman"
        echo -e "  ${GREEN}检测到: $PRETTY_NAME (Arch 系)${NC}"
        ;;
    opensuse*)
        PKG_MANAGER="zypper"
        echo -e "  ${GREEN}检测到: $PRETTY_NAME (openSUSE)${NC}"
        ;;
    *)
        echo -e "  ${YELLOW}未能自动检测发行版: $DISTRO${NC}"
        echo -e "  ${YELLOW}请手动安装依赖${NC}"
        PKG_MANAGER="unknown"
        ;;
esac

# ============================================
# 安装系统依赖
# ============================================
echo ""
echo -e "${CYAN}[2/5] 安装系统依赖...${NC}"

case "$PKG_MANAGER" in
    apt)
        echo -e "  ${YELLOW}需要 sudo 权限安装依赖...${NC}"
        sudo apt update
        sudo apt install -y \
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
            git \
            avahi-daemon \
            python3
        ;;
    dnf)
        echo -e "  ${YELLOW}需要 sudo 权限安装依赖...${NC}"
        sudo dnf groupinstall -y "Development Tools"
        sudo dnf install -y \
            openssl-devel \
            gtk3-devel \
            webkit2gtk4.1-devel \
            libappindicator-gtk3-devel \
            librsvg2-devel \
            curl \
            wget \
            file \
            git \
            avahi \
            python3
        ;;
    pacman)
        echo -e "  ${YELLOW}需要 sudo 权限安装依赖...${NC}"
        sudo pacman -Syu --noconfirm
        sudo pacman -S --noconfirm \
            base-devel \
            openssl \
            gtk3 \
            webkit2gtk-4.1 \
            libappindicator-gtk3 \
            librsvg \
            curl \
            wget \
            file \
            git \
            avahi \
            python
        ;;
    zypper)
        echo -e "  ${YELLOW}需要 sudo 权限安装依赖...${NC}"
        sudo zypper install -y \
            -t pattern devel_basis \
            libopenssl-devel \
            gtk3-devel \
            webkit2gtk3-devel \
            libappindicator3-devel \
            librsvg-devel \
            curl \
            wget \
            file \
            git \
            avahi \
            python3
        ;;
    *)
        echo -e "  ${YELLOW}请手动安装以下依赖:${NC}"
        echo "    - build-essential / base-devel"
        echo "    - pkg-config"
        echo "    - openssl / libssl-dev"
        echo "    - gtk3-devel / libgtk-3-dev"
        echo "    - webkit2gtk-4.1-devel / libwebkit2gtk-4.1-dev"
        echo "    - libappindicator3-dev"
        echo "    - librsvg2-dev"
        echo "    - avahi-daemon"
        ;;
esac

echo -e "  ${GREEN}✓ 系统依赖已安装${NC}"

# ============================================
# 安装 Rust
# ============================================
echo ""
echo -e "${CYAN}[3/5] 安装/更新 Rust 工具链...${NC}"

if command -v rustc &> /dev/null; then
    RUST_VERSION=$(rustc --version)
    echo -e "  ${GREEN}Rust 已安装: $RUST_VERSION${NC}"
    echo -e "  正在更新到最新版本..."
    rustup update stable
else
    echo -e "  正在安装 Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
    source "$HOME/.cargo/env"
fi

# 安装 clippy 和 rustfmt
echo -e "  安装 clippy 和 rustfmt..."
rustup component add clippy rustfmt

echo -e "  ${GREEN}✓ Rust 工具链已就绪${NC}"
echo -e "    $(rustc --version)"
echo -e "    $(cargo --version)"

# ============================================
# 安装 Node.js 和 pnpm
# ============================================
echo ""
echo -e "${CYAN}[4/5] 检查 Node.js 和 pnpm...${NC}"

if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "  ${GREEN}Node.js 已安装: $NODE_VERSION${NC}"
else
    echo -e "  ${YELLOW}Node.js 未安装，请手动安装 Node.js 18+${NC}"
    echo -e "  推荐使用 nvm: https://github.com/nvm-sh/nvm"
fi

if command -v pnpm &> /dev/null; then
    PNPM_VERSION=$(pnpm --version)
    echo -e "  ${GREEN}pnpm 已安装: $PNPM_VERSION${NC}"
else
    echo -e "  正在安装 pnpm..."
    if command -v npm &> /dev/null; then
        npm install -g pnpm
        echo -e "  ${GREEN}✓ pnpm 已安装${NC}"
    else
        echo -e "  ${YELLOW}请先安装 Node.js，然后运行: npm install -g pnpm${NC}"
    fi
fi

# ============================================
# 配置 avahi-daemon
# ============================================
echo ""
echo -e "${CYAN}[5/5] 配置 avahi-daemon (mDNS 设备发现)...${NC}"

if command -v systemctl &> /dev/null; then
    if systemctl is-active --quiet avahi-daemon 2>/dev/null; then
        echo -e "  ${GREEN}✓ avahi-daemon 已运行${NC}"
    else
        echo -e "  正在启动 avahi-daemon..."
        sudo systemctl enable avahi-daemon 2>/dev/null || true
        sudo systemctl start avahi-daemon 2>/dev/null || true
        echo -e "  ${GREEN}✓ avahi-daemon 已启动${NC}"
    fi
else
    echo -e "  ${YELLOW}systemctl 不可用，请手动启动 avahi-daemon${NC}"
fi

# ============================================
# 验证安装
# ============================================
echo ""
echo -e "${MAGENTA}========================================${NC}"
echo -e "${MAGENTA}  验证安装${NC}"
echo -e "${MAGENTA}========================================${NC}"
echo ""

# 获取脚本所在目录的项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -f "$PROJECT_ROOT/src-tauri/Cargo.toml" ]; then
    echo -e "${CYAN}测试 cargo check...${NC}"
    cd "$PROJECT_ROOT/src-tauri"
    if cargo check --message-format=short 2>&1 | head -20; then
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}  环境设置完成!${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo ""
        echo -e "可以开始开发了:"
        echo -e "  ${CYAN}cd $PROJECT_ROOT${NC}"
        echo -e "  ${CYAN}pnpm install${NC}"
        echo -e "  ${CYAN}pnpm tauri dev${NC}"
    else
        echo ""
        echo -e "${YELLOW}========================================${NC}"
        echo -e "${YELLOW}  环境设置完成 (存在警告)${NC}"
        echo -e "${YELLOW}========================================${NC}"
        echo ""
        echo -e "Rust 已安装，但 cargo check 发现一些问题。"
        echo -e "这通常在首次安装后是正常的，运行 pnpm tauri dev 时会自动修复。"
    fi
else
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  环境设置完成!${NC}"
    echo -e "${GREEN}========================================${NC}"
fi

echo ""
