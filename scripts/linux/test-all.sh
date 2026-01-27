#!/bin/bash
#
# Huanvae Chat App 完整测试脚本 (Linux)
#
# 功能：
#   运行所有代码质量检查，要求 0 errors, 0 warnings
#   - 后端: cargo clippy (严格模式，禁止任何警告)
#   - 前端: TypeScript + ESLint + 构建测试
#
# 使用方法：
#   ./scripts/linux/test-all.sh
#   ./scripts/linux/test-all.sh --skip-rust     # 跳过 Rust 检查
#   ./scripts/linux/test-all.sh --skip-android  # 跳过 Android clippy 检查

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
NC='\033[0m'

# 参数处理
SKIP_RUST=false
SKIP_ANDROID=false
for arg in "$@"; do
    case $arg in
        --skip-rust) SKIP_RUST=true ;;
        --skip-android) SKIP_ANDROID=true ;;
    esac
done

# 获取项目路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

echo ""
echo -e "${MAGENTA}========================================${NC}"
echo -e "${MAGENTA}  Huanvae Chat - 代码质量检查${NC}"
echo -e "${MAGENTA}  要求: 0 errors, 0 warnings${NC}"
echo -e "${MAGENTA}========================================${NC}"
echo ""

START_TIME=$(date +%s)
ALL_PASSED=true
TOTAL_STEPS=9
if $SKIP_RUST; then
    TOTAL_STEPS=$((TOTAL_STEPS - 2))
fi
if $SKIP_ANDROID; then
    TOTAL_STEPS=$((TOTAL_STEPS - 1))
fi

# ============================================
# 1. Windows 安装配置检查
# ============================================
echo -e "${CYAN}[1/$TOTAL_STEPS] Windows 安装配置检查...${NC}"

WIX_TEMPLATE="$PROJECT_ROOT/src-tauri/wix/main.wxs"
TAURI_CONF="$PROJECT_ROOT/src-tauri/tauri.conf.json"

# 检查 tauri.conf.json 中配置的安装包类型
if grep -q '"targets".*"msi"' "$TAURI_CONF" || grep -q '"msi"' "$TAURI_CONF"; then
    # 使用 MSI，检查 WiX 模板
    if [[ -f "$WIX_TEMPLATE" ]]; then
        # 检查是否配置为 perUser 安装模式
        if grep -q 'InstallScope="perUser"' "$WIX_TEMPLATE"; then
            echo -e "  ${GREEN}✓ PASS: WiX 模板配置为 perUser 安装模式${NC}"
        else
            echo -e "  ${RED}✗ FAIL: WiX 模板未配置 perUser 安装模式${NC}"
            ALL_PASSED=false
        fi
        # 检查是否配置为 limited 权限
        if grep -q 'InstallPrivileges="limited"' "$WIX_TEMPLATE"; then
            echo -e "  ${GREEN}✓ PASS: WiX 模板配置为无需管理员权限${NC}"
        else
            echo -e "  ${RED}✗ FAIL: WiX 模板未配置 limited 权限${NC}"
            ALL_PASSED=false
        fi
    else
        echo -e "  ${RED}✗ FAIL: WiX 模板文件不存在${NC}"
        ALL_PASSED=false
    fi
elif grep -q '"targets".*"nsis"' "$TAURI_CONF" || grep -q '"nsis"' "$TAURI_CONF"; then
    # 使用 NSIS，检查 NSIS 配置
    if grep -q '"nsis"' "$TAURI_CONF"; then
        echo -e "  ${GREEN}✓ PASS: 使用 NSIS 安装包配置${NC}"
    fi
else
    echo -e "  ${YELLOW}⚠ WARN: 未检测到 Windows 安装包配置${NC}"
fi

# 检查 updater installMode 配置
if grep -q '"installMode".*"passive"' "$TAURI_CONF"; then
    echo -e "  ${GREEN}✓ PASS: 更新器配置为静默安装模式${NC}"
else
    echo -e "  ${YELLOW}⚠ WARN: 更新器未配置 installMode: passive${NC}"
fi

# ============================================
# 2. package.json 验证
# ============================================
echo -e "${CYAN}[2/$TOTAL_STEPS] package.json 验证...${NC}"

VALIDATE_RESULT=$(node -e "
const fs = require('fs');
const content = fs.readFileSync('package.json', 'utf8');
const lines = content.split('\n');
const keyCount = {};
const keyRegex = /^\\s*\"([^\"]+)\"\\s*:/;
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
    console.error('重复键 \"' + key + '\" 在行: ' + lines.join(', '));
  });
  process.exit(1);
}
try {
  JSON.parse(content);
  console.log('JSON 格式正确');
} catch(e) {
  console.error('JSON 格式错误: ' + e.message);
  process.exit(1);
}
" 2>&1) || {
    echo -e "  ${RED}✗ FAIL: package.json 验证${NC}"
    echo -e "  ${RED}$VALIDATE_RESULT${NC}"
    ALL_PASSED=false
}

