#!/bin/bash
#
# Huanvae Chat App —— HuanvaeGuard 守护进程二进制构建 / 替换脚本 (macOS 宿主)
#
# ## 为什么有这个脚本
# App 发货两个 VPN 守护进程二进制，长期是「手工放进去、来源不明、无人验证」的死文件，
# 已连续造成两起生产故障（发货件落后于当前契约 / 签名形态不被 launchd 接受）。
# 本脚本把它们改成「每次发布前从 HuanvaeGuard 源码仓构建 → 校验 → 替换」的可复现产物。
#
# ## 产物落点（相对项目根）
#   macOS   : src-tauri/resources/HuanvaeGuard-macos/hg-macos          (crate hg-macos)
#   Windows : src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe    (crate hg-windows，产物名 hg-windows.exe，落点改名)
#   manifest: src-tauri/resources/hg-build-manifest.json
#
# ## 环境变量
#   HG_REPO             HuanvaeGuard 源码仓路径        默认 <项目根>/../HuanvaeGuard
#   HG_WIN_BUILD_HOST   构建 Windows 产物的 ssh 目标（形如 user@host）。**无默认值**
#                       —— 本仓是 PUBLIC 公开仓，不写任何内网地址 / 主机名 / 账号
#   HG_WIN_BUILD_DIR    该宿主上的构建树路径            默认 /var/lib/build/HuanvaeGuard
#   HG_SKIP_WINDOWS     置 1 时只构建 macOS 侧（临时排障用，默认不跳）
#   HG_ANDROID_BUILD_HOST 构建 Android 产物的 ssh 目标（形如 user@host）。**无默认值**
#                       —— 同 HG_WIN_BUILD_HOST：PUBLIC 仓不写任何内网地址 / 主机名 / 账号。
#                          未设时本次发布不含安卓产物、流程照常继续（骨架期软门，见 3b 段注释）
#   HG_ANDROID_BUILD_DIR 该宿主上的构建树路径        默认 /var/lib/build/HuanvaeGuard-android
#                        （与 win 腿构建树分目录，避免两腿互踩）
#   HG_SKIP_ANDROID      置 1 时跳过安卓产物构建（临时排障用，默认不跳）
#
# ## 用法
#   ./scripts/build-hg-binaries.sh
#   HG_WIN_BUILD_HOST=user@host ./scripts/build-hg-binaries.sh
#   HG_SKIP_WINDOWS=1 ./scripts/build-hg-binaries.sh      # 仅排障，发布前不许这么跑
#
# ## 硬性约束
#   - 任一步失败立刻 exit 1：绝不回落仓里的旧文件、绝不静默降级。
#   - 不在这里设 RUSTFLAGS：HuanvaeGuard 仓的 .cargo/config.toml 已用 --remap-path-prefix
#     抹掉构建机路径，环境变量 RUSTFLAGS 会整体覆盖它、把构建机绝对路径重新烘进产物。
#   - macOS 产物构建后必须 codesign -f -s - 显式重签：linker-signed 形态 launchd 可能拒绝加载。
#   - 替换进落点之前必须过"产物形态断言"：macOS 架构恰好等于 EXPECTED_MAC_ARCH、
#     Windows 是 PE32+ x86-64。构建成功 ≠ 产物能在目标机器上跑，这两条是唯一的机器复查。
#
# ## 退出码
#   0 = 全部产物构建 / 校验 / 替换成功
#   1 = 任一环节失败（含泄露扫命中）
#
# @date 2026-08-06

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
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

HG_REPO="${HG_REPO:-$PROJECT_ROOT/../HuanvaeGuard}"
HG_WIN_BUILD_DIR="${HG_WIN_BUILD_DIR:-/var/lib/build/HuanvaeGuard}"
# HG_ANDROID_BUILD_HOST 故意无默认值（同 HG_WIN_BUILD_HOST，PUBLIC 仓纪律）；
# 只给目录默认值，且与 win 腿目录分离。
HG_ANDROID_BUILD_DIR="${HG_ANDROID_BUILD_DIR:-/var/lib/build/HuanvaeGuard-android}"

MAC_DEST_REL="src-tauri/resources/HuanvaeGuard-macos/hg-macos"
WIN_DEST_REL="src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe"
MANIFEST_REL="src-tauri/resources/hg-build-manifest.json"

