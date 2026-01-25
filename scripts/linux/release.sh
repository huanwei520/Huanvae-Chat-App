#!/bin/bash
#
# Huanvae Chat App 自动化版本发布脚本 (Linux)
#
# ## 功能
# 严格的版本发布流程，确保代码质量和版本一致性
# 测试通过后自动推送发布，无需手动确认
#
# ## 发布流程
# 1. 读取 release-config.txt 中的目标版本号
# 2. 检查当前项目版本号一致性（package.json / Cargo.toml / tauri.conf.json）
# 3. 对比配置版本与当前版本
# 4. 如果版本不一致，先更新所有版本号
# 5. 运行完整测试（前后端 0 errors, 0 warnings）
# 6. 测试通过后自动进行 Git 提交、创建标签、推送发布
#
# ## 使用方法
# 1. 编辑 scripts/release-config.txt 设置版本号和更新说明
# 2. 运行: ./scripts/linux/release.sh
#
# ## 测试标准
# - 除了以下已知无害警告外，必须 0 errors, 0 warnings：
#   - Vite 动态导入优化提示 (dynamic import will not move module)
#   - ESLint no-await-in-loop (已用 eslint-disable 标记的合理用法)
#   - console.warn/error 调试日志（允许使用）
#
# @version 3.0
# @date 2026-01-25

set -e

# ============================================
# 颜色定义
# ============================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
WHITE='\033[1;37m'
GRAY='\033[0;90m'
NC='\033[0m'

# ============================================
# 路径设置
# ============================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_PATH="$SCRIPT_DIR/../release-config.txt"

cd "$PROJECT_ROOT"

# ============================================
# 辅助函数
# ============================================
print_header() {
    echo ""
    echo -e "${MAGENTA}════════════════════════════════════════════════${NC}"
    echo -e "${MAGENTA}  $1${NC}"
    echo -e "${MAGENTA}════════════════════════════════════════════════${NC}"
}

print_step() {
    echo -e "${CYAN}[$1] $2${NC}"
}

print_ok() {
    echo -e "  ${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "  ${RED}✗ $1${NC}"
}

print_warn() {
    echo -e "  ${YELLOW}⚠ $1${NC}"
}

# ============================================
# 读取配置文件
# ============================================
print_header "Huanvae Chat App 自动发布"

if [[ ! -f "$CONFIG_PATH" ]]; then
    print_error "配置文件未找到: $CONFIG_PATH"
    exit 1
fi

# 解析配置文件
TARGET_VERSION=""
RELEASE_MESSAGE=""
while IFS='=' read -r key value; do
    key=$(echo "$key" | tr -d '[:space:]')
    [[ -z "$key" || "$key" == \#* ]] && continue
    
    case "$key" in
        VERSION) TARGET_VERSION="$value" ;;
        MESSAGE) RELEASE_MESSAGE="$value" ;;
    esac
done < "$CONFIG_PATH"

if [[ -z "$TARGET_VERSION" || -z "$RELEASE_MESSAGE" ]]; then
    print_error "配置格式错误，需要 VERSION 和 MESSAGE"
    echo ""
    echo "配置文件格式示例："
    echo "  VERSION=1.0.25"
    echo "  MESSAGE=mDNS设备下线检测修复、移动端消息气泡宽度优化"
    exit 1
fi

echo ""
echo -e "  ${WHITE}目标版本: v$TARGET_VERSION${NC}"
echo -e "  ${GRAY}更新说明: $RELEASE_MESSAGE${NC}"
echo ""

# ============================================
# 步骤 1: 检查当前版本号一致性
# ============================================
print_step "1/6" "检查当前项目版本号一致性..."

# 读取各文件版本号
PKG_VERSION=$(grep '"version"' "$PROJECT_ROOT/package.json" | head -1 | sed 's/.*: "\([^"]*\)".*/\1/')
CARGO_VERSION=$(grep '^version = ' "$PROJECT_ROOT/src-tauri/Cargo.toml" | sed 's/version = "\([^"]*\)"/\1/')
TAURI_VERSION=$(grep '"version"' "$PROJECT_ROOT/src-tauri/tauri.conf.json" | head -1 | sed 's/.*: "\([^"]*\)".*/\1/')

echo -e "  ${GRAY}package.json:      $PKG_VERSION${NC}"
echo -e "  ${GRAY}Cargo.toml:        $CARGO_VERSION${NC}"
echo -e "  ${GRAY}tauri.conf.json:   $TAURI_VERSION${NC}"

# 检查三个版本是否一致
CURRENT_VERSION=""
if [[ "$PKG_VERSION" == "$CARGO_VERSION" && "$CARGO_VERSION" == "$TAURI_VERSION" ]]; then
    CURRENT_VERSION="$PKG_VERSION"
    print_ok "当前版本一致: v$CURRENT_VERSION"
else
    print_error "当前项目版本号不一致！"
    echo ""
    echo -e "${RED}请先手动统一版本号后再运行发布脚本${NC}"
    exit 1
fi

# ============================================
# 步骤 2: 对比目标版本与当前版本
# ============================================
print_step "2/6" "对比目标版本与当前版本..."

echo -e "  ${GRAY}当前版本: v$CURRENT_VERSION${NC}"
echo -e "  ${GRAY}目标版本: v$TARGET_VERSION${NC}"

VERSION_UPDATED=false