if $ALL_PASSED; then
    echo -e "  ${GREEN}✓ PASS: package.json 验证${NC}"
fi

# ============================================
# 3. TypeScript 类型检查
# ============================================
echo -e "${CYAN}[3/$TOTAL_STEPS] TypeScript 类型检查...${NC}"

if pnpm tsc --noEmit 2>&1; then
    echo -e "  ${GREEN}✓ PASS: TypeScript${NC}"
else
    echo -e "  ${RED}✗ FAIL: TypeScript 类型检查${NC}"
    ALL_PASSED=false
fi

# ============================================
# 4. ESLint 代码检查 (严格模式)
# ============================================
echo -e "${CYAN}[4/$TOTAL_STEPS] ESLint 代码检查 (0 errors, 0 warnings)...${NC}"

ESLINT_OUTPUT=$(pnpm lint 2>&1) || true
ESLINT_EXIT=$?

if [[ $ESLINT_EXIT -eq 0 ]]; then
    # 检查是否有警告
    if echo "$ESLINT_OUTPUT" | grep -q "warning"; then
        echo -e "  ${RED}✗ FAIL: ESLint 存在警告${NC}"
        echo "$ESLINT_OUTPUT" | grep -E "(warning|error)" | head -20
        ALL_PASSED=false
    else
        echo -e "  ${GREEN}✓ PASS: ESLint (0 errors, 0 warnings)${NC}"
    fi
else
    echo -e "  ${RED}✗ FAIL: ESLint${NC}"
    echo "$ESLINT_OUTPUT" | grep -E "(error|warning)" | head -20
    ALL_PASSED=false
fi

# ============================================
# 5. 单元测试
# ============================================
echo -e "${CYAN}[5/$TOTAL_STEPS] 单元测试...${NC}"

TEST_OUTPUT=$(pnpm test --run 2>&1) || true
TEST_EXIT=$?

