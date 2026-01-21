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
#   ./scripts/linux/test-all.sh --skip-rust  # 跳过 Rust 检查

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
for arg in "$@"; do
    case $arg in
        --skip-rust) SKIP_RUST=true ;;
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
TOTAL_STEPS=8
if $SKIP_RUST; then
    TOTAL_STEPS=7
fi

# ============================================
# 1. NSIS 安装钩子检查 (Windows 更新兼容性)
# ============================================
echo -e "${CYAN}[1/$TOTAL_STEPS] NSIS 安装钩子检查...${NC}"

NSIS_HOOKS="$PROJECT_ROOT/src-tauri/nsis/installer-hooks.nsh"
if [[ -f "$NSIS_HOOKS" ]]; then
    # 检查是否包含关闭运行中应用的逻辑（必须包含小写进程名）
    if grep -qi "taskkill.*huanvae-chat-app.exe" "$NSIS_HOOKS"; then
        echo -e "  ${GREEN}✓ PASS: NSIS 钩子包含关闭运行中应用逻辑${NC}"
    else
        echo -e "  ${RED}✗ FAIL: NSIS 钩子缺少关闭运行中应用逻辑${NC}"
        echo -e "  ${RED}  Windows 更新时可能出现 'exe 无法写入' 错误${NC}"
        ALL_PASSED=false
    fi
else
    echo -e "  ${YELLOW}⚠ SKIP: NSIS 钩子文件不存在${NC}"
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
    # 检查 Vite 优化警告
    if echo "$BUILD_OUTPUT" | grep -q "\[plugin vite:reporter\]"; then
        WARNING_COUNT=$(echo "$BUILD_OUTPUT" | grep -c "\[plugin vite:reporter\]" || echo "0")
        echo -e "  ${RED}✗ FAIL: 构建存在 $WARNING_COUNT 个 Vite 优化警告${NC}"
        echo "$BUILD_OUTPUT" | grep -A2 "\[plugin vite:reporter\]" | head -10
        ALL_PASSED=false
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
CLIPPY_STEP=$TOTAL_STEPS
if ! $SKIP_RUST; then
    echo -e "${CYAN}[8/$TOTAL_STEPS] Cargo clippy (代码审查 - 禁止警告)...${NC}"
    
    cd "$PROJECT_ROOT/src-tauri"
    
    # 使用 -D warnings 将所有警告视为错误
    CLIPPY_OUTPUT=$(cargo clippy --all-targets --all-features -- -D warnings 2>&1) || true
    CLIPPY_EXIT=$?
    
    if [[ $CLIPPY_EXIT -eq 0 ]]; then
        echo -e "  ${GREEN}✓ PASS: Cargo clippy (0 warnings)${NC}"
    else
        echo -e "  ${RED}✗ FAIL: Cargo clippy${NC}"
        echo "$CLIPPY_OUTPUT" | grep -E "^(error|warning)" | head -20
        ALL_PASSED=false
    fi
    
    cd "$PROJECT_ROOT"
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