# App 的 macOS 产物目标架构。对齐 .github/workflows/release.yml 的 build matrix：
# macOS 只有一条 `platform: macos-14 / target: aarch64-apple-darwin / name: darwin-aarch64`
# （注释里写明 macos-13 (Intel) 已被 GitHub 废弃），产物是 ..._aarch64.dmg，updater manifest
# 也只有 darwin-aarch64 一个 key —— 即本产品线仅支持 Apple Silicon，守护进程单 arm64 是正确的。
# 这个常量存在的意义是"防漂移"：哪天 DMG 改成 universal 或加回 Intel target，而守护进程还是
# 单 arm64，就会复发「装上去 daemon 起不来」。改产品线时必须连这里一起改。
EXPECTED_MAC_ARCH="arm64"

# Windows 守护进程的目标三元组。**故意是 gnu (mingw)，不要改成 msvc**：
# mingw 这一份正是在真 Windows 机上验证过「能被 SCM 拉起 + 能建隧道」的那份。换 msvc 等于
# 重新发一份没人验过的二进制 —— 而"发货二进制无人验证"正是本脚本要根治的病本身。
EXPECTED_WIN_TRIPLE="x86_64-pc-windows-gnu"

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

print_info() {
    echo -e "  ${GRAY}$1${NC}"
}

# 临时目录：远程产物落地用，退出时清掉
TMP_DIR="$(mktemp -d)"
cleanup_tmp() { rm -rf "$TMP_DIR"; }
trap cleanup_tmp EXIT

sha256_of() {
    shasum -a 256 "$1" | awk '{print $1}'
}

size_of() {
    wc -c < "$1" | tr -d ' '
}

# JSON 字符串转义（只需处理反斜杠与双引号；本脚本写入的值不含控制字符）
json_escape() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# 远程命令片段里嵌路径：只放行严格字符集，杜绝引号 / 展开 / 命令分隔符注入。
# 与 build-hg-binaries.ps1 的同名校验保持一致口径，避免"sh 能跑、ps1 报错"。
path_is_shell_safe() {
    printf '%s' "$1" | grep -qE '^[A-Za-z0-9_./-]+$'
}

# ---- 产物形态断言：产物必须真能在目标平台上跑 ----------------------------------
#
# 这两条断言存在的理由，就是本脚本要根治的那类故障：构建"成功"了、替换"成功"了、
# sha 也对得上，但产物在目标机器上根本起不来（架构不符 / 平台不符），而链路上没有
# 任何一步会报错。所以在替换进落点之前，必须直接对二进制本体验一次形态。

# 断言 macOS 产物架构与 App 的 macOS 发布目标一致
assert_mac_arch() {
    local f="$1"
    local archs file_out

    # lipo -archs 对 thin 二进制输出 "arm64"，对 universal 输出 "arm64 x86_64"。
    # 这里做**恰好相等**判定而不是"包含"：universal 也要中止 —— 那说明发布目标变了，
    # 需要人来重新决策（守护进程该不该也跟着变 universal），不能由脚本默默放行。
    archs="$(lipo -archs "$f" 2>/dev/null | tr -s '[:space:]' ' ' | sed -e 's/^ *//' -e 's/ *$//')"
    if [[ -z "$archs" ]]; then
        print_error "lipo -archs 读不出架构，产物可能不是 Mach-O: $f"
        return 1
    fi
    if [[ "$archs" != "$EXPECTED_MAC_ARCH" ]]; then
        print_error "守护进程架构 $archs 与 App macOS 产物目标架构 $EXPECTED_MAC_ARCH 不一致 —— 装到该架构的 Mac 上守护进程起不来，发布中止。"
        print_error "若产品线要覆盖 Intel Mac，需改为 universal2（lipo -create 合 arm64 + x86_64）并同步改本断言。"
        return 1
    fi

    file_out="$(file -b "$f")"
    if [[ "$file_out" != *"Mach-O"* || "$file_out" != *"$EXPECTED_MAC_ARCH"* ]]; then
        print_error "file 判定与预期不符（应含 Mach-O 与 ${EXPECTED_MAC_ARCH}）: $file_out"
        return 1
    fi

    # 注意 ${...} 大括号不是多余的：变量名后紧跟中文全角字符时，某些 locale 下 bash 会把
    # 该字符的首字节（0xEF）当作合法变量名字符吞进去，变量静默展开成空。实测：
    #   echo "$archs（x）"   -> "\xbc\x88x）"（arm64 丢失）
    #   echo "${archs}（x）" -> "arm64（x）"
    print_ok "架构断言通过: ${archs}（${file_out}）"
    return 0
}

# 读 PE 文件某偏移的单字节（十进制）
pe_byte_at() {
    od -An -tu1 -j "$2" -N 1 "$1" | tr -d '[:space:]'
}

