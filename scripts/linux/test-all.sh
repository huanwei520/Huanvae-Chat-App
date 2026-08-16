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
#   ./scripts/linux/test-all.sh --skip-rust     # 跳过 Rust 检查（cargo check / clippy / cargo test）
#   ./scripts/linux/test-all.sh --skip-android  # 跳过 Android clippy 检查
#   ./scripts/linux/test-all.sh --skip-e2e      # 跳过 Playwright E2E 测试
#   ./scripts/linux/test-all.sh --skip-vpn      # 跳过 VPN 连通性测试
#
#   # 本机没有 Android NDK 时，把第 11 项交给远程构建宿主真跑（不是跳过）：
#   ANDROID_CLIPPY_HOST=user@host ./scripts/linux/test-all.sh
#
# 环境变量：
#   ALLOW_SKIP="e2e,clippy-android"   显式放行被跳过的检查项（逗号或空格分隔）
#                                     可用 id: e2e / cargo-check / clippy-desktop / clippy-android /
#                                              cargo-test / vpn-connectivity
#   ALLOW_SKIP=all                    放行全部跳过项
#
#   --- 第 11 项 Android clippy 的远程执行（本机无 NDK 时的正路，见该块注释的三态优先级）---
#   ANDROID_CLIPPY_HOST               远程 Android 构建宿主的 ssh 目标（形如 user@host）。**无默认值**
#                                     —— 本仓是 PUBLIC 公开仓，不写任何内网地址 / 主机名 / 账号；
#                                     该值只在运行时经环境变量注入，不落盘、不入日志
#   ANDROID_CLIPPY_REMOTE_DIR         该宿主上的源码同步目录   默认 /tmp/hv-clippy-android
#   ANDROID_CLIPPY_REMOTE_NDK_HOME    远程 NDK 路径；不设则由远程按常见位置自动探测
#   ANDROID_CLIPPY_SSH_OPTS           追加给 ssh/scp 的参数（如 "-i ~/.ssh/somekey"）
#   ANDROID_CLIPPY_JOBS               远程 cargo 并发度         默认 8（构建宿主常跑着别的服务，别抢爆）
#
#   🔴 设了 ANDROID_CLIPPY_HOST 却连不上 / 同步失败 / 远程无工具链 / 远程 clippy 非 0
#      一律 FAIL，**绝不自动退回跳过** —— 自动退回等于把"没跑"重新伪装成"环境不具备"。
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
SKIP_VPN=false
for arg in "$@"; do
    case $arg in
        --skip-rust) SKIP_RUST=true ;;
        --skip-android) SKIP_ANDROID=true ;;
        --skip-e2e) SKIP_E2E=true ;;
        --skip-vpn) SKIP_VPN=true ;;
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

# 无 flag 时恒定执行的 8 块：
#   NSIS / package.json / Tauri 版本 / TypeScript / ESLint / 单元测试 / 前端构建 / VPN 连通性
# 其中 VPN 块与 E2E 块同口径：--skip-* 时不执行（不计入 TOTAL_STEPS），但仍登记进跳过表。
TOTAL_STEPS=7
$SKIP_E2E || TOTAL_STEPS=$((TOTAL_STEPS + 1))
$SKIP_VPN || TOTAL_STEPS=$((TOTAL_STEPS + 1))
if ! $SKIP_RUST; then
    # cargo check / cargo clippy 桌面 / cargo test
    TOTAL_STEPS=$((TOTAL_STEPS + 3))
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
    record_skip cargo-test "--skip-rust 参数显式跳过 cargo test"
elif $SKIP_ANDROID; then
    record_skip clippy-android "--skip-android 参数显式跳过 cargo clippy Android"
fi
if $SKIP_VPN; then
    record_skip vpn-connectivity "--skip-vpn 参数显式跳过 VPN 连通性测试"
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
    # 🔴 WARN -> FAIL（2026-08-16）：只打黄字的守卫等于没有守卫 —— ⚠ WARN 既不 FAIL、
    # 也不登记进跳过表，末尾汇总里完全看不见，与"根本没有这条检查"逐字同形。
    # NSIS 是本仓 Windows 唯一发货形态，这里落空就是配置真的坏了，必须红。
    echo -e "  ${RED}✗ FAIL: 未检测到 NSIS 安装包配置${NC}"
    ALL_PASSED=false
