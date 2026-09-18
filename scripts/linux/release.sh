#!/bin/bash
#
# Huanvae Chat App 自动化版本发布脚本 (Linux)
#
# ## 功能
# 严格的版本发布流程（五层门禁管线），确保代码质量和版本一致性
# 测试通过后自动推送发布，无需手动确认
#
# ## 发布流程（2026-09-15 五层门禁改造，v3.1）
# 0. 自动版本规则：实时查 GitHub 最新正式 tag，+0.0.1 得出目标版本；目标已存在远端则
#    核对其 SHA 是否=本地 HEAD（同=已发布过→跳过；异=冲突→停住）。禁手工传参、禁盲涨号
#    （scripts/linux/auto-version.sh，旧「手工改 release-config.txt VERSION」流程废弃，
#    VERSION 行仅作提示；回滚：RELEASE_AUTO_VERSION=0 恢复旧口径）
# 1. 检查当前项目版本号一致性（package.json / Cargo.toml / tauri.conf.json）
# 2. 如果版本不一致，先更新所有版本号
# 3. 从 HuanvaeGuard 源码构建各平台 VPN 守护进程二进制并替换进 App 落点
#    （失败即中止，绝不回落仓里的旧二进制继续发布）
# 4. L0 代码门禁：运行完整测试（前后端 0 errors, 0 warnings；末项=产物内容断言 v2）
# 5. L2 平台安装冒烟（真机装包：Windows/macOS/Linux/Android 四腿）
#    + L3 全功能实测矩阵（十项必测，缺证即红，无 ALLOW_SKIP）
# 6. 同步依赖
# 7. 测试通过后自动进行 Git 提交、创建标签（并校验标签指向当前 HEAD，
#    不一致即中止且不推送）
# 8. 推送发布
# 9. L4 渠道下载验证：等待 CI 出包后，从 GitHub Release 下载正式包复算 SHA256
#    与 latest.json/android-latest.json 对账 + 包内容复验 + 实装交接
#    （scripts/linux/l4-channel-verify.sh）
#
# ## 五层门禁总览（唯一标准路径，详见 .claude/skills/release/SKILL.md）
#   L0 代码门禁 = 本脚本步骤4（test-all.sh 14 项，末项 L1 产物内容断言 v2）
#   L1 产物内容断言 = test-all.sh 第14步（必含件+期望SHA256 逐哈希，scripts/assert-artifact-content-v2.sh）
#                     + CI 侧 release.yml 每条构建腿出包后立即断言
#   L2 平台安装冒烟 = 本脚本步骤5（scripts/linux/l2-install-smoke.sh）
#   L3 全功能实测矩阵 = 本脚本步骤5（scripts/linux/l3-full-matrix.sh）
#   L4 渠道下载验证 = 本脚本步骤9（scripts/linux/l4-channel-verify.sh）
#
# ## 使用方法
# 1. 编辑 scripts/release-config.txt 设置更新说明（MESSAGE；VERSION 已废弃）
# 2. 运行: ./scripts/linux/release.sh
#    干跑（不写版本号/不 commit/不 push，逐层真跑证明管线可用）:
#    RELEASE_DRY_RUN=1 ./scripts/linux/release.sh
#
# ## 测试标准
# - 除了以下已知无害警告外，必须 0 errors, 0 warnings：
#   - Vite 动态导入优化提示 (dynamic import will not move module)
#   - ESLint no-await-in-loop (已用 eslint-disable 标记的合理用法)
#   - console.warn/error 调试日志（允许使用）
#
# @version 3.1（五层门禁版）
# @date 2026-09-15

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

# 干跑模式：逐层真跑但不写版本号/不 commit/不 push；L4 对最近已发布版本演示
DRY_RUN=false
[[ "${RELEASE_DRY_RUN:-0}" == "1" ]] && DRY_RUN=true