# 断言 Windows 产物是 PE32+ x86-64
assert_win_pe() {
    local f="$1"
    local file_out lfanew sig machine magic

    if command -v file >/dev/null 2>&1; then
        file_out="$(file -b "$f")"
        if [[ "$file_out" =~ PE32\+ ]] && [[ "$file_out" == *"x86-64"* ]]; then
            print_ok "PE 断言通过: $file_out"
            return 0
        fi
        print_error "Windows 产物不是 PE32+ x86-64 —— 装到目标机上服务起不来，发布中止。"
        print_error "file 判定: $file_out"
        return 1
    fi

    # file 不可用时回落读 PE 头（显式小端拼字节，不依赖宿主字节序）
    lfanew=$(( $(pe_byte_at "$f" 60) | $(pe_byte_at "$f" 61) << 8 | $(pe_byte_at "$f" 62) << 16 | $(pe_byte_at "$f" 63) << 24 ))
    sig="$(od -An -c -j "$lfanew" -N 4 "$f" | tr -d '[:space:]')"
    if [[ "$sig" != "PE\0\0" ]]; then
        print_error "PE 签名校验失败（偏移 $lfanew 处不是 PE\\0\\0）: $f"
        return 1
    fi

    # COFF header: machine 在 PE 签名后 +0；可选头 magic 在 +20（PE32+ = 0x20b）
    machine=$(( $(pe_byte_at "$f" $((lfanew + 4))) | $(pe_byte_at "$f" $((lfanew + 5))) << 8 ))
    magic=$(( $(pe_byte_at "$f" $((lfanew + 24))) | $(pe_byte_at "$f" $((lfanew + 25))) << 8 ))

    if [[ $machine -ne $((0x8664)) ]]; then
        print_error "Windows 产物 PE machine 不是 x86-64 —— 装到目标机上服务起不来，发布中止。"
        print_error "$(printf 'machine=0x%04x（期望 0x8664）' "$machine")"
        return 1
    fi
    if [[ $magic -ne $((0x20b)) ]]; then
        print_error "Windows 产物不是 PE32+（64 位可选头）—— 发布中止。"
        print_error "$(printf 'optional header magic=0x%03x（期望 0x20b）' "$magic")"
        return 1
    fi

    print_ok "$(printf 'PE 断言通过: PE32+ x86-64 (machine=0x%04x, magic=0x%03x)' "$machine" "$magic")"
    return 0
}

# 断言 Android 产物是 aarch64 ELF。
# e_machine 在 ELF 头偏移 18，双字节小端（EM_AARCH64 = 0xB7 = 183）。
# 读法复用 pe_byte_at（od 读单字节，本函数只关心字节不关心 PE 语义），
# 显式按小端拼字节，不依赖宿主字节序。
assert_android_elf() {
    local f="$1" magic mach

    magic="$(od -An -c -j 0 -N 4 "$f" | tr -d '[:space:]')"
    if [[ "$magic" != "177ELF" ]]; then
        print_error "Android 产物不是 ELF 文件（魔数 \\177ELF 不符）: $f"
        return 1
    fi

    mach=$(( $(pe_byte_at "$f" 18) | $(pe_byte_at "$f" 19) << 8 ))
    if [[ $mach -ne $((0xB7)) ]]; then
        print_error "Android 产物不是 aarch64（EM_AARCH64）—— 装到目标机上起不来，发布中止。"
        print_error "$(printf 'e_machine=0x%04x（期望 0xB7）' "$mach")"
        return 1
    fi

    print_ok "$(printf 'ELF 断言通过: aarch64 (e_machine=0x%04x)' "$mach")"
    return 0
}

# 取二进制里的可打印字符串。strings 缺席时退回 tr 切分
extract_strings() {
    if command -v strings >/dev/null 2>&1; then
        strings -a "$1"
    else
        LC_ALL=C tr -c '[:print:]\n' '\n' < "$1"
    fi
}

# 泄露扫描模式：构建机路径 + RFC1918 私网地址
# 注意：这里的点号都是转义写法（\.），本文件本身不含任何字面私网地址
LEAK_PATH_RE='(/Users/|/home/[a-z]|C:\\Users)'
LEAK_PRIVATE_NET_RE='(^|[^0-9.])(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]{1,3}\.[0-9]{1,3}'

# 对单个文件跑泄露扫；命中返回 1 并打印命中行
scan_leaks() {
    local file="$1"
    local hit=0
    local dump path_hits net_hits

    dump="$TMP_DIR/leakscan.txt"
    extract_strings "$file" > "$dump"

    path_hits="$(grep -nE "$LEAK_PATH_RE" "$dump" | head -20 || true)"
    if [[ -n "$path_hits" ]]; then
        print_error "命中构建机路径泄露: $file"
        echo "$path_hits" | while IFS= read -r line; do
            echo -e "    ${RED}$line${NC}"
        done
        hit=1
    fi

    net_hits="$(grep -nE "$LEAK_PRIVATE_NET_RE" "$dump" | head -20 || true)"
    if [[ -n "$net_hits" ]]; then
        print_error "命中私网地址泄露: $file"
        echo "$net_hits" | while IFS= read -r line; do
            echo -e "    ${RED}$line${NC}"
        done
        hit=1
    fi

    rm -f "$dump"
    return $hit
}

