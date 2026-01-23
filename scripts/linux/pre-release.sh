#!/bin/bash
#
# Huanvae Chat App 预发布检查脚本 (Linux)
#
# 功能：
#   在发布新版本前运行，确保代码质量和功能完整性
#   包含自动检查和人工确认两部分
#
# 使用方法：
#   ./scripts/linux/pre-release.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
WHITE='\033[1;37m'
NC='\033[0m'

# 获取项目路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

# 检查结果数组
declare -a RESULTS_NAME
declare -a RESULTS_PASS

add_result() {
    RESULTS_NAME+=("$1")
    RESULTS_PASS+=("$2")
}

echo ""
echo -e "${MAGENTA}================================================${NC}"
echo -e "${MAGENTA}     Huanvae Chat App 预发布检查${NC}"
echo -e "${MAGENTA}================================================${NC}"

# ============================================
# 1. TypeScript 类型检查
# ============================================
echo ""
echo -e "${CYAN}[1/8] TypeScript 类型检查...${NC}"

if pnpm tsc --noEmit >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓ 类型检查通过${NC}"
    add_result "TypeScript" "true"
else
    echo -e "  ${RED}✗ 类型检查失败${NC}"
    pnpm tsc --noEmit 2>&1 | head -20
    add_result "TypeScript" "false"
fi

# ============================================
# 2. ESLint 代码检查
# ============================================
echo ""
echo -e "${CYAN}[2/8] ESLint 代码检查...${NC}"

ESLINT_OUTPUT=$(pnpm lint 2>&1) || true
if [[ $? -eq 0 ]] && ! echo "$ESLINT_OUTPUT" | grep -qE "(error|warning)"; then
    echo -e "  ${GREEN}✓ 代码检查通过${NC}"
    add_result "ESLint" "true"
else
    echo -e "  ${RED}✗ 代码检查失败${NC}"
    echo "$ESLINT_OUTPUT" | grep -E "(error|warning)" | head -10
    add_result "ESLint" "false"
fi

# ============================================
# 3. 单元测试
# ============================================
echo ""
echo -e "${CYAN}[3/8] 单元测试...${NC}"

if pnpm test --run >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓ 单元测试通过${NC}"
    add_result "单元测试" "true"
else
    echo -e "  ${RED}✗ 单元测试失败${NC}"
    pnpm test --run 2>&1 | tail -20
    add_result "单元测试" "false"
fi

# ============================================
# 4. 前端构建测试
# ============================================
echo ""
echo -e "${CYAN}[4/8] 前端构建测试...${NC}"

if pnpm build >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓ 前端构建成功${NC}"
    add_result "前端构建" "true"
else
    echo -e "  ${RED}✗ 前端构建失败${NC}"
    pnpm build 2>&1 | tail -20
    add_result "前端构建" "false"
fi

# ============================================
# 5. Cargo Clippy 代码审查 (桌面端)
# ============================================
echo ""
echo -e "${CYAN}[5/8] Cargo Clippy 桌面端代码审查...${NC}"

cd "$PROJECT_ROOT/src-tauri"
if cargo clippy --all-targets --all-features -- -D warnings >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓ Clippy 桌面端检查通过${NC}"
    add_result "Cargo Clippy 桌面端" "true"
else
    echo -e "  ${RED}✗ Clippy 桌面端检查失败${NC}"
    cargo clippy --all-targets --all-features -- -D warnings 2>&1 | grep -E "^(error|warning)" | head -10
    add_result "Cargo Clippy 桌面端" "false"
fi
cd "$PROJECT_ROOT"

# ============================================
# 6. Cargo Clippy 代码审查 (Android)
# ============================================
echo ""
echo -e "${CYAN}[6/8] Cargo Clippy Android 代码审查...${NC}"