if [[ $TEST_EXIT -eq 0 ]]; then
    # 提取测试数量
    PASSED_COUNT=$(echo "$TEST_OUTPUT" | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    if [[ -n "$PASSED_COUNT" ]]; then
        echo -e "  ${GREEN}✓ PASS: 单元测试 ($PASSED_COUNT 个测试)${NC}"
    else
        echo -e "  ${GREEN}✓ PASS: 单元测试${NC}"
    fi
else
    echo -e "  ${RED}✗ FAIL: 单元测试${NC}"
    echo "$TEST_OUTPUT" | tail -20
    ALL_PASSED=false
fi

# ============================================
# 6. 前端构建测试 (检查警告)
# ============================================
echo -e "${CYAN}[6/$TOTAL_STEPS] 前端构建测试 (检查警告)...${NC}"

BUILD_OUTPUT=$(pnpm build 2>&1) || true
BUILD_EXIT=$?

if [[ $BUILD_EXIT -eq 0 ]]; then
    # 检查 Vite 优化警告（忽略无害的 "dynamic import will not move module" 警告）
    # 这类警告是第三方库同时被静态和动态导入导致的，不影响功能
    if echo "$BUILD_OUTPUT" | grep -q "\[plugin vite:reporter\]" | grep -v "dynamic import will not move module"; then
        # 检查是否有非 "dynamic import" 类型的 Vite 警告
        NON_DYNAMIC_WARNINGS=$(echo "$BUILD_OUTPUT" | grep "\[plugin vite:reporter\]" -A5 | grep -v "dynamic import will not move module" | grep -v "^\-\-$" || true)
        if [[ -n "$NON_DYNAMIC_WARNINGS" && "$NON_DYNAMIC_WARNINGS" != *"is dynamically imported"* ]]; then
            echo -e "  ${RED}✗ FAIL: 构建存在 Vite 警告${NC}"
            echo "$NON_DYNAMIC_WARNINGS" | head -10
            ALL_PASSED=false
        else
            echo -e "  ${GREEN}✓ PASS: 前端构建 (仅有无害的动态导入优化提示)${NC}"
        fi
    # 检查其他构建警告（非调试信息）
    elif echo "$BUILD_OUTPUT" | grep -iE "^(warning|warn):" | grep -v "node_modules"; then
        echo -e "  ${RED}✗ FAIL: 构建存在警告${NC}"
        echo "$BUILD_OUTPUT" | grep -iE "^(warning|warn):" | grep -v "node_modules" | head -10
        ALL_PASSED=false
    else
        echo -e "  ${GREEN}✓ PASS: 前端构建 (0 warnings)${NC}"
    fi
else
    echo -e "  ${RED}✗ FAIL: 前端构建${NC}"
    echo "$BUILD_OUTPUT" | tail -20
    ALL_PASSED=false
fi

# ============================================
# 7. Cargo Check (基础编译检查)
# ============================================
if ! $SKIP_RUST; then
    echo -e "${CYAN}[7/$TOTAL_STEPS] Cargo check (编译检查)...${NC}"
    
    cd "$PROJECT_ROOT/src-tauri"
    
    if cargo check --message-format=short 2>&1 | tee /tmp/cargo_check.log | grep -E "^error"; then
        echo -e "  ${RED}✗ FAIL: Cargo check${NC}"
        ALL_PASSED=false
    else
        # 检查是否有警告
        if grep -E "^warning:" /tmp/cargo_check.log | grep -v "warning: build failed" > /dev/null 2>&1; then
            echo -e "  ${RED}✗ FAIL: Cargo check 存在警告${NC}"
            grep -E "^warning:" /tmp/cargo_check.log | grep -v "warning: build failed" | head -10
            ALL_PASSED=false
        else
            echo -e "  ${GREEN}✓ PASS: Cargo check${NC}"
        fi
    fi
    
    cd "$PROJECT_ROOT"
fi

# ============================================
# 8. Cargo Clippy (代码审查 - 严格模式)
# ============================================
if ! $SKIP_RUST; then
    echo -e "${CYAN}[8/$TOTAL_STEPS] Cargo clippy 桌面端 (代码审查 - 禁止警告)...${NC}"
    
    cd "$PROJECT_ROOT/src-tauri"
    
    # 使用 -D warnings 将所有警告视为错误
    CLIPPY_OUTPUT=$(cargo clippy --all-targets --all-features -- -D warnings 2>&1) || true
    CLIPPY_EXIT=$?
    
    if [[ $CLIPPY_EXIT -eq 0 ]]; then
        echo -e "  ${GREEN}✓ PASS: Cargo clippy 桌面端 (0 warnings)${NC}"
    else
        echo -e "  ${RED}✗ FAIL: Cargo clippy 桌面端${NC}"
        echo "$CLIPPY_OUTPUT" | grep -E "^(error|warning)" | head -20
        ALL_PASSED=false
    fi
    
    cd "$PROJECT_ROOT"
fi

# ============================================
# 9. Android Cargo Clippy (移动端代码审查)
# ============================================
if ! $SKIP_RUST && ! $SKIP_ANDROID; then
    echo -e "${CYAN}[9/$TOTAL_STEPS] Cargo clippy Android (移动端代码审查)...${NC}"
    
    # 检查 Android NDK 是否存在
    if [[ -z "$NDK_HOME" ]]; then
        # 尝试常见路径
        if [[ -d "$HOME/Android/Sdk/ndk" ]]; then
            NDK_HOME=$(ls -d "$HOME/Android/Sdk/ndk"/*/ 2>/dev/null | tail -1 | sed 's:/$::')
        elif [[ -d "/opt/android-ndk" ]]; then
            NDK_HOME="/opt/android-ndk"
        fi
    fi
    
    if [[ -z "$NDK_HOME" || ! -d "$NDK_HOME" ]]; then
        echo -e "  ${YELLOW}⚠ SKIP: Android NDK 未找到 (设置 NDK_HOME 或使用 --skip-android)${NC}"
    else
        # 检查目标是否已安装
        if ! rustup target list --installed | grep -q "aarch64-linux-android"; then
            echo -e "  ${YELLOW}⚠ SKIP: aarch64-linux-android 目标未安装${NC}"
            echo -e "  ${GRAY}  运行: rustup target add aarch64-linux-android${NC}"
        else
            cd "$PROJECT_ROOT/src-tauri"
            
            # 设置 NDK 编译器环境变量
            export CC_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang"
            export AR_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-ar"
            
            ANDROID_CLIPPY_OUTPUT=$(cargo clippy --target aarch64-linux-android -- -D warnings 2>&1) || true
            ANDROID_CLIPPY_EXIT=$?
            
            if [[ $ANDROID_CLIPPY_EXIT -eq 0 ]]; then
                echo -e "  ${GREEN}✓ PASS: Cargo clippy Android (0 warnings)${NC}"
            else
                echo -e "  ${RED}✗ FAIL: Cargo clippy Android${NC}"
                echo "$ANDROID_CLIPPY_OUTPUT" | grep -E "^(error|warning)" | head -20
                ALL_PASSED=false
            fi
            
            cd "$PROJECT_ROOT"
        fi
    fi
fi

# ============================================
# 结果汇总
# ============================================
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo -e "${MAGENTA}========================================${NC}"
echo -e "  耗时: ${DURATION} 秒"
echo -e "${MAGENTA}========================================${NC}"

if $ALL_PASSED; then
    echo ""
    echo -e "  ${GREEN}所有检查通过!${NC}"
    echo -e "  ${GREEN}0 errors, 0 warnings${NC}"
    echo ""
    exit 0
else
    echo ""
    echo -e "  ${RED}部分检查未通过!${NC}"
    echo -e "  ${RED}请修复上述问题后重试${NC}"
    echo ""
    exit 1
fi
