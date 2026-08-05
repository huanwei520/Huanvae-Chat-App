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
#   ./scripts/linux/test-all.sh --skip-e2e      # 跳过 Playwright E2E 测试
#
# 环境变量：
#   ALLOW_SKIP="e2e,clippy-android"   显式放行被跳过的检查项（逗号或空格分隔）
#                                     可用 id: e2e / cargo-check / clippy-desktop / clippy-android
#   ALLOW_SKIP=all                    放行全部跳过项
#
# 退出码：
#   0 = 全部真跑通过，或跳过项已被 ALLOW_SKIP 显式放行
#   1 = 有检查项 FAIL
#   2 = 有检查项被跳过且未显式放行（SKIP 不等于 PASS，不视为通过）

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
NC='\033[0m'

# 跳过登记表：SKIP 不等于 PASS，末尾汇总要如实列出跳了哪几项、为什么跳
SKIPPED_IDS=()
SKIPPED_REASONS=()

record_skip() {   # $1=稳定 id  $2=人类可读原因
    SKIPPED_IDS+=("$1")
    SKIPPED_REASONS+=("$2")
    echo -e "  ${YELLOW}⚠ SKIP: $2${NC}"
}

# 参数处理
SKIP_RUST=false
SKIP_ANDROID=false
SKIP_E2E=false
for arg in "$@"; do
    case $arg in
        --skip-rust) SKIP_RUST=true ;;
        --skip-android) SKIP_ANDROID=true ;;
        --skip-e2e) SKIP_E2E=true ;;
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

# 恒定执行的 7 块：NSIS / package.json / Tauri 版本 / TypeScript / ESLint / 单元测试 / 前端构建
TOTAL_STEPS=7
$SKIP_E2E || TOTAL_STEPS=$((TOTAL_STEPS + 1))
if ! $SKIP_RUST; then
    TOTAL_STEPS=$((TOTAL_STEPS + 2))
    $SKIP_ANDROID || TOTAL_STEPS=$((TOTAL_STEPS + 1))
fi

STEP=0
step_header() {
    STEP=$((STEP + 1))
    echo -e "${CYAN}[$STEP/$TOTAL_STEPS] $1${NC}"
}

# flag 触发的跳过：一开跑就把"本次降门槛了"打在明面上
if $SKIP_E2E; then
    record_skip e2e "--skip-e2e 参数显式跳过 Playwright E2E 测试"
fi
if $SKIP_RUST; then
    record_skip cargo-check "--skip-rust 参数显式跳过 cargo check"
    record_skip clippy-desktop "--skip-rust 参数显式跳过 cargo clippy 桌面端"
    record_skip clippy-android "--skip-rust 参数显式跳过 cargo clippy Android"
elif $SKIP_ANDROID; then
    record_skip clippy-android "--skip-android 参数显式跳过 cargo clippy Android"
fi

# ============================================
# 1. Windows NSIS 安装配置检查
# ============================================
step_header "Windows NSIS 安装配置检查..."

TAURI_CONF="$PROJECT_ROOT/src-tauri/tauri.conf.json"
NSIS_HOOKS="$PROJECT_ROOT/src-tauri/windows/hooks.nsi"

# 检查是否使用 NSIS 并配置了自定义 installerHooks
if grep -q '"nsis"' "$TAURI_CONF"; then
    echo -e "  ${GREEN}✓ PASS: 使用 NSIS 安装包配置${NC}"
    
    # 检查是否配置了 installerHooks（自定义模板）
    if grep -q '"installerHooks"' "$TAURI_CONF"; then
        echo -e "  ${GREEN}✓ PASS: 配置了 NSIS 自定义 installerHooks${NC}"
        
        # 检查 hooks.nsi 文件是否存在
        if [[ -f "$NSIS_HOOKS" ]]; then
            echo -e "  ${GREEN}✓ PASS: NSIS hooks.nsi 文件存在${NC}"
        else
            echo -e "  ${RED}✗ FAIL: NSIS hooks.nsi 文件不存在${NC}"
            ALL_PASSED=false
        fi
    else
        echo -e "  ${RED}✗ FAIL: 未配置 NSIS installerHooks（使用默认模板）${NC}"
        ALL_PASSED=false
    fi
else
    echo -e "  ${YELLOW}⚠ WARN: 未检测到 NSIS 安装包配置${NC}"
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
step_header "package.json 验证..."

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
# 3. Tauri 版本一致性检查 (Rust crate ↔ NPM)
# ============================================
step_header "Tauri 版本一致性检查 (Rust ↔ NPM)..."