# 发布过程留档目录（auto-version / L2 / L3 / L4 输出全部落这里，发布记录的原料）
RELEASE_LOG_DIR="${RELEASE_LOG_DIR:-$PROJECT_ROOT/.release-logs}"
mkdir -p "$RELEASE_LOG_DIR"

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
    local tag_sha head_sha attempt
    head_sha=$(git rev-parse HEAD)

    # 🔴 读取重试：`git tag` 刚写完 .git/refs/tags/<tag>，紧接着读回时，在
    # virtiofs / 网络共享卷上会瞬时读不到（fatal: ambiguous argument ... unknown revision）。
    # 旧写法不区分「读失败」与「指向不符」—— rev-parse 失败让 tag_sha 变空串，
    # 空串 != head_sha 于是误判成"标签指错"并中止发布。
    # v1.1.22/23/24/25/26 连续五次命中，每次都要人工取证后手动 push。
    # ref 本身是好的（同期 `cat .git/refs/tags/<tag>` 恒能读出正确 sha），纯属可见性滞后，
    # 因此这里退避重试；只有「读到了、但确实不等」才判失败。
    for attempt in 1 2 3 4 5; do
        tag_sha=$(git rev-parse "$tag^{commit}" 2>/dev/null) && [[ -n "$tag_sha" ]] && break
        # 第二判据：绕开 rev-parse 的缓存路径，直接读 ref 文件 / for-each-ref
        tag_sha=$(git for-each-ref --format='%(objectname)' "refs/tags/$tag" 2>/dev/null)
        [[ -n "$tag_sha" ]] && break
        sleep 0.2
    done

    if [[ -z "$tag_sha" ]]; then
        print_error "标签读取失败: $tag 重试 5 次仍读不出对象（ref 可能未落盘）"
        echo -e "  ${RED}HEAD:  $head_sha${NC}"
        echo -e "${YELLOW}  已中止，未推送任何内容。请人工核对：${NC}"
        echo -e "${YELLOW}    cat .git/refs/tags/$tag${NC}"
        echo -e "${YELLOW}    git for-each-ref refs/tags/$tag${NC}"
        return 1
    fi

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
print_header "Huanvae Chat App 自动发布（五层门禁管线）"

if [[ ! -f "$CONFIG_PATH" ]]; then
    print_error "配置文件未找到: $CONFIG_PATH"
    exit 1
fi

# 解析配置文件（VERSION 行已废弃——版本号由步骤0自动计算；MESSAGE 仍必需）
CONFIG_VERSION=""
RELEASE_MESSAGE=""
while IFS='=' read -r key value; do
    key=$(echo "$key" | tr -d '[:space:]')
    [[ -z "$key" || "$key" == \#* ]] && continue
    
    case "$key" in
        VERSION) CONFIG_VERSION="$value" ;;
        MESSAGE) RELEASE_MESSAGE="$value" ;;
    esac
done < "$CONFIG_PATH"

if [[ -z "$RELEASE_MESSAGE" ]]; then
    print_error "配置格式错误，需要 MESSAGE"
    echo ""
    echo "配置文件格式示例："
    echo "  MESSAGE=本次更新的一句话说明"
    exit 1
fi

# ============================================
# 步骤 0: 自动版本规则（禁手工传参/禁盲涨号）
# ============================================
print_step "0/9" "自动版本规则: 查 GitHub 最新正式 tag → +0.0.1 → 目标 tag 冲突核 SHA..."

if [[ "${RELEASE_AUTO_VERSION:-1}" == "0" ]]; then
    print_warn "RELEASE_AUTO_VERSION=0 —— 回滚到旧口径：版本号取 release-config.txt 的 VERSION 行（废弃路径，仅排障用）"
    TARGET_VERSION="$CONFIG_VERSION"
    if [[ -z "$TARGET_VERSION" ]]; then
        print_error "配置缺少 VERSION（旧口径下必需）"
        exit 1
    fi