# ============================================
# 产物登记表（并行数组，bash 3.2 兼容）
# ============================================
ART_SRC=()          # 构建产出的源文件绝对路径
ART_DEST_REL=()     # 落点（相对项目根）
ART_CRATE=()
ART_TARGET=()
ART_SHA=()
ART_CSFLAGS=()      # 仅 macOS 有值，其余为空串
ART_ARCH=()         # 仅 macOS 有值（lipo -archs 实测结果），其余为空串
ART_PE=()           # 仅 Windows 有值（PE machine 类型），其余为空串

print_header "HuanvaeGuard 守护进程二进制构建"

# ============================================
# 步骤 1: 校验 HuanvaeGuard 源码仓
# ============================================
print_step "1/7" "校验 HuanvaeGuard 源码仓..."

if [[ ! -d "$HG_REPO" ]]; then
    print_error "HG_REPO 不存在: $HG_REPO"
    echo ""
    echo -e "${YELLOW}  设置源码仓路径后重跑：HG_REPO=/path/to/HuanvaeGuard $0${NC}"
    exit 1
fi

HG_REPO="$(cd "$HG_REPO" && pwd)"

if ! git -C "$HG_REPO" rev-parse --git-dir >/dev/null 2>&1; then
    print_error "HG_REPO 不是 git 仓库: $HG_REPO"
    exit 1
fi

SRC_COMMIT="$(git -C "$HG_REPO" rev-parse HEAD)"
print_ok "源码仓: $HG_REPO"
print_info "HEAD commit: $SRC_COMMIT"

DIRTY_RAW="$(git -C "$HG_REPO" diff --name-only HEAD || true)"
SRC_DIRTY=false
DIRTY_FILES=()
if [[ -n "$DIRTY_RAW" ]]; then
    SRC_DIRTY=true
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        DIRTY_FILES+=("$line")
    done <<< "$(printf '%s\n' "$DIRTY_RAW" | head -10)"

    print_warn "源码仓有未提交改动（dirty）—— 构建产物无法由 commit 复现"
    for f in "${DIRTY_FILES[@]}"; do
        echo -e "    ${YELLOW}$f${NC}"
    done
    print_info "（以上为前 10 行；完整清单见 git -C \"\$HG_REPO\" diff --name-only HEAD）"
else
    print_ok "源码仓干净（产物可由 commit 复现）"
fi

# ============================================
# 步骤 2: 构建 macOS 守护进程
# ============================================
print_step "2/7" "构建 macOS 守护进程 (hg-macos)..."

HOST_OS="$(uname -s)"
if [[ "$HOST_OS" != "Darwin" ]]; then
    print_error "macOS 产物必须在 macOS 上构建，当前宿主: $HOST_OS"
    echo ""
    echo -e "${YELLOW}  Windows 宿主请改用 scripts/build-hg-binaries.ps1（它会 ssh 到 macOS 构建机产出 hg-macos）${NC}"
    exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
    print_error "找不到 cargo，无法构建 macOS 产物"
    exit 1
fi

MAC_HOST_TRIPLE="$(rustc -vV | awk '/^host: /{print $2}')"
if [[ -z "$MAC_HOST_TRIPLE" ]]; then
    print_error "读不到 rustc host triple（rustc -vV 无 host 行）"
    exit 1
fi
print_info "rustc host triple: $MAC_HOST_TRIPLE"

( cd "$HG_REPO" && cargo build --release -p hg-macos )

MAC_ART="$HG_REPO/target/release/hg-macos"
if [[ ! -f "$MAC_ART" ]]; then
    print_error "构建声称成功但产物不存在: $MAC_ART"
    exit 1
fi
print_ok "构建完成: $MAC_ART"

# --- 显式重签（已定位的故障根因之一：linker-signed 产物 launchd 可能拒绝加载）---
CS_FLAGS_BEFORE="$(codesign -dv --verbose=4 "$MAC_ART" 2>&1 | grep -E 'flags=' | head -1 || true)"
print_info "重签前 codesign: ${CS_FLAGS_BEFORE:-<无签名信息>}"

codesign -f -s - "$MAC_ART"

CS_FLAGS_AFTER="$(codesign -dv --verbose=4 "$MAC_ART" 2>&1 | grep -E 'flags=' | head -1 || true)"
print_info "重签后 codesign: ${CS_FLAGS_AFTER:-<无签名信息>}"