# 检查 Android NDK
if [[ -z "$NDK_HOME" ]]; then
    if [[ -d "$HOME/Android/Sdk/ndk" ]]; then
        NDK_HOME=$(ls -d "$HOME/Android/Sdk/ndk"/*/ 2>/dev/null | tail -1 | sed 's:/$::')
    fi
fi

if [[ -z "$NDK_HOME" || ! -d "$NDK_HOME" ]]; then
    echo -e "  ${YELLOW}⚠ 跳过: Android NDK 未找到${NC}"
    add_result "Cargo Clippy Android" "skip"
elif ! rustup target list --installed | grep -q "aarch64-linux-android"; then
    echo -e "  ${YELLOW}⚠ 跳过: aarch64-linux-android 目标未安装${NC}"
    add_result "Cargo Clippy Android" "skip"
else
    cd "$PROJECT_ROOT/src-tauri"
    
    export CC_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang"
    export AR_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-ar"
    
    if cargo clippy --target aarch64-linux-android -- -D warnings >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓ Clippy Android 检查通过${NC}"
        add_result "Cargo Clippy Android" "true"
    else
        echo -e "  ${RED}✗ Clippy Android 检查失败${NC}"
        cargo clippy --target aarch64-linux-android -- -D warnings 2>&1 | grep -E "^(error|warning)" | head -10
        add_result "Cargo Clippy Android" "false"
    fi
    
    cd "$PROJECT_ROOT"
fi

# ============================================
# 7. 配置文件检查
# ============================================
echo ""
echo -e "${CYAN}[7/8] 配置文件检查...${NC}"

CONFIG_OK=true
TAURI_CONF="$PROJECT_ROOT/src-tauri/tauri.conf.json"

# 检查 JSON 格式
if ! python3 -c "import json; json.load(open('$TAURI_CONF'))" 2>/dev/null; then
    echo -e "  ${RED}✗ tauri.conf.json 格式错误${NC}"
    CONFIG_OK=false
fi

# 检查 Windows 更新器配置
if python3 -c "
import json
with open('$TAURI_CONF') as f:
    conf = json.load(f)
updater_windows = conf.get('plugins', {}).get('updater', {}).get('windows', {})
if 'installMode' in updater_windows:
    exit(1)
" 2>/dev/null; then
    if $CONFIG_OK; then
        echo -e "  ${GREEN}✓ 配置检查通过 (Windows 更新器使用默认完整安装界面)${NC}"
        add_result "配置检查" "true"
    else
        add_result "配置检查" "false"
    fi
else
    echo -e "  ${RED}✗ Windows 更新器配置错误${NC}"
    echo -e "    plugins.updater.windows.installMode 必须移除"
    add_result "配置检查" "false"
fi

# ============================================
# 8. 人工功能检查
# ============================================
echo ""
echo -e "${CYAN}[8/8] 人工功能检查...${NC}"
echo ""
echo -e "${YELLOW}请确认以下核心功能正常工作：${NC}"
echo ""
echo -e "  ${WHITE}[ ] 登录/登出功能正常${NC}"
echo -e "  ${WHITE}[ ] 好友列表正确加载${NC}"
echo -e "  ${WHITE}[ ] 群聊列表正确加载${NC}"
echo -e "  ${WHITE}[ ] 发送文本消息正常${NC}"
echo -e "  ${WHITE}[ ] 发送图片消息正常${NC}"
echo -e "  ${WHITE}[ ] 文件上传/下载正常${NC}"
echo -e "  ${WHITE}[ ] 图片/视频预览正常${NC}"
echo -e "  ${WHITE}[ ] 托盘图标正常显示${NC}"
echo -e "  ${WHITE}[ ] 窗口关闭最小化到托盘${NC}"
echo -e "  ${WHITE}[ ] 更新检测正常执行${NC}"
echo -e "  ${WHITE}[ ] 局域网文件传输正常${NC}"
echo ""

read -p "所有核心功能确认正常? (y/n): " MANUAL_CONFIRM

if [[ "$MANUAL_CONFIRM" == "y" || "$MANUAL_CONFIRM" == "Y" ]]; then
    echo -e "  ${GREEN}✓ 人工检查通过${NC}"
    add_result "人工检查" "true"
else
    echo -e "  ${RED}✗ 人工检查未通过${NC}"
    add_result "人工检查" "false"
fi

# ============================================
# 检查结果汇总
# ============================================
echo ""
echo -e "${MAGENTA}================================================${NC}"
echo -e "${MAGENTA}                检查结果汇总${NC}"
echo -e "${MAGENTA}================================================${NC}"
echo ""

PASSED_COUNT=0
FAILED_COUNT=0
SKIPPED_COUNT=0

for i in "${!RESULTS_NAME[@]}"; do
    if [[ "${RESULTS_PASS[$i]}" == "true" ]]; then
        echo -e "  ${GREEN}✓ ${RESULTS_NAME[$i]}${NC}"
        ((PASSED_COUNT++))
    elif [[ "${RESULTS_PASS[$i]}" == "skip" ]]; then
        echo -e "  ${YELLOW}⚠ ${RESULTS_NAME[$i]} (跳过)${NC}"
        ((SKIPPED_COUNT++))
    else
        echo -e "  ${RED}✗ ${RESULTS_NAME[$i]}${NC}"
        ((FAILED_COUNT++))
    fi
done

TOTAL_COUNT=${#RESULTS_NAME[@]}

echo ""
echo "------------------------------------------------"

if [[ $FAILED_COUNT -eq 0 ]]; then
    echo -e "  ${GREEN}通过: $PASSED_COUNT / $TOTAL_COUNT${NC}"
else
    echo -e "  ${YELLOW}通过: $PASSED_COUNT / $TOTAL_COUNT${NC}"
fi

echo ""

if [[ $FAILED_COUNT -gt 0 ]]; then
    echo -e "${RED}预发布检查未通过，请修复上述问题后再发布！${NC}"
    echo ""
    exit 1
else
    echo -e "${GREEN}预发布检查全部通过！可以执行发布脚本。${NC}"
    echo ""
    echo -e "运行发布命令: ${CYAN}./scripts/linux/release.sh${NC}"
    echo ""
    exit 0
fi