if [[ "$CURRENT_VERSION" == "$TARGET_VERSION" ]]; then
    print_ok "版本号已是目标版本，无需更新"
else
    print_warn "版本号需要更新: v$CURRENT_VERSION → v$TARGET_VERSION"
    
    # 更新版本号
    echo ""
    echo -e "  ${CYAN}正在更新版本号...${NC}"
    
    # 更新 package.json
    sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$TARGET_VERSION\"/" "$PROJECT_ROOT/package.json"
    
    # 更新 tauri.conf.json
    sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$TARGET_VERSION\"/" "$PROJECT_ROOT/src-tauri/tauri.conf.json"
    
    # 更新 Cargo.toml
    sed -i "/^\[package\]/,/^\[/ s/version = \"$CURRENT_VERSION\"/version = \"$TARGET_VERSION\"/" "$PROJECT_ROOT/src-tauri/Cargo.toml"
    
    # 验证更新
    NEW_PKG=$(grep '"version"' "$PROJECT_ROOT/package.json" | head -1 | sed 's/.*: "\([^"]*\)".*/\1/')
    NEW_CARGO=$(grep '^version = ' "$PROJECT_ROOT/src-tauri/Cargo.toml" | sed 's/version = "\([^"]*\)"/\1/')
    NEW_TAURI=$(grep '"version"' "$PROJECT_ROOT/src-tauri/tauri.conf.json" | head -1 | sed 's/.*: "\([^"]*\)".*/\1/')
    
    if [[ "$NEW_PKG" == "$TARGET_VERSION" && "$NEW_CARGO" == "$TARGET_VERSION" && "$NEW_TAURI" == "$TARGET_VERSION" ]]; then
        print_ok "版本号更新成功: v$TARGET_VERSION"
        VERSION_UPDATED=true
    else
        print_error "版本号更新失败！"
        echo "  package.json:    $NEW_PKG"
        echo "  Cargo.toml:      $NEW_CARGO"
        echo "  tauri.conf.json: $NEW_TAURI"
        exit 1
    fi
fi

# ============================================
# 步骤 3: 运行完整测试
# ============================================
print_step "3/6" "运行完整代码质量测试..."
echo ""
echo -e "${YELLOW}  测试标准: 前后端 0 errors, 0 warnings${NC}"
echo -e "${GRAY}  (忽略: Vite动态导入提示、已标记的await-in-loop、console调试日志)${NC}"
echo ""

if ! "$SCRIPT_DIR/test-all.sh"; then
    echo ""
    print_error "测试检查未通过！请修复所有问题后再发布"
    echo ""
    
    # 如果版本号已更新，提示回滚
    if $VERSION_UPDATED; then
        echo -e "${YELLOW}提示: 版本号已更新到 v$TARGET_VERSION，可以继续修复问题后重新运行发布脚本${NC}"
    fi
    exit 1
fi

echo ""
print_ok "所有测试检查通过！"

# ============================================
# 步骤 4: 同步依赖
# ============================================
print_step "4/6" "同步 pnpm-lock.yaml..."

if pnpm install --frozen-lockfile >/dev/null 2>&1; then
    print_ok "依赖已同步 (frozen-lockfile)"
else
    if pnpm install >/dev/null 2>&1; then
        print_ok "依赖已同步"
    else
        print_error "pnpm install 失败"
        exit 1
    fi
fi

# ============================================
# 步骤 5: Git 提交和标签
# ============================================
print_step "5/6" "Git 提交和创建标签..."

COMMIT_MSG="v$TARGET_VERSION: $RELEASE_MESSAGE"

# 检查是否有变更需要提交
if git diff --quiet && git diff --staged --quiet; then
    print_warn "没有检测到文件变更"
    
    # 检查标签是否已存在
    if git tag -l "v$TARGET_VERSION" | grep -q "v$TARGET_VERSION"; then
        print_warn "标签 v$TARGET_VERSION 已存在，将强制更新"
        git tag -d "v$TARGET_VERSION" 2>/dev/null || true
    fi
else
    # 有变更，进行提交
    git add -A
    git commit -m "$COMMIT_MSG"
    print_ok "Git 提交完成"
fi

# 创建标签
git tag -d "v$TARGET_VERSION" 2>/dev/null || true
git tag "v$TARGET_VERSION"
print_ok "标签 v$TARGET_VERSION 已创建"

# ============================================
# 步骤 6: 自动推送到 GitHub
# ============================================
print_step "6/6" "推送到 GitHub..."

echo ""
echo -e "  ${WHITE}推送分支: main${NC}"
echo -e "  ${WHITE}推送标签: v$TARGET_VERSION${NC}"
echo ""

git push origin main
git push origin "v$TARGET_VERSION" --force

print_ok "推送完成"

# ============================================
# 发布完成
# ============================================
print_header "发布完成! v$TARGET_VERSION"

echo ""
echo -e "  ${WHITE}版本: v$TARGET_VERSION${NC}"
echo -e "  ${GRAY}$RELEASE_MESSAGE${NC}"
echo ""
echo -e "  ${CYAN}GitHub Actions:${NC}"
echo "    https://github.com/huanwei520/Huanvae-Chat-App/actions"
echo ""
echo -e "  ${CYAN}Release 页面:${NC}"
echo "    https://github.com/huanwei520/Huanvae-Chat-App/releases/tag/v$TARGET_VERSION"
echo ""