else
    AUTO_VERSION_LOG="$RELEASE_LOG_DIR/auto-version.log" \
    AV_OUTPUT=$("$SCRIPT_DIR/auto-version.sh") || AV_RC=$?
    printf '%s\n' "$AV_OUTPUT"
    if [[ "${AV_RC:-0}" -ne 0 ]]; then
        print_error "自动版本规则未通过（冲突 / 查询失败）—— 发布中止。禁盲涨号：人工核对两侧 commit 后再决策"
        exit 1
    fi
    TARGET_VERSION=$(sed -n 's/^AUTO_VERSION: .* target=\([0-9.]*\) action=.*$/\1/p' <<<"$AV_OUTPUT" | head -1)
    AV_ACTION=$(sed -n 's/^AUTO_VERSION: .* action=\([a-z]*\) .*$/\1/p' <<<"$AV_OUTPUT" | head -1)
    if [[ "$AV_ACTION" == "skip" ]]; then
        print_warn "目标 tag v$TARGET_VERSION 已存在远端且 SHA=本地 HEAD —— 该 commit 已发布过，跳过本次发布（幂等重跑）"
        exit 0
    fi
    if [[ "$AV_ACTION" != "release" || -z "$TARGET_VERSION" ]]; then
        print_error "auto-version 输出无法解析（action=$AV_ACTION target=$TARGET_VERSION）"
        exit 1
    fi
fi
export ARTIFACT_TARGET_VERSION="$TARGET_VERSION"   # L1 v2 的 since 门用（随 1.1.49 起 hv-control-daemon 必含）

if [[ -n "$CONFIG_VERSION" && "$CONFIG_VERSION" != "$TARGET_VERSION" ]]; then
    print_warn "release-config.txt 的 VERSION=$CONFIG_VERSION 与自动计算值不一致 —— 手工版本号已废弃，以自动计算 v$TARGET_VERSION 为准"
fi

echo ""
echo -e "  ${WHITE}目标版本: v$TARGET_VERSION（自动计算，最新正式 tag +0.0.1）${NC}"
echo -e "  ${GRAY}更新说明: $RELEASE_MESSAGE${NC}"
echo ""

# ============================================
# 步骤 1: 检查当前版本号一致性
# ============================================
print_step "1/9" "检查当前项目版本号一致性..."

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
print_step "2/9" "对比目标版本与当前版本..."

echo -e "  ${GRAY}当前版本: v$CURRENT_VERSION${NC}"
echo -e "  ${GRAY}目标版本: v$TARGET_VERSION${NC}"

# ── 就地编辑：GNU sed 与 BSD(macOS) sed 的 -i 语义不同 ────────────────────
# GNU:  sed -i  "<脚本>" <文件>
# BSD:  sed -i '' "<脚本>" <文件>      ← -i **必须**带备份后缀参数
#
# 在 BSD 上照 GNU 写法调用，"<脚本>" 会被当成备份后缀，**文件路径反被当成脚本执行**，
# 于是报出形如 `sed: 1: "/path/to/file": invalid command code M` 的错 ——
# 错误信息里出现的是路径，很容易被误诊成「路径没加引号 / 路径含空格」，
# 其实路径一直是带引号的，与空格无关。本仓 v1.1.23 就曾这样误诊并靠手工预设版本号绕过。
sed_inplace() {
    if sed --version >/dev/null 2>&1; then
        sed -i "$@"        # GNU
    else
        sed -i '' "$@"     # BSD / macOS
    fi
}

VERSION_UPDATED=false

if [[ "$CURRENT_VERSION" == "$TARGET_VERSION" ]]; then
    print_ok "版本号已是目标版本，无需更新"
else
    print_warn "版本号需要更新: v$CURRENT_VERSION → v$TARGET_VERSION"
    
    # 更新版本号
    echo ""
    echo -e "  ${CYAN}正在更新版本号...${NC}"
    
    # 更新 package.json
    sed_inplace "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$TARGET_VERSION\"/" "$PROJECT_ROOT/package.json"
    
    # 更新 tauri.conf.json
    sed_inplace "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$TARGET_VERSION\"/" "$PROJECT_ROOT/src-tauri/tauri.conf.json"
    
    # 更新 Cargo.toml
    sed_inplace "/^\[package\]/,/^\[/ s/version = \"$CURRENT_VERSION\"/version = \"$TARGET_VERSION\"/" "$PROJECT_ROOT/src-tauri/Cargo.toml"
    
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
print_step "3/9" "从 HuanvaeGuard 源码构建各平台 VPN 二进制并替换..."