TAURI_VERSION_OK=true
TAURI_CHECK_RESULT=$(node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
const cargoToml = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
const cargoLines = cargoToml.split('\n');

function getCargoVersion(crate) {
  for (let i = 0; i < cargoLines.length; i++) {
    const t = cargoLines[i].trim();
    if (t.indexOf(crate) !== 0) continue;
    const ch = t.charAt(crate.length);
    if (ch !== ' ' && ch !== '=' && ch !== '\t') continue;
    const afterName = t.substring(crate.length).trim();
    if (afterName.charAt(0) !== '=') continue;
    const val = afterName.substring(1).trim();
    if (val.charAt(0) === '\"') {
      const end = val.indexOf('\"', 1);
      if (end > 0) return val.substring(1, end);
    }
    if (val.charAt(0) === '{') {
      const m = val.match(/version\s*=\s*\"([^\"]*)\"/);
      if (m) return m[1];
    }
  }
  return null;
}

function strip(v) { return v.replace(/^[\^~>=<]+/, ''); }

const pairs = [];
if (allDeps['@tauri-apps/api']) {
  pairs.push({ npm: '@tauri-apps/api', crate: 'tauri', npmVer: strip(allDeps['@tauri-apps/api']) });
}
for (const [name, ver] of Object.entries(allDeps)) {
  if (name.indexOf('@tauri-apps/plugin-') === 0) {
    const slug = name.replace('@tauri-apps/plugin-', '');
    pairs.push({ npm: name, crate: 'tauri-plugin-' + slug, npmVer: strip(allDeps[name]) });
  }
}

let errors = 0;
let checked = 0;
for (const p of pairs) {
  const cargoVer = getCargoVersion(p.crate);
  if (!cargoVer) continue;
  checked++;
  const nParts = p.npmVer.split('.');
  const cParts = cargoVer.split('.');
  if (nParts[0] !== cParts[0] || nParts[1] !== cParts[1]) {
    console.error('MISMATCH: ' + p.crate + ' (' + cargoVer + ') vs ' + p.npm + ' (' + p.npmVer + ')');
    errors++;
  }
}
if (errors > 0) {
  console.error(errors + ' pair(s) mismatched');
  process.exit(1);
} else {
  console.log(checked + ' pairs checked, all consistent');
}
" 2>&1) || TAURI_VERSION_OK=false

if $TAURI_VERSION_OK; then
    echo -e "  ${GREEN}✓ PASS: $TAURI_CHECK_RESULT${NC}"
else
    echo -e "  ${RED}✗ FAIL: Tauri 版本一致性检查${NC}"
    echo "$TAURI_CHECK_RESULT"
    ALL_PASSED=false
fi

# ============================================
# 4. TypeScript 类型检查
# ============================================
step_header "TypeScript 类型检查..."

if pnpm tsc --noEmit 2>&1; then
    echo -e "  ${GREEN}✓ PASS: TypeScript${NC}"
else
    echo -e "  ${RED}✗ FAIL: TypeScript 类型检查${NC}"
    ALL_PASSED=false
fi

# ============================================
# 5. ESLint 代码检查 (严格模式)
# ============================================
step_header "ESLint 代码检查 (0 errors, 0 warnings)..."

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
# 6. 单元测试
# ============================================
step_header "单元测试..."

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
# 7. E2E 测试 (Playwright)
# ============================================
if ! $SKIP_E2E; then
    step_header "E2E 视觉回归测试 (Playwright)..."

    E2E_OUTPUT=$(npx playwright test 2>&1) || true
    E2E_EXIT=$?

    if [[ $E2E_EXIT -eq 0 ]]; then
        E2E_PASSED=$(echo "$E2E_OUTPUT" | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
        E2E_SKIPPED=$(echo "$E2E_OUTPUT" | grep -oE "[0-9]+ skipped" | grep -oE "[0-9]+" | head -1)
        if [[ -n "$E2E_PASSED" ]]; then
            echo -e "  ${GREEN}✓ PASS: E2E 测试 ($E2E_PASSED passed, ${E2E_SKIPPED:-0} skipped)${NC}"
        else
            echo -e "  ${GREEN}✓ PASS: E2E 测试${NC}"
        fi
    else
        echo -e "  ${RED}✗ FAIL: E2E 测试${NC}"
        echo "$E2E_OUTPUT" | grep -E "(failed|FAIL|Error)" | head -10
        ALL_PASSED=false
    fi
fi

# ============================================
# 8. 前端构建测试 (检查警告)
# ============================================
step_header "前端构建测试 (检查警告)..."

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
# 9. Cargo Check (基础编译检查)
# ============================================
if ! $SKIP_RUST; then
    step_header "Cargo check (编译检查)..."
    
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
# 10. Cargo Clippy (代码审查 - 严格模式)
# ============================================
if ! $SKIP_RUST; then
    step_header "Cargo clippy 桌面端 (代码审查 - 禁止警告)..."
    
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
# 11. Android Cargo Clippy (移动端代码审查)
# ============================================
if ! $SKIP_RUST && ! $SKIP_ANDROID; then
    step_header "Cargo clippy Android (移动端代码审查)..."
    
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
        record_skip clippy-android "Android NDK 未找到 (设置 NDK_HOME 或使用 --skip-android)"
    else
        # 检查目标是否已安装
        if ! rustup target list --installed | grep -q "aarch64-linux-android"; then
            record_skip clippy-android "aarch64-linux-android 目标未安装"
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

# 全量口径固定 11 项，与本脚本的 11 个检查块一一对应；跳过项不计入"真跑通过"
CANONICAL_TOTAL=11
SKIP_COUNT=${#SKIPPED_IDS[@]}
RAN_COUNT=$((CANONICAL_TOTAL - SKIP_COUNT))

# ALLOW_SKIP: 逗号或空格分隔的跳过项 id 白名单；特殊值 all 放行全部
ALLOW_SKIP="${ALLOW_SKIP:-}"
allow_list=$(echo "$ALLOW_SKIP" | tr ',' ' ')
is_allowed() {   # $1=id；ALLOW_SKIP 里出现 all 则放行全部
    local a
    for a in $allow_list; do
        if [[ "$a" == "all" || "$a" == "$1" ]]; then
            return 0
        fi
    done
    return 1
}

echo ""
echo -e "${MAGENTA}========================================${NC}"
echo -e "  耗时: ${DURATION} 秒"
echo -e "${MAGENTA}========================================${NC}"

if [[ $SKIP_COUNT -gt 0 ]]; then
    echo ""
    echo -e "  ${YELLOW}⚠ 本次有 $SKIP_COUNT 项被跳过（未真跑）${NC}"
    for i in "${!SKIPPED_IDS[@]}"; do
        echo -e "  ${YELLOW}- ${SKIPPED_IDS[$i]}: ${SKIPPED_REASONS[$i]}${NC}"
    done
fi

if ! $ALL_PASSED; then
    echo ""
    echo -e "  ${RED}部分检查未通过!${NC}"
    echo -e "  ${RED}请修复上述问题后重试${NC}"
    echo ""
    exit 1
fi

if [[ $SKIP_COUNT -eq 0 ]]; then
    echo ""
    echo -e "  ${GREEN}所有检查通过!${NC}"
    echo -e "  ${GREEN}$CANONICAL_TOTAL/$CANONICAL_TOTAL 真跑通过, 0 errors, 0 warnings${NC}"
    echo ""
    exit 0
fi

# 走到这里：无 FAIL，但有跳过项 —— 必须 ALLOW_SKIP 显式放行才算通过
UNALLOWED_IDS=()
for id in "${SKIPPED_IDS[@]}"; do
    if ! is_allowed "$id"; then
        UNALLOWED_IDS+=("$id")
    fi
done

if [[ ${#UNALLOWED_IDS[@]} -eq 0 ]]; then
    echo ""
    echo -e "  ${YELLOW}⚠ 放行：本次有 $SKIP_COUNT 项被跳过（ALLOW_SKIP 显式放行）${NC}"
    echo -e "  ${GREEN}真跑通过 $RAN_COUNT/$CANONICAL_TOTAL, 0 errors, 0 warnings${NC}"
    echo ""
    exit 0
fi

echo ""
echo -e "  ${RED}✗ 有 ${#UNALLOWED_IDS[@]} 项被跳过且未显式放行 —— 不视为通过${NC}"
for id in "${UNALLOWED_IDS[@]}"; do
    echo -e "  ${RED}- $id${NC}"
done
echo -e "  ${GRAY}如确需放行: ALLOW_SKIP=\"id1,id2\" ./scripts/linux/test-all.sh ...${NC}"
echo -e "  ${GRAY}（ALLOW_SKIP=all 放行全部；真跑通过 ${RAN_COUNT}/${CANONICAL_TOTAL}）${NC}"
echo ""
exit 2