if [[ -z "$CS_FLAGS_AFTER" ]]; then
    print_error "重签后读不到 codesign flags 行，无法确认签名形态"
    exit 1
fi
if [[ "$CS_FLAGS_AFTER" != *"adhoc"* ]]; then
    print_error "重签后 flags 不含 adhoc —— 签名形态不符合预期"
    echo -e "    ${RED}$CS_FLAGS_AFTER${NC}"
    exit 1
fi
if [[ "$CS_FLAGS_AFTER" == *"linker-signed"* ]]; then
    print_error "重签后 flags 仍含 linker-signed —— launchd 可能拒绝加载该产物"
    echo -e "    ${RED}$CS_FLAGS_AFTER${NC}"
    exit 1
fi
print_ok "签名校验通过: adhoc 且非 linker-signed"

# --- 架构断言（替换进落点之前）---
if ! assert_mac_arch "$MAC_ART"; then
    exit 1
fi

ART_SRC+=("$MAC_ART")
ART_DEST_REL+=("$MAC_DEST_REL")
ART_CRATE+=("hg-macos")
ART_TARGET+=("$MAC_HOST_TRIPLE")
ART_CSFLAGS+=("$CS_FLAGS_AFTER")
ART_ARCH+=("$EXPECTED_MAC_ARCH")
ART_PE+=("")

# ============================================
# 步骤 3: 构建 Windows 守护进程
# ============================================
print_step "3/7" "构建 Windows 守护进程 (hg-windows)..."

WIN_BUILT=false

if [[ "$HG_SKIP_WINDOWS" == "1" ]]; then
    print_warn "HG_SKIP_WINDOWS=1：跳过 Windows 产物构建"
    print_warn "跳过 ≠ 通过：本次不产出 huanvaeguard-svc.exe，manifest 也不含它，禁止据此发布"
else
    if [[ -z "$HG_WIN_BUILD_HOST" ]]; then
        print_error "未设置 HG_WIN_BUILD_HOST：本机无法构建 Windows 产物，发布中止"
        echo ""
        echo -e "${YELLOW}  Windows 产物必须在 Windows 构建宿主上产出。设置 ssh 目标后重跑：${NC}"
        echo -e "${YELLOW}    HG_WIN_BUILD_HOST=user@host ./scripts/build-hg-binaries.sh${NC}"
        echo ""
        echo -e "${GRAY}  （仅排障可用 HG_SKIP_WINDOWS=1 跳过，但这样产出的结果不许发布）${NC}"
        exit 1
    fi

    if ! path_is_shell_safe "$HG_WIN_BUILD_DIR"; then
        print_error "HG_WIN_BUILD_DIR 含会破坏远程命令引号的字符，拒绝执行: $HG_WIN_BUILD_DIR"
        exit 1
    fi

    print_info "构建宿主: <HG_WIN_BUILD_HOST>（不落盘、不入日志）"
    print_info "构建树:   $HG_WIN_BUILD_DIR"

    # 3.1 同步源码：确保远程构建源就是本仓当前代码（含未提交改动）
    print_info "同步源码到构建宿主..."
    rsync -az --delete --exclude 'target/' --exclude '.git/' \
        -e "ssh -o BatchMode=yes" \
        "$HG_REPO/" "$HG_WIN_BUILD_HOST:$HG_WIN_BUILD_DIR/"
    print_ok "源码同步完成"

    # 3.2 远程构建
    print_info "远程 cargo build --release -p hg-windows --target $EXPECTED_WIN_TRIPLE ..."
    REMOTE_BUILD_CMD="cd '$HG_WIN_BUILD_DIR' && cargo build --release -p hg-windows --target $EXPECTED_WIN_TRIPLE"
    ssh -o BatchMode=yes "$HG_WIN_BUILD_HOST" "bash -lc \"$REMOTE_BUILD_CMD\""
    print_ok "远程构建完成"

    # 3.3 取回产物
    WIN_ART="$TMP_DIR/hg-windows.exe"
    scp -o BatchMode=yes \
        "$HG_WIN_BUILD_HOST:$HG_WIN_BUILD_DIR/target/$EXPECTED_WIN_TRIPLE/release/hg-windows.exe" \
        "$WIN_ART"

    if [[ ! -f "$WIN_ART" ]]; then
        print_error "scp 声称成功但本地产物不存在: $WIN_ART"
        exit 1
    fi
    print_ok "产物已取回: $(size_of "$WIN_ART") bytes"

    # --- PE 断言（替换进落点之前）---
    if ! assert_win_pe "$WIN_ART"; then
        exit 1
    fi

    ART_SRC+=("$WIN_ART")
    ART_DEST_REL+=("$WIN_DEST_REL")
    ART_CRATE+=("hg-windows")
    ART_TARGET+=("$EXPECTED_WIN_TRIPLE")
    ART_CSFLAGS+=("")
    ART_ARCH+=("")
    ART_PE+=("x86-64")
    WIN_BUILT=true