fi

# 🔴 installMode 这个键名在 tauri.conf.json 里出现两次（bundle.windows.nsis 与
# plugins.updater.windows），语义完全不同 —— 纯文本 grep 在这里是**假阳判据**
# （会把另一处的命中算到自己头上）。凡是判 installMode 一律走结构化取键（node -p），
# 别退回 grep。node 是本脚本的既有依赖（下面 package.json 验证那节也在用）。
UPDATER_INSTALL_MODE=$(node -p "(JSON.parse(require('fs').readFileSync('$TAURI_CONF','utf8')).plugins?.updater?.windows?.installMode) ?? ''" 2>/dev/null || echo '')
NSIS_INSTALL_MODE=$(node -p "(JSON.parse(require('fs').readFileSync('$TAURI_CONF','utf8')).bundle?.windows?.nsis?.installMode) ?? ''" 2>/dev/null || echo '')

# 更新器 installMode：必须【显式】为 passive。
# 上游 WindowsUpdateInstallMode 把 Passive 标成 #[default]，所以"没写这个键"= 仍是 passive、
# 只是看不见 —— 本仓要求写出来并被钉住。极性与 scripts/pre-release.ps1 的配置检查一致。
if [[ "$UPDATER_INSTALL_MODE" == "passive" ]]; then
    echo -e "  ${GREEN}✓ PASS: 更新器配置为静默安装模式 (installMode = passive)${NC}"
else
    echo -e "  ${RED}✗ FAIL: plugins.updater.windows.installMode 必须显式为 'passive'（实际: '$UPDATER_INSTALL_MODE'）${NC}"
    ALL_PASSED=false
fi

# NSIS 安装模式：必须 perMachine。hooks.nsi 的 sc.exe create/sdset 要 SCM 写权限，
# 而安装器是否提权完全由这个键决定（perMachine -> RequestExecutionLevel admin）。
# 退回 currentUser = 服务注册在每台机器上静默失败，正是 v1.1.35 之前的原始故障。
if [[ "$NSIS_INSTALL_MODE" == "perMachine" ]]; then
    echo -e "  ${GREEN}✓ PASS: NSIS 安装模式为 perMachine（安装器提权，服务注册才可能成功）${NC}"
else
    echo -e "  ${RED}✗ FAIL: bundle.windows.nsis.installMode 必须为 'perMachine'（实际: '$NSIS_INSTALL_MODE'）${NC}"
    ALL_PASSED=false
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

# rc 必须写成 `|| VAR=$?`：`|| true` 会让 $? 恒为 0（取的是整个列表的退出码），
# FAIL 分支从而结构上永远进不去。下同（本文件曾有 6 处踩此坑）。
ESLINT_EXIT=0
ESLINT_OUTPUT=$(pnpm lint 2>&1) || ESLINT_EXIT=$?

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

TEST_EXIT=0
TEST_OUTPUT=$(pnpm test --run 2>&1) || TEST_EXIT=$?

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

    E2E_EXIT=0
    E2E_OUTPUT=$(npx playwright test 2>&1) || E2E_EXIT=$?

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

BUILD_EXIT=0
BUILD_OUTPUT=$(pnpm build 2>&1) || BUILD_EXIT=$?

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
    CLIPPY_EXIT=0
    CLIPPY_OUTPUT=$(cargo clippy --all-targets --all-features -- -D warnings 2>&1) || CLIPPY_EXIT=$?
    
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
# 三态优先级（本机 → 远程构建宿主 → 才允许跳过）：
#   ① 本机有 NDK 且装了 aarch64-linux-android target → 本机跑（最快路径，行为与历来一致）
#   ② 本机不具备，但设了 ANDROID_CLIPPY_HOST         → 同步源码到远程 Android 构建宿主**真跑**，
#                                                      rc 与完整输出取回本机，按与本机完全相同的口径判 PASS/FAIL
#   ③ 两者都不具备                                    → record_skip，文案写**真实**原因（本机无 NDK
#                                                      **且**未配置远程宿主），仍走「SKIP ≠ PASS」路径
#
# 🔴 ② 里任何一步失败（连不上 / 同步失败 / 远程无工具链 / 远程 clippy 非 0）一律 FAIL，
#    **绝不自动退回 ③ 的 skip** —— 自动退回等于把"没跑"重新伪装成"环境不具备"，
#    正是本块要根治的病（v1.1.30 就是以「本机无 NDK」为由 ALLOW_SKIP 放行的，
#    而本仓一直有可用的远程 Android 构建宿主）。
#
# 判定码在 run_android_clippy_remote 与调用方之间一一对应，**文案必须能区分**
#   「连不上远程」和「远程 clippy 真报了告警」—— 否则排障时分不清是网络问题还是代码问题。