if $DRY_RUN; then
    print_warn "RELEASE_DRY_RUN=1 —— 干跑跳过二进制构建（真实发布必跑本步；发货件一致性由 L1 v2 哈希核对覆盖）"
else
BUILD_HG_EXIT=0
if [[ "${HG_BINARIES_SKIP_REGISTERED:-0}" == "1" ]]; then
    # 登记式跳过（沿 v1.1.40-v1.1.45 连续六版发布登记惯例）：本宿主为 Linux，
    # build-hg-binaries.sh 的 macOS 腿（arm64-apple-darwin）无法在本机交叉构建。
    # 跳过时调用方必须另行验证并登记：发货件与上一版 resources 落点逐字节一致。
    print_warn "HG_BINARIES_SKIP_REGISTERED=1 —— 按登记惯例跳过 VPN 二进制构建（本宿主不可跑）"
    print_warn "发布方必须验证 git diff <上一版tag>..HEAD -- src-tauri/resources/ 为空并在发布说明登记"
else
    "$PROJECT_ROOT/scripts/build-hg-binaries.sh" || BUILD_HG_EXIT=$?
fi

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
fi   # $DRY_RUN else 分支结束

# ============================================
# 步骤 4: 运行完整测试
# ============================================
print_step "4/9" "运行完整代码质量测试 (L0 代码门禁)..."
echo ""
echo -e "${YELLOW}  测试标准: 前后端 0 errors, 0 warnings${NC}"
echo -e "${GRAY}  (忽略: Vite动态导入提示、已标记的await-in-loop、console调试日志)${NC}"
echo ""

TEST_ARGS=("$@")
if $DRY_RUN; then
    print_warn "RELEASE_DRY_RUN=1 —— 干跑用降档组合（--skip-rust --skip-e2e --skip-vpn + ALLOW_SKIP 同批登记）只验链路接线，【不构成发布凭据】；真实发布不得带这些降档，也不得设 ALLOW_SKIP"
    TEST_ARGS+=(--skip-rust --skip-e2e --skip-vpn)
    ALLOW_SKIP_DRY="e2e,cargo-check,clippy-desktop,clippy-android,cargo-test,vpn-connectivity"
    export ALLOW_SKIP="${ALLOW_SKIP:-$ALLOW_SKIP_DRY}"
fi

TEST_EXIT=0
"$SCRIPT_DIR/test-all.sh" "${TEST_ARGS[@]}" || TEST_EXIT=$?

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
# 步骤 5: L2 平台安装冒烟 + L3 全功能实测矩阵（发布前置链）
# ============================================
# L2：把包**真的装到真机**（Windows/macOS/Linux/Android 四腿；环境经 L2_*_HOST 注入，
#     仓内不落盘）。产物目录经 RELEASE_L2_ARTIFACT_DIR 注入（CI 出包后取渠道包或本地产物）。
#     某腿环境不可达 = BLOCKED：不算失败也不算通过，必须 RELEASE_ACK_L2_BLOCKED="win,linux"
#     显式确认（决策入发布记录）才能继续——不许静默跳过。
# L3：十项必测功能矩阵，缺证即红（scripts/linux/l3-full-matrix.sh，无 ALLOW_SKIP）；
#     状态文件落在发布留档目录，随发布记录归档。
print_step "5/9" "L2 平台安装冒烟 + L3 全功能实测矩阵 (发布前置链)..."

