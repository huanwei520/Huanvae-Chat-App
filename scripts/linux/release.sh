#!/bin/bash
#
# Huanvae Chat App 自动化版本发布脚本 (Linux)
#
# 功能：
#   通过读取 release-config.txt 配置文件进行版本发布
#   自动更新版本号、提交代码、创建标签、推送到GitHub触发构建
#
# 使用方法：
#   1. 编辑 scripts/release-config.txt 设置版本号和更新说明
#   2. 在项目根目录运行: ./scripts/linux/release.sh
#
# 注意：发布前会自动运行完整测试，任何 error 或 warning 都会阻止发布

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# 获取脚本和项目路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_PATH="$SCRIPT_DIR/../release-config.txt"

cd "$PROJECT_ROOT"

# ============================================
# 读取配置文件
# ============================================
if [[ ! -f "$CONFIG_PATH" ]]; then
    echo -e "${RED}[ERROR] 配置文件未找到: $CONFIG_PATH${NC}"
    exit 1
fi

# 解析配置文件
VERSION=""
MESSAGE=""
while IFS='=' read -r key value; do
    # 跳过空行和注释
    key=$(echo "$key" | tr -d '[:space:]')
    [[ -z "$key" || "$key" == \#* ]] && continue
    
    case "$key" in
        VERSION) VERSION="$value" ;;
        MESSAGE) MESSAGE="$value" ;;
    esac
done < "$CONFIG_PATH"

if [[ -z "$VERSION" || -z "$MESSAGE" ]]; then
    echo -e "${RED}[ERROR] 配置格式错误，需要 VERSION 和 MESSAGE${NC}"
    exit 1
fi

echo ""
echo -e "${MAGENTA}========================================${NC}"
echo -e "${MAGENTA}  Huanvae Chat App v$VERSION${NC}"
echo -e "${MAGENTA}========================================${NC}"
echo -e "  $MESSAGE"
echo -e "${MAGENTA}========================================${NC}"
echo ""

# ============================================
# 运行完整测试（发布前必须通过）
# ============================================
echo -e "${YELLOW}[Pre-Check] 运行完整测试检查...${NC}"
echo ""

if ! "$SCRIPT_DIR/test-all.sh"; then
    echo ""
    echo -e "${RED}[ERROR] 测试检查未通过，请修复所有问题后再发布！${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}[OK] 所有测试检查通过${NC}"
echo ""

# ============================================
# 检查 tauri.conf.json 配置
# ============================================
echo -e "${YELLOW}[Check] 验证 Windows 更新器配置...${NC}"

TAURI_CONF="$PROJECT_ROOT/src-tauri/tauri.conf.json"

# 检查是否存在 plugins.updater.windows.installMode
if grep -q '"installMode"' "$TAURI_CONF" 2>/dev/null; then
    # 进一步检查是否在 updater.windows 下
    if python3 -c "
import json
with open('$TAURI_CONF') as f:
    conf = json.load(f)
updater_windows = conf.get('plugins', {}).get('updater', {}).get('windows', {})
if 'installMode' in updater_windows:
    exit(1)
exit(0)
" 2>/dev/null; then
        echo -e "${GREEN}[OK] Windows 更新器配置正确${NC}"
    else
        echo -e "${RED}[ERROR] plugins.updater.windows.installMode 必须移除${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}[OK] Windows 更新器配置正确${NC}"
fi

# ============================================
# 同步依赖锁文件
# ============================================
echo ""
echo -e "${YELLOW}[Check] 同步 pnpm-lock.yaml...${NC}"
if ! pnpm install --frozen-lockfile 2>/dev/null; then
    # 如果 frozen 失败，尝试普通安装
    if ! pnpm install; then
        echo -e "${RED}[ERROR] pnpm install 失败${NC}"
        exit 1
    fi
fi
echo -e "${GREEN}[OK] pnpm-lock.yaml 已同步${NC}"

# ============================================
# 更新版本号
# ============================================
echo ""
echo -e "${CYAN}[1/6] 更新 package.json...${NC}"
sed -i "s/\"version\":[[:space:]]*\"[^\"]*\"/\"version\": \"$VERSION\"/" "$PROJECT_ROOT/package.json"

echo -e "${CYAN}[2/6] 更新 tauri.conf.json...${NC}"
sed -i "s/\"version\":[[:space:]]*\"[^\"]*\"/\"version\": \"$VERSION\"/" "$PROJECT_ROOT/src-tauri/tauri.conf.json"

echo -e "${CYAN}[3/6] 更新 Cargo.toml...${NC}"
# 使用 sed 只替换 [package] 部分的 version
sed -i "/^\[package\]/,/^\[/ s/^version[[:space:]]*=[[:space:]]*\"[^\"]*\"/version = \"$VERSION\"/" "$PROJECT_ROOT/src-tauri/Cargo.toml"

# ============================================
# Git 操作
# ============================================
echo -e "${CYAN}[4/6] Git commit...${NC}"
COMMIT_MSG="v$VERSION: $MESSAGE"
git add -A
git commit -m "$COMMIT_MSG"

echo -e "${CYAN}[5/6] 创建标签 v$VERSION...${NC}"
git tag -d "v$VERSION" 2>/dev/null || true
git tag "v$VERSION"

echo -e "${CYAN}[6/6] 推送到 GitHub...${NC}"
git push origin main
git push origin "v$VERSION" --force

# ============================================
# 完成
# ============================================
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  发布完成! v$VERSION${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "GitHub Actions: https://github.com/huanwei520/Huanvae-Chat-App/actions"
echo "Release: https://github.com/huanwei520/Huanvae-Chat-App/releases/tag/v$VERSION"
echo ""