# 内层：真正干活；临时目录由外层 run_android_clippy_remote 负责建与清，这里只管早返回。
_android_clippy_remote_run() {
    local out_file="$1" work="$2" host="$3" rdir="$4"
    local tgz="$work/src.tgz" runner="$work/runner.sh"
    local ssh_opts=(-o BatchMode=yes -o ConnectTimeout=15)
    local extra=()

    if [[ -n "$ANDROID_CLIPPY_SSH_OPTS" ]]; then
        read -ra extra <<< "$ANDROID_CLIPPY_SSH_OPTS"
        ssh_opts+=("${extra[@]}")
    fi

    # --- 连通性预检：先把"连不上"与"远程真报错"分开，后面才好给出可区分的文案 ---
    # 这里用 -n：本函数不经 stdin 喂脚本，若不加 -n，ssh 会吃掉 test-all.sh 自己的 stdin。
    if ! ssh -n "${ssh_opts[@]}" "$host" true >>"$out_file" 2>&1; then
        return 30
    fi

    # --- 打包源码：白名单，只带 clippy 真正需要的东西 ---
    # 🔴 必须是白名单而不是黑名单：仓根还有 data/（App 本地运行数据，含聊天库与用户文件，
    #    实测 150MB+），黑名单漏一条就等于把用户数据推到远程宿主上去。
    # src-tauri/target 与 src-tauri/gen 是构建产物（gen/schemas 由 tauri-build 自己重生），不带。
    # Notification-Sounds 是 tauri.conf.json bundle.resources 引用的路径，一并带上。
    if ! COPYFILE_DISABLE=1 tar -czf "$tgz" \
            --exclude 'src-tauri/target' --exclude 'src-tauri/gen' \
            -C "$PROJECT_ROOT" src-tauri Notification-Sounds >>"$out_file" 2>&1; then
        return 21
    fi

    # --- 生成远程 runner（值经 printf %q 转义，杜绝注入）---
    {
        printf 'RDIR=%s\n' "$(printf '%q' "$rdir")"
        printf 'NDK_OVERRIDE=%s\n' "$(printf '%q' "$ANDROID_CLIPPY_REMOTE_NDK_HOME")"
        printf 'JOBS=%s\n' "$(printf '%q' "${ANDROID_CLIPPY_JOBS:-8}")"
        cat <<'RUNNER_EOF'
# 非交互 shell 不读 ~/.cargo/env ⇒ rustup 装的 cargo 不在 PATH。
# 实测踩过：据此误判"远程没有 cargo"，而它其实就在 ~/.cargo/bin 下。
if ! command -v cargo >/dev/null 2>&1 && [ -f "$HOME/.cargo/env" ]; then
    . "$HOME/.cargo/env"
fi
if ! command -v cargo >/dev/null 2>&1; then
    echo "远程宿主 PATH 里找不到 cargo（PATH=$PATH）"
    exit 20
fi

NDK="$NDK_OVERRIDE"
if [ -z "$NDK" ]; then
    for c in "$NDK_HOME" "$ANDROID_NDK_HOME" "$ANDROID_HOME"/ndk/*/ "$ANDROID_SDK_ROOT"/ndk/*/ \
             "$HOME"/Android/Sdk/ndk/*/ "$HOME"/*/android-sdk/ndk/*/ /opt/android-ndk; do
        [ -n "$c" ] || continue
        c="${c%/}"
        [ -d "$c" ] && NDK="$c"
    done
fi
if [ -z "$NDK" ] || [ ! -d "$NDK" ]; then
    echo "远程宿主未找到 Android NDK（可用 ANDROID_CLIPPY_REMOTE_NDK_HOME 显式指定）"
    exit 20
fi
CLANG="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang"
AR="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-ar"
if [ ! -x "$CLANG" ] || [ ! -x "$AR" ]; then
    echo "远程 NDK 工具链不完整（缺 $CLANG 或 $AR）"
    exit 20
fi
if ! rustup target list --installed </dev/null 2>/dev/null | grep -q '^aarch64-linux-android$'; then
    echo "远程宿主未安装 aarch64-linux-android target（rustup target add aarch64-linux-android）"
    exit 20
fi

rm -rf "$RDIR" && mkdir -p "$RDIR" || exit 21
tar -xzf "$RDIR.tgz" -C "$RDIR" 2>/dev/null || exit 21
[ -d "$RDIR/src-tauri" ] || { echo "解包后缺 src-tauri"; exit 21; }

# 构建缓存放在被清空的源码树之外：源码树每次全新解包（不留上次残留），
# 而 cargo 增量缓存得以跨次保留（否则每次都是冷编）。
export CARGO_TARGET_DIR="${RDIR}-target"
export CC_aarch64_linux_android="$CLANG"
export AR_aarch64_linux_android="$AR"
cd "$RDIR/src-tauri" || exit 21

echo "远程 NDK: $NDK"
echo "远程 clippy: $(cargo clippy --version </dev/null 2>&1)"
CLIPPY_RC=0
cargo clippy --target aarch64-linux-android -j "$JOBS" -- -D warnings </dev/null 2>&1 || CLIPPY_RC=$?
echo "__HV_ANDROID_CLIPPY_DONE__ rc=$CLIPPY_RC"
[ "$CLIPPY_RC" -eq 0 ] || exit 22
exit 0
RUNNER_EOF
    } > "$runner"

    # --- 上传源码包（scp 也吃 stdin，同样要挡住）---
    if ! scp "${ssh_opts[@]}" "$tgz" "$host:$rdir.tgz" </dev/null >>"$out_file" 2>&1; then
        return 21
    fi

    # --- 真跑：runner 经 stdin 喂给远程 bash -s ---
    # 🔴 这条 ssh 绝不能加 -n：它要靠 stdin 收 runner 正文（加了 = 脚本没送到，rc=0 且输出全空）。
    #    `< "$runner"` 同时也把 test-all.sh 自己的 stdin 挡在外面。
    local rc=0
    ssh "${ssh_opts[@]}" "$host" 'bash -s' < "$runner" >>"$out_file" 2>&1 || rc=$?

    # 拿不到结束哨兵 = 远程没跑完（中途断连等），不能当成"通过"
    if [[ $rc -eq 0 ]] && ! grep -q '__HV_ANDROID_CLIPPY_DONE__' "$out_file"; then
        return 31
    fi

    case "$rc" in
        0)  return 0  ;;
        20) return 20 ;;
        21) return 21 ;;
        22) return 22 ;;
        255) return 30 ;;   # ssh 自身错误（连接中断 / 认证失败）
        *)  return 31 ;;
    esac
}

run_android_clippy_remote() {
    local out_file="$1"
    local host="$ANDROID_CLIPPY_HOST"
    local rdir="${ANDROID_CLIPPY_REMOTE_DIR:-/tmp/hv-clippy-android}"
    local work ret=0
    work="$(mktemp -d)" || return 21
    _android_clippy_remote_run "$out_file" "$work" "$host" "$rdir" || ret=$?
    rm -rf "$work"
    return $ret
}

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

    LOCAL_ANDROID_READY=false
    if [[ -n "$NDK_HOME" && -d "$NDK_HOME" ]] \
        && rustup target list --installed 2>/dev/null | grep -q "aarch64-linux-android"; then
        LOCAL_ANDROID_READY=true
    fi

    if $LOCAL_ANDROID_READY; then
        # --- ① 本机跑 ---
        cd "$PROJECT_ROOT/src-tauri"

        # 设置 NDK 编译器环境变量
        export CC_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang"
        export AR_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-ar"

        ANDROID_CLIPPY_EXIT=0
        ANDROID_CLIPPY_OUTPUT=$(cargo clippy --target aarch64-linux-android -- -D warnings 2>&1) || ANDROID_CLIPPY_EXIT=$?

        if [[ $ANDROID_CLIPPY_EXIT -eq 0 ]]; then
            echo -e "  ${GREEN}✓ PASS: Cargo clippy Android (本机, 0 warnings)${NC}"
        else
            echo -e "  ${RED}✗ FAIL: Cargo clippy Android (本机)${NC}"
            echo "$ANDROID_CLIPPY_OUTPUT" | grep -E "^(error|warning)" | head -20
            ALL_PASSED=false
        fi

        cd "$PROJECT_ROOT"
    elif [[ -n "$ANDROID_CLIPPY_HOST" ]]; then
        # --- ② 远程构建宿主真跑 ---
        echo -e "  ${GRAY}  本机无 Android NDK/target，改由远程构建宿主执行（主机经 ANDROID_CLIPPY_HOST 注入，不落盘、不入日志）${NC}"
        ANDROID_REMOTE_LOG=$(mktemp)
        ANDROID_REMOTE_RC=0
        run_android_clippy_remote "$ANDROID_REMOTE_LOG" || ANDROID_REMOTE_RC=$?

        case "$ANDROID_REMOTE_RC" in
            0)
                echo -e "  ${GREEN}✓ PASS: Cargo clippy Android (远程构建宿主, 0 warnings)${NC}"
                ;;
            30)
                echo -e "  ${RED}✗ FAIL: 连不上远程 Android 构建宿主（网络 / 凭据问题，不是代码问题）${NC}"
                echo -e "  ${RED}        ANDROID_CLIPPY_HOST 已设置但 ssh 不通；如需临时绕开请用 --skip-android 并如实报告${NC}"
                tail -20 "$ANDROID_REMOTE_LOG"
                ALL_PASSED=false
                ;;
            21)
                echo -e "  ${RED}✗ FAIL: 源码同步到远程构建宿主失败（打包 / scp / 远程解包环节，不是代码问题）${NC}"
                tail -20 "$ANDROID_REMOTE_LOG"
                ALL_PASSED=false
                ;;
            20)
                echo -e "  ${RED}✗ FAIL: 远程构建宿主不具备 Android 工具链（NDK / aarch64-linux-android target 缺失）${NC}"
                tail -20 "$ANDROID_REMOTE_LOG"
                ALL_PASSED=false
                ;;
            22)
                echo -e "  ${RED}✗ FAIL: Cargo clippy Android (远程构建宿主报告错误 / 告警 —— 这是代码问题)${NC}"
                grep -E "^(error|warning)" "$ANDROID_REMOTE_LOG" | head -20
                ALL_PASSED=false
                ;;
            *)
                echo -e "  ${RED}✗ FAIL: 远程 Android clippy 执行异常（未拿到结束哨兵，判定码 ${ANDROID_REMOTE_RC}）${NC}"
                tail -20 "$ANDROID_REMOTE_LOG"
                ALL_PASSED=false
                ;;
        esac

        rm -f "$ANDROID_REMOTE_LOG"
    else
        # --- ③ 本机与远程都不具备：如实写清两个条件都不满足 ---
        record_skip clippy-android "本机无 Android NDK/target，且未配置远程构建宿主 —— 设 ANDROID_CLIPPY_HOST=user@host 走远程真跑（推荐），或设 NDK_HOME 本机跑，或 --skip-android"
    fi
fi

# ============================================
# 12. Cargo test（Rust 单元测试 + 发货二进制静态守卫）
# ============================================
# 为什么必须有这一块：
#   src-tauri/src/desktop/huanvaeguard_macos.rs 的 #[cfg(test)] 里有两条**发货件守卫** ——
#     · bundled_daemon_binary_understands_every_flag_in_bundled_plist
#       （打包 plist 里每个 -- 开关，都必须真出现在打包二进制的字节里；否则守护进程启动即退、
#         KeepAlive 下崩溃循环，而安装链每一步都"成功"，没有任何地方会报错）
#     · bundled_daemon_binary_leaks_no_build_host_paths
#       （PUBLIC 仓脱敏：发货二进制里不得含 /Users/、/home/、C:\Users 等构建机绝对路径）
#   既有门禁只跑 cargo check + clippy，**从不运行测试** —— 这两条守卫等于没接线。本块把它们接上。
if ! $SKIP_RUST; then
    step_header "Cargo test (Rust 单元测试 + 发货二进制静态守卫)..."

    cd "$PROJECT_ROOT/src-tauri"

    CARGO_TEST_EXIT=0
    CARGO_TEST_OUTPUT=$(cargo test --lib 2>&1) || CARGO_TEST_EXIT=$?

    if [[ $CARGO_TEST_EXIT -eq 0 ]]; then
        CARGO_TEST_PASSED=$(printf '%s\n' "$CARGO_TEST_OUTPUT" | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
        if [[ -n "$CARGO_TEST_PASSED" ]]; then
            echo -e "  ${GREEN}✓ PASS: Cargo test (${CARGO_TEST_PASSED} 个测试)${NC}"
        else
            echo -e "  ${GREEN}✓ PASS: Cargo test${NC}"
        fi
    else
        echo -e "  ${RED}✗ FAIL: Cargo test${NC}"
        # 失败摘要优先打失败用例名 / 编译错误；没匹配到再打末尾 20 行，避免"报了 FAIL 却什么都看不到"
        CARGO_TEST_SUMMARY=$(printf '%s\n' "$CARGO_TEST_OUTPUT" \
            | grep -E "^(error|failures:|test .* FAILED|test result: FAILED)" | head -20)
        if [[ -n "$CARGO_TEST_SUMMARY" ]]; then
            printf '%s\n' "$CARGO_TEST_SUMMARY"
        else
            printf '%s\n' "$CARGO_TEST_OUTPUT" | tail -20
        fi
        ALL_PASSED=false
    fi

    cd "$PROJECT_ROOT"
fi

# ============================================
# 13. VPN 连通性测试（真握手 + 真收发包 + 端到端 ping）
# ============================================
# 判据不是"服务起来了"，而是真握手 + 两向真收发包 + 端到端 ping ——
# 已发生过"服务状态看着正常，但上下行包均为 0"的真实故障，只看状态发现不了。
#
# scripts/hg-connectivity-test.sh 的退出码是三态，这里必须按三态处理：
#   0 → PASS
#   3 → 本机物理上跑不了（**未执行**）：既不是通过也不是失败 → 登记为跳过，
#       未经 ALLOW_SKIP 显式放行时 test-all 以退出码 2 结束 → 发布中止
#   其它 → FAIL
# 该脚本的**完整原始输出原样打印**（不只打结论）：验收要看五项各自的判据原文与原始命令输出。
if ! $SKIP_VPN; then
    step_header "VPN 连通性测试 (真握手 + 真收发包 + 端到端 ping)..."

    VPN_SCRIPT="$PROJECT_ROOT/scripts/hg-connectivity-test.sh"
    VPN_EXIT=0
    VPN_OUTPUT=$("$VPN_SCRIPT" 2>&1) || VPN_EXIT=$?
    printf '%s\n' "$VPN_OUTPUT"

    if [[ $VPN_EXIT -eq 0 ]]; then
        echo -e "  ${GREEN}✓ PASS: VPN 连通性测试 (5/5 真跑通过)${NC}"
    elif [[ $VPN_EXIT -eq 3 ]]; then
        # 取脚本自己打印的"未执行"原因（先剥掉 ANSI 颜色转义，否则原因里会混进控制字符）
        VPN_REASON=$(printf '%s\n' "$VPN_OUTPUT" | sed $'s/\033\\[[0-9;]*m//g' \
            | grep -o '本次未执行：.*' | head -1 | sed 's/^本次未执行：//')
        if [[ -z "$VPN_REASON" ]]; then
            VPN_REASON="hg-connectivity-test.sh 以退出码 3 结束（未打印具体原因）"
        fi
        record_skip vpn-connectivity "本机不具备执行条件（未设置对端 VIP / 未安装守护进程）：${VPN_REASON} —— 须在具备真实对端的机器上跑，或显式 ALLOW_SKIP=vpn-connectivity 放行并如实报告"
    else
        echo -e "  ${RED}✗ FAIL: VPN 连通性测试 (退出码 ${VPN_EXIT}，判据原文见上方原始输出)${NC}"
        ALL_PASSED=false
    fi
fi

# ============================================
# 结果汇总
# ============================================
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# 全量口径固定 13 项，与本脚本的 13 个检查块一一对应；跳过项不计入"真跑通过"
CANONICAL_TOTAL=13
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
