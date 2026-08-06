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
# 5. 从 HuanvaeGuard 源码构建各平台 VPN 守护进程二进制并替换进 App 落点
#    （失败即中止，绝不回落仓里的旧二进制继续发布）
# 6. 运行完整测试（前后端 0 errors, 0 warnings）
# 7. 测试通过后自动进行 Git 提交、创建标签（并校验标签指向当前 HEAD，
#    不一致即中止且不推送）、推送发布
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

# 校验标签确实指向当前 HEAD —— 在 push 之前拦住"tag 打到上一个 commit"
assert_tag_points_at_head() {
    local tag="$1"
    local tag_sha head_sha
    tag_sha=$(git rev-parse "$tag^{commit}")
    head_sha=$(git rev-parse HEAD)

    if [[ "$tag_sha" != "$head_sha" ]]; then
        print_error "标签指向校验失败: $tag 没有指向当前 HEAD"
        echo -e "  ${RED}HEAD:  $head_sha${NC}"
        echo -e "  ${RED}$tag: $tag_sha${NC}"
        echo ""
        echo -e "${YELLOW}  已中止，未推送任何内容。手工修正步骤：${NC}"
        echo -e "${YELLOW}    1) git tag -f \"$tag\" $head_sha${NC}"
        echo -e "${YELLOW}    2) git rev-parse \"$tag^{commit}\"   # 必须等于 $head_sha${NC}"
        echo -e "${YELLOW}    3) 核对无误后重跑本脚本，或手工 git push origin main && git push origin \"$tag\" --force${NC}"
        return 1
    fi

    print_ok "标签指向校验通过: $tag -> $head_sha"
    return 0
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
print_step "1/7" "检查当前项目版本号一致性..."

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
print_step "2/7" "对比目标版本与当前版本..."

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
# 步骤 3: 从 HuanvaeGuard 源码构建各平台 VPN 二进制并替换
# ============================================
# 发货的两个 VPN 守护进程二进制长期是"手工放进去、来源不明、无人验证"的仓内死文件，
# 已连续造成两起生产故障（发货件落后于当前契约 / 签名形态不被系统服务管理器接受）。
# 这一步把它们改成"每次发布前从源码构建 → 校验 → 替换"的可复现产物，且失败即中止发布。
print_step "3/7" "从 HuanvaeGuard 源码构建各平台 VPN 二进制并替换..."

BUILD_HG_EXIT=0
"$PROJECT_ROOT/scripts/build-hg-binaries.sh" || BUILD_HG_EXIT=$?

if [[ $BUILD_HG_EXIT -ne 0 ]]; then
    echo ""
    print_error "VPN 二进制构建/替换失败 —— 发布中止。不使用仓里的旧二进制兜底继续发布（两起生产故障的根因就是发了来源不明、无人验证的旧二进制）。"
    echo ""

    # 如果版本号已更新，提示可修复后重跑
    if $VERSION_UPDATED; then
        echo -e "${YELLOW}提示: 版本号已更新到 v$TARGET_VERSION，可以继续修复问题后重新运行发布脚本${NC}"
    fi
    exit 1
fi

HG_MANIFEST="$PROJECT_ROOT/src-tauri/resources/hg-build-manifest.json"
if [[ -f "$HG_MANIFEST" ]]; then
    echo ""
    echo -e "  ${GRAY}build manifest (src-tauri/resources/hg-build-manifest.json):${NC}"
    cat "$HG_MANIFEST"
    echo ""
fi

print_ok "VPN 二进制已从源码构建、校验并替换到位"

# ============================================
# 步骤 4: 运行完整测试
# ============================================
print_step "4/7" "运行完整代码质量测试..."
echo ""
echo -e "${YELLOW}  测试标准: 前后端 0 errors, 0 warnings${NC}"
echo -e "${GRAY}  (忽略: Vite动态导入提示、已标记的await-in-loop、console调试日志)${NC}"
echo ""

TEST_EXIT=0
"$SCRIPT_DIR/test-all.sh" "$@" || TEST_EXIT=$?

if [[ $TEST_EXIT -ne 0 ]]; then
    echo ""
    if [[ $TEST_EXIT -eq 2 ]]; then
        print_error "有检查项被跳过且未真跑 —— 发布中止（跳过 ≠ 通过）"
        echo ""
        echo -e "${YELLOW}  跳过明细见上方 test-all.sh 汇总。确认这些项确实可以不跑，才显式放行后重跑：${NC}"
        echo -e "${YELLOW}    ALLOW_SKIP=clippy-android ./scripts/linux/release.sh${NC}"
    else
        print_error "测试检查未通过！请修复所有问题后再发布"
    fi
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
# 步骤 5: 同步依赖
# ============================================
print_step "5/7" "同步 pnpm-lock.yaml..."

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
# 步骤 6: Git 提交和标签
# ============================================
print_step "6/7" "Git 提交和创建标签..."

COMMIT_MSG="v$TARGET_VERSION: $RELEASE_MESSAGE"

# 检查是否有变更需要提交
if git diff --quiet && git diff --staged --quiet; then
    print_warn "没有检测到文件变更"
    print_warn "标签 v$TARGET_VERSION 将重新指向当前 HEAD"
else
    # 有变更，进行提交
    git add -A
    git commit -m "$COMMIT_MSG"
    print_ok "Git 提交完成"
fi

# 锁定本次发布的 commit：tag 显式指向它，不依赖 git tag 隐式解析 HEAD
RELEASE_SHA=$(git rev-parse HEAD)

# 创建标签
git tag -d "v$TARGET_VERSION" 2>/dev/null || true
git tag "v$TARGET_VERSION" "$RELEASE_SHA"

# 推送之前必须校验：标签必须指向本次发布的 commit
if ! assert_tag_points_at_head "v$TARGET_VERSION"; then
    exit 1
fi

# ============================================
# 步骤 7: 自动推送到 GitHub
# ============================================
print_step "7/7" "推送到 GitHub..."

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