L2_RC=0
L2_ARGS=(--out "$RELEASE_LOG_DIR/l2-evidence")
[[ -n "${RELEASE_L2_ARTIFACT_DIR:-}" ]] && L2_ARGS+=(--artifact-dir "$RELEASE_L2_ARTIFACT_DIR")
[[ -n "${RELEASE_ACK_L2_BLOCKED:-}" ]] && L2_ARGS+=(--ack-blocked "$RELEASE_ACK_L2_BLOCKED")
if $DRY_RUN && [[ -z "${RELEASE_L2_ARTIFACT_DIR:-}" ]]; then
    print_warn "干跑且未注入 RELEASE_L2_ARTIFACT_DIR —— L2 无产物可装，各腿按 BLOCKED 登记（真实发布必须配产物目录或显式 ack）"
fi
"$SCRIPT_DIR/l2-install-smoke.sh" "${L2_ARGS[@]}" || L2_RC=$?
if [[ $L2_RC -eq 1 ]]; then
    print_error "L2 安装冒烟有腿 FAIL —— 发布中止（装不上的包不能发；干跑同样中止，不降档记账）"
    exit 1
elif [[ $L2_RC -ne 0 ]]; then
    print_error "L2 安装冒烟存在未确认的 BLOCKED —— 发布中止。确认某腿本次确实不可跑则（决策入发布记录）："
    echo -e "${YELLOW}    RELEASE_ACK_L2_BLOCKED=win ./scripts/linux/release.sh${NC}"
    exit 1
fi

L3_RC=0
"$SCRIPT_DIR/l3-full-matrix.sh" --state "$RELEASE_LOG_DIR/l3-state.json" --check || L3_RC=$?
if [[ $L3_RC -ne 0 ]]; then
    print_error "L3 实测矩阵有缺证项 —— 发布中止。逐项实测后登记："
    echo -e "${YELLOW}    scripts/linux/l3-full-matrix.sh --state $RELEASE_LOG_DIR/l3-state.json --record <id> <证据路径>${NC}"
    echo -e "${YELLOW}    scripts/linux/l3-full-matrix.sh --state $RELEASE_LOG_DIR/l3-state.json --register <id> \"<物理不可执行的真实原因>\"${NC}"
    exit 1
fi
print_ok "L2 安装冒烟 + L3 实测矩阵通过（留档 $RELEASE_LOG_DIR）"

# ============================================
# 步骤 6: 同步依赖
# ============================================
print_step "6/9" "同步 pnpm-lock.yaml..."

if $DRY_RUN; then
    print_warn "干跑跳过依赖同步（真实发布必跑）"
elif pnpm install --frozen-lockfile >/dev/null 2>&1; then
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
# 步骤 7: Git 提交和标签
# ============================================
print_step "7/9" "Git 提交和创建标签..."

COMMIT_MSG="v$TARGET_VERSION: $RELEASE_MESSAGE"

if $DRY_RUN; then
    print_warn "RELEASE_DRY_RUN=1 —— 干跑不提交不打标。计划动作："
    echo -e "  ${GRAY}git add（白名单：src tests scripts e2e src-tauri/binaries src-tauri/tauri.e2e.conf.json）${NC}"
    echo -e "  ${GRAY}git commit -m \"$COMMIT_MSG\"${NC}"
    echo -e "  ${GRAY}git tag v$TARGET_VERSION <HEAD> + assert_tag_points_at_head${NC}"
else
    # 检查是否有变更需要提交
    if git diff --quiet && git diff --staged --quiet; then
        print_warn "没有检测到文件变更"
        print_warn "标签 v$TARGET_VERSION 将重新指向当前 HEAD"
    else
        # 有变更，进行提交
        # 🔴 最小安全修正（2026-09-15，v1.1.46 发布）：原 git add -A 会把工作树里的
        # 他块工作面杂散文件（.claude/*、*.png 截图、log、probe-ws/、dist-e2e/、
        # tessdata/、test-artifacts*/ 等）一并卷入发布 commit。改为白名单式添加：
        # 仅源码（src）、测试（tests）、脚本（scripts）与 src-tauri 指定子路径。
        git add -u -- src tests scripts e2e src-tauri/tests
        git add -- src tests e2e
        git add -- src-tauri/binaries src-tauri/tauri.e2e.conf.json
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
fi