fi

# ============================================
# 步骤 3b: 构建 Android 产物（hg-android，fwrun-007 B3 骨架腿）
# ============================================
# 行为不变门（骨架期硬约束）：
#   - 未设 HG_ANDROID_BUILD_HOST ⇒ 只打一行提示后继续，不产生任何产物，
#     存量 mac/win 发布流程用法完全不变（这是与 win 腿「未设即中止」的**有意**
#     差异：存量流程不得因新增第三腿被迫改用法；是否升级为硬门由总管裁定）。
#   - 设了 HOST 却连不上 / 同步失败 / 构建失败 ⇒ 一律 FAIL，绝不静默跳过。
#   - 产物落点与 ELF 断言按 crate-type 裁决定稿（fwrun-008 总管卡）：cdylib + rlib，
#     取回/落点为 libhg_android.so（Kotlin 桥 System.loadLibrary 装载），rlib 不取回。

print_step "3b/7" "构建 Android 产物 (hg-android, 骨架腿)..."

if [[ "$HG_SKIP_ANDROID" == "1" ]]; then
    print_warn "HG_SKIP_ANDROID=1：跳过 Android 产物构建"
    print_warn "跳过 ≠ 通过：本次不产出安卓产物，manifest 也不含它，禁止据此发布"
elif [[ -z "$HG_ANDROID_BUILD_HOST" ]]; then
    print_info "未设 HG_ANDROID_BUILD_HOST：本次发布不含安卓产物（继续 mac/win 流程）"
else
    if ! path_is_shell_safe "$HG_ANDROID_BUILD_DIR"; then
        print_error "HG_ANDROID_BUILD_DIR 含会破坏远程命令引号的字符，拒绝执行: $HG_ANDROID_BUILD_DIR"
        exit 1
    fi

    print_info "构建宿主: <HG_ANDROID_BUILD_HOST>（不落盘、不入日志）"
    print_info "构建树:   $HG_ANDROID_BUILD_DIR"

    # 3b.1 同步源码：确保远程构建源就是本仓当前代码（含未提交改动）
    # 🔴 Guard 仓根含 keys/ 金库，必须白名单（fwrun-008 修 1）——全仓 rsync 会把金库
    #    整体推上远程构建宿主；白名单只带构建真正需要的 8 项（Cargo.toml / Cargo.lock /
    #    .cargo / core / push-common / agent / client / test），其余一律不带。
    print_info "同步源码到构建宿主..."
    rsync -az --delete --exclude 'target/' \
        -e "ssh -o BatchMode=yes" \
        --include '/Cargo.toml' --include '/Cargo.lock' --include '/.cargo/' --include '/.cargo/**' \
        --include '/core/' --include '/core/**' --include '/push-common/' --include '/push-common/**' \
        --include '/agent/' --include '/agent/**' --include '/client/' --include '/client/**' \
        --include '/test/' --include '/test/**' \
        --exclude '*' \
        "$HG_REPO/" "$HG_ANDROID_BUILD_HOST:$HG_ANDROID_BUILD_DIR/"
    print_ok "源码同步完成"

    # 3b.2 远程构建（fwrun-008 修 2）：探针实测远程 ~/.cargo/config.toml 无
    #      aarch64-linux-android linker 配置，cdylib 链接必需 CC/AR/target linker
    #      ⇒ env 前置，形态镜像 test-all.sh 远程 runner（NDK 自动探测 + 值经 printf %q
    #      转义 + 结束哨兵）。HG_ANDROID_REMOTE_NDK_HOME 无默认值不落盘；远程探测
    #      不到 NDK ⇒ 显式 FAIL（rc=20），不静默。
    print_info "远程 cargo build --release -p hg-android --target aarch64-linux-android ..."
    ANDROID_RUNNER="$TMP_DIR/hg-android-remote-runner.sh"
    {
        printf 'NDK_OVERRIDE=%s\n' "$(printf '%q' "$HG_ANDROID_REMOTE_NDK_HOME")"
        printf 'BUILD_DIR=%s\n' "$(printf '%q' "$HG_ANDROID_BUILD_DIR")"
        cat <<'RUNNER_EOF'
# 非交互 shell 不读 ~/.cargo/env ⇒ rustup 装的 cargo 不在 PATH（同 test-all.sh runner）。
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
    echo "远程宿主未找到 Android NDK（可用 HG_ANDROID_REMOTE_NDK_HOME 显式指定）"
    exit 20
fi
CLANG="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang"
AR="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-ar"
if [ ! -x "$CLANG" ] || [ ! -x "$AR" ]; then
    echo "远程 NDK 工具链不完整（缺 $CLANG 或 $AR）"
    exit 20
fi
export CC_aarch64_linux_android="$CLANG"
export AR_aarch64_linux_android="$AR"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$CLANG"   # cdylib 链接必需（rlib 期无需）
echo "远程 NDK: $NDK"
cd "$BUILD_DIR" || exit 21
BUILD_RC=0
cargo build --release -p hg-android --target aarch64-linux-android </dev/null 2>&1 || BUILD_RC=$?
echo "__HV_ANDROID_BUILD_DONE__ rc=$BUILD_RC"
[ "$BUILD_RC" -eq 0 ] || exit 22
exit 0
RUNNER_EOF
    } > "$ANDROID_RUNNER"
    ssh -o BatchMode=yes "$HG_ANDROID_BUILD_HOST" 'bash -s' < "$ANDROID_RUNNER"
    print_ok "远程构建完成"

    # 3b.3 取回产物（crate-type 裁决定稿：cdylib ⇒ libhg_android.so，fwrun-008 修 4）
    ANDROID_ART="$TMP_DIR/libhg_android.so"
    scp -o BatchMode=yes \
        "$HG_ANDROID_BUILD_HOST:$HG_ANDROID_BUILD_DIR/target/aarch64-linux-android/release/libhg_android.so" \
        "$ANDROID_ART"

    if [[ ! -f "$ANDROID_ART" ]]; then
        print_error "scp 声称成功但本地产物不存在: $ANDROID_ART"
        exit 1
    fi
    print_ok "产物已取回: $(size_of "$ANDROID_ART") bytes"

    # --- ELF 断言（替换进落点之前）---
    if ! assert_android_elf "$ANDROID_ART"; then
        exit 1
    fi

    ANDROID_DEST_REL="src-tauri/resources/HuanvaeGuard-android/libhg_android.so"
    ART_SRC+=("$ANDROID_ART")
    ART_DEST_REL+=("$ANDROID_DEST_REL")
    ART_CRATE+=("hg-android")
    ART_TARGET+=("aarch64-linux-android")
    ART_CSFLAGS+=("")
    ART_ARCH+=("aarch64")
    ART_PE+=("")
fi

# ============================================
# 步骤 4: 替换落点 + sha256 校验
# ============================================
print_step "4/7" "替换落点并校验 sha256..."

ART_COUNT=${#ART_SRC[@]}
i=0
while [[ $i -lt $ART_COUNT ]]; do
    src="${ART_SRC[$i]}"
    dest_rel="${ART_DEST_REL[$i]}"
    dest="$PROJECT_ROOT/$dest_rel"

    src_sha="$(sha256_of "$src")"

    mkdir -p "$(dirname "$dest")"
    cp "$src" "$dest"

    # 重算落点文件的 sha —— 防"以为替换了其实没替换"
    dest_sha="$(sha256_of "$dest")"

    if [[ "$src_sha" != "$dest_sha" ]]; then
        print_error "替换后 sha256 不一致: $dest_rel"
        echo -e "    ${RED}源产物: $src_sha${NC}"
        echo -e "    ${RED}落点:   $dest_sha${NC}"
        exit 1
    fi

    print_ok "$dest_rel  sha256=$dest_sha"
    ART_SHA+=("$dest_sha")
    i=$((i + 1))
done

# ============================================
# 步骤 5: 泄露扫描（PUBLIC 仓）
# ============================================
print_step "5/7" "泄露扫描（构建机路径 / 私网地址）..."

LEAK_FAILED=false
i=0
while [[ $i -lt $ART_COUNT ]]; do
    dest_rel="${ART_DEST_REL[$i]}"
    dest="$PROJECT_ROOT/$dest_rel"

    if scan_leaks "$dest"; then
        print_ok "$dest_rel  未命中"
    else
        LEAK_FAILED=true
    fi
    i=$((i + 1))
done

if $LEAK_FAILED; then
    echo ""
    print_error "泄露扫描命中 —— 本仓是 PUBLIC 公开仓，禁止提交 / 发布该产物"
    echo -e "${YELLOW}  排查方向：HuanvaeGuard 仓 .cargo/config.toml 的 --remap-path-prefix 是否覆盖了本次构建机的 home 根，${NC}"
    echo -e "${YELLOW}  以及是否有环境变量 RUSTFLAGS 把仓内配置整体覆盖掉了。${NC}"
    exit 1
fi

# ============================================
# 步骤 6: 写 manifest
# ============================================
print_step "6/7" "写 build manifest..."

BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
MANIFEST_PATH="$PROJECT_ROOT/$MANIFEST_REL"

{
    echo "{"
    echo "  \"source_repo_commit\": \"$(json_escape "$SRC_COMMIT")\","
    echo "  \"source_repo_dirty\": $SRC_DIRTY,"

    if [[ ${#DIRTY_FILES[@]} -eq 0 ]]; then
        echo "  \"source_repo_dirty_files\": [],"
    else
        echo "  \"source_repo_dirty_files\": ["
        j=0
        while [[ $j -lt ${#DIRTY_FILES[@]} ]]; do
            sep=","
            [[ $((j + 1)) -eq ${#DIRTY_FILES[@]} ]] && sep=""
            echo "    \"$(json_escape "${DIRTY_FILES[$j]}")\"$sep"
            j=$((j + 1))
        done
        echo "  ],"
    fi

    echo "  \"built_at_utc\": \"$BUILT_AT\","
    echo "  \"artifacts\": ["
    i=0
    while [[ $i -lt $ART_COUNT ]]; do
        sep=","
        [[ $((i + 1)) -eq $ART_COUNT ]] && sep=""
        echo "    {"
        echo "      \"path\": \"$(json_escape "${ART_DEST_REL[$i]}")\","
        echo "      \"crate\": \"$(json_escape "${ART_CRATE[$i]}")\","
        echo "      \"target\": \"$(json_escape "${ART_TARGET[$i]}")\","
        # 产物形态实测值：macOS 记 arch，Windows 记 pe_machine（各自只有一个有值）
        if [[ -n "${ART_ARCH[$i]}" ]]; then
            echo "      \"arch\": \"$(json_escape "${ART_ARCH[$i]}")\","
        fi
        if [[ -n "${ART_PE[$i]}" ]]; then
            echo "      \"pe_machine\": \"$(json_escape "${ART_PE[$i]}")\","
        fi
        if [[ -n "${ART_CSFLAGS[$i]}" ]]; then
            echo "      \"sha256\": \"$(json_escape "${ART_SHA[$i]}")\","
            echo "      \"codesign_flags\": \"$(json_escape "${ART_CSFLAGS[$i]}")\""
        else
            echo "      \"sha256\": \"$(json_escape "${ART_SHA[$i]}")\""
        fi
        echo "    }$sep"
        i=$((i + 1))
    done
    echo "  ]"
    echo "}"
} > "$MANIFEST_PATH"

print_ok "$MANIFEST_REL"
print_info "（manifest 只记 commit / 产物 / 签名形态，不含任何主机名、IP、用户名）"

if [[ "$WIN_BUILT" == "false" ]]; then
    print_warn "本次未构建 Windows 产物，manifest 的 artifacts 不完整"
fi

# ============================================
# 步骤 7: 汇总
# ============================================
print_header "构建完成"

echo ""
echo -e "  ${WHITE}来源 commit: $SRC_COMMIT${NC}"
if $SRC_DIRTY; then
    echo -e "  ${YELLOW}来源状态:   dirty（有未提交改动，产物不可由 commit 复现）${NC}"
else
    echo -e "  ${GRAY}来源状态:   clean${NC}"
fi
echo -e "  ${GRAY}构建时间:   $BUILT_AT${NC}"
echo ""

i=0
while [[ $i -lt $ART_COUNT ]]; do
    dest_rel="${ART_DEST_REL[$i]}"
    dest="$PROJECT_ROOT/$dest_rel"
    echo -e "  ${WHITE}${dest_rel}${NC}"
    echo -e "    ${GRAY}crate:  ${ART_CRATE[$i]}  (${ART_TARGET[$i]})${NC}"
    echo -e "    ${GRAY}大小:   $(size_of "$dest") bytes${NC}"
    echo -e "    ${GRAY}sha256: ${ART_SHA[$i]}${NC}"
    if [[ -n "${ART_ARCH[$i]}" ]]; then
        echo -e "    ${GRAY}架构:   ${ART_ARCH[$i]}${NC}"
    fi
    if [[ -n "${ART_PE[$i]}" ]]; then
        echo -e "    ${GRAY}PE:     PE32+ ${ART_PE[$i]}${NC}"
    fi
    if [[ -n "${ART_CSFLAGS[$i]}" ]]; then
        echo -e "    ${GRAY}签名:   ${ART_CSFLAGS[$i]}${NC}"
    fi
    echo ""
    i=$((i + 1))
done

if [[ "$WIN_BUILT" == "false" ]]; then
    print_warn "Windows 产物未构建 —— 本次结果不可用于发布"
    echo ""
fi

echo -e "  ${CYAN}manifest: $MANIFEST_REL${NC}"
echo ""