# ============================================
# 步骤 8: 自动推送到 GitHub
# ============================================
print_step "8/9" "推送到 GitHub..."

if $DRY_RUN; then
    print_warn "RELEASE_DRY_RUN=1 —— 干跑不推送。计划动作：git push origin main && git push origin v$TARGET_VERSION"
else
    echo ""
    echo -e "  ${WHITE}推送分支: main${NC}"
    echo -e "  ${WHITE}推送标签: v$TARGET_VERSION${NC}"
    echo ""

    git push origin main
    git push origin "v$TARGET_VERSION" --force
fi

if $DRY_RUN; then
    print_warn "(干跑) 未推送——上一行的推送动作仅为计划展示"
else
    print_ok "推送完成"
fi

# ============================================
# 步骤 9: L4 渠道下载验证（发布后链）
# ============================================
# tag 推上去后 CI 出包挂 Release 需要一段时间；RELEASE_L4_WAIT=分钟数时本步等待并
# 真跑对账（默认打印交接命令，由发布方在 CI 完成后执行）。干跑时对最近已发布版本
# 演示对账链路（明确标注非本版）。
print_step "9/9" "L4 渠道下载验证 (发布后链)..."

if $DRY_RUN; then
    print_warn "干跑演示：对最近已发布版本跑 L4 对账链路（非本版，仅验管线接通）"
    LATEST_TAG=$(printf '%s' "${AV_OUTPUT:-}" | sed -n 's/^AUTO_VERSION: latest=\(v[0-9.]*\) .*/\1/p' | head -1)
    if [[ -z "$LATEST_TAG" ]]; then
        print_error "干跑 L4 演示无法确定最近已发布版（auto-version 输出解析落空）——停住，不猜 tag"
        exit 1
    fi
    print_ok "演示对账目标（远端最新正式版，非本版）: $LATEST_TAG"
    "$SCRIPT_DIR/l4-channel-verify.sh" "$LATEST_TAG" --dir "$RELEASE_LOG_DIR/l4-demo" || print_warn "干跑 L4 演示未过（留档 $RELEASE_LOG_DIR/l4-demo）—— 演示目标是已发布旧版，其渠道真缺口不阻塞干跑；但真实发布时本步对本版 FAIL 即发布失败"
elif [[ -n "${RELEASE_L4_WAIT:-}" ]]; then
    "$SCRIPT_DIR/l4-channel-verify.sh" "v$TARGET_VERSION" --dir "$RELEASE_LOG_DIR/l4-$TARGET_VERSION" --wait-minutes "$RELEASE_L4_WAIT" \
        || { print_error "L4 渠道对账未过 —— 渠道与清单不一致，发布判 FAIL（详见上方差异）"; exit 1; }
else
    echo -e "  ${CYAN}CI 出包需要一段时间；完成后必须真跑（发布记录以此为准）：${NC}"
    echo -e "  ${YELLOW}    scripts/linux/l4-channel-verify.sh v$TARGET_VERSION --dir $RELEASE_LOG_DIR/l4-$TARGET_VERSION${NC}"
    echo -e "  ${GRAY}  或在本步内等待：RELEASE_L4_WAIT=40 ./scripts/linux/release.sh（重跑至本步时 tag 已存在会走 skip 路径，可直接手工跑 L4）${NC}"
fi

# ============================================
# 发布完成
# ============================================
print_header "发布完成! v$TARGET_VERSION"

if $DRY_RUN; then
    echo -e "  ${YELLOW}RELEASE_DRY_RUN=1 —— 干跑结束：未写版本号、未 commit、未 push。逐层接线已验，真实发布请去掉 RELEASE_DRY_RUN 全量跑。${NC}"
else
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
    echo -e "  ${CYAN}发布后必跑（L4 渠道对账）:${NC}"
    echo "    scripts/linux/l4-channel-verify.sh v$TARGET_VERSION --dir $RELEASE_LOG_DIR/l4-$TARGET_VERSION"
fi
