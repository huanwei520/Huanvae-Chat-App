#!/bin/bash
#
# hv-control-daemon 随包内容独立核对 —— 解包找件 + SHA256 对账（bl0d10qj-1 新增独立件）
#
# ## 归属与边界（任务卡裁定，为什么有这个脚本）
#   daemon 件的 L1 产品断言归在飞管线改造块（3224uyx1-1）的 v2 清单承接；
#   本脚本是【独立新文件】，不改 scripts/linux/test-all.sh 与 assert-artifact-content.sh
#   本体任一行，供本块自验与后续管线按需调用。期望哈希唯一来源 =
#   src-tauri/resources/hv-control-daemon.manifest.json（同批新增，含构建锚）。
#
# ## 三条腿
#   1) 接线腿：tauri.windows.conf.json / tauri.macos.conf.json 的 externalBin 已填
#      binaries/hv-control-daemon（防"件在仓里但包不带"的缺环复发）；
#   2) 仓内件腿：manifest.artifacts[] 逐一存在 + sha256 复算一致；
#   3) 解包腿：对给定安装包解包（NSIS→7z / .app.tar.gz→tar / DMG→7z 尽力 / deb→ar+tar），
#      找 hv-control-daemon* 并按平台对 manifest 期望哈希逐一复算。
#
# ## 用法
#   scripts/assert-daemon-content.sh <安装包>...        # 接线腿+仓内件腿+解包腿
#   scripts/assert-daemon-content.sh --bins-only        # 只跑接线腿+仓内件腿（不解包）
#   选项：--manifest <路径>  覆盖 manifest 路径（默认 src-tauri/resources/hv-control-daemon.manifest.json）
#         --skip-config     跳过接线腿（如 CI 上 tauri.*.conf.json 形态不同时）
#
# ## 退出码
#   0 = 全部在位且哈希一致；1 = 任一缺失/哈希不符/解包失败（fail-closed，绝不静默降级）
#
# @date 2026-09-15  bl0d10qj-1

set -u

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; GRAY='\033[0;90m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_TAURI="$PROJECT_ROOT/src-tauri"
MANIFEST="$SRC_TAURI/resources/hv-control-daemon.manifest.json"

SKIP_CONFIG=false
BINS_ONLY=false
POSITIONAL=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --manifest) MANIFEST="$2"; shift 2 ;;
        --skip-config) SKIP_CONFIG=true; shift ;;
        --bins-only) BINS_ONLY=true; shift ;;
        -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) POSITIONAL+=("$1"); shift ;;
    esac
done

FAILED=0
fail()   { echo -e "  ${RED}✗ FAIL: $1${NC}"; FAILED=1; }
pass()   { echo -e "  ${GREEN}✓ $1${NC}"; }
warn()   { echo -e "  ${YELLOW}⚠ $1${NC}"; }
info()   { echo -e "  ${GRAY}· $1${NC}"; }
sha_of() { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }

echo ""
echo -e "${CYAN}════════ hv-control-daemon 随包独立核对 ════════${NC}"
echo -e "${GRAY}manifest: $MANIFEST${NC}"

# ---------- manifest 本体 ----------
if [[ ! -s "$MANIFEST" ]]; then
    fail "manifest 不存在或为空: $MANIFEST"
    echo ""
    exit 1
fi
if ! command -v node >/dev/null 2>&1; then
    fail "本机无 node（manifest 解析需要）—— fail-closed"
    echo ""
    exit 1
fi

# ---------- 腿1: externalBin 接线 ----------
if ! $SKIP_CONFIG; then
    echo ""
    echo -e "${CYAN}腿1 ▶ externalBin 接线（平台 conf 合并后必须带 daemon）${NC}"
    for f in tauri.windows.conf.json tauri.macos.conf.json; do
        p="$SRC_TAURI/$f"
        if [[ ! -s "$p" ]]; then
            fail "平台 conf 缺失: src-tauri/$f"
            continue
        fi
        hit=$(node -e "
const j=JSON.parse(require('fs').readFileSync('$p','utf8'));
const eb=(j.bundle&&j.bundle.externalBin)||[];
console.log(eb.some(x=>String(x).includes('hv-control-daemon'))?'YES':'NO');" 2>/dev/null)
        if [[ "$hit" == "YES" ]]; then
            pass "$f: externalBin 含 hv-control-daemon"
        else
            fail "$f: externalBin 未填 hv-control-daemon（安装包将不带 daemon —— 1d0t34vy-3 卡点复发）"
        fi
    done
fi

# ---------- 腿2: 仓内件腿（manifest.artifacts 逐一复算） ----------
echo ""
echo -e "${CYAN}腿2 ▶ 仓内 daemon 件（manifest.artifacts[] 存在性 + SHA256 复算）${NC}"
N=$(node -e "const j=JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));console.log((j.artifacts||[]).length);")
if [[ ! "$N" =~ ^[0-9]+$ ]] || [[ "$N" -eq 0 ]]; then
    fail "manifest.artifacts 为空或不可解析"
else
    for ((i=0; i<N; i++)); do
        rel=$(node -e "const j=JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));console.log(j.artifacts[$i].path||'');")
        want=$(node -e "const j=JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));console.log(j.artifacts[$i].sha256||'');")
        tgt=$(node -e "const j=JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));console.log(j.artifacts[$i].target||'');")
        f="$PROJECT_ROOT/$rel"
        if [[ ! -s "$f" ]]; then
            fail "[$tgt] 仓内件缺失: $rel"
            continue
        fi
        got=$(sha_of "$f")
        if [[ "$got" == "$want" ]]; then
            pass "[$tgt] $rel sha256 一致 (${got:0:12}…)"
        else
            fail "[$tgt] $rel 哈希不符"
            info "    期望: $want"
            info "    实际: $got"
        fi
    done
fi

# ---------- 腿3: 解包腿 ----------
verify_unpacked_daemon() { # $1=解包根 $2=平台期望sha $3=平台标签 $4=匹配glob
    local root="$1" want="$2" tag="$3" glob="$4" hit got
    hit=$(find "$root" -iname "$glob" -type f -size +0c 2>/dev/null | head -1)
    if [[ -z "$hit" ]]; then
        fail "[$tag] 包内未找到 hv-control-daemon 件（glob=$glob）—— 安装后远程控制不可用"
        return
    fi
    got=$(sha_of "$hit")
    if [[ "$got" == "$want" ]]; then
        pass "[$tag] 包内 daemon 字节核对一致 (${got:0:12}… ← ${hit#$root/})"
    else
        fail "[$tag] 包内 daemon 哈希不符: ${hit#$root/}"
        info "    期望(manifest): $want"
        info "    实际           : $got"
    fi
}

want_sha_for() { # $1=manifest内的target三元组 → 期望sha（空=无）
    node -e "
const j=JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));
const a=(j.artifacts||[]).find(x=>x.target==='$1');
console.log(a?a.sha256:'');"
}

if ! $BINS_ONLY; then
    if [[ ${#POSITIONAL[@]} -eq 0 ]]; then
        info "未指定安装包 → 解包腿跳过（自验二件套场景用 --bins-only 消除本提示）"
    fi
    for a in "${POSITIONAL[@]}"; do
        echo ""
        echo -e "${CYAN}腿3 ▶ 解包核对: $(basename "$a")${NC}"
        if [[ ! -f "$a" ]]; then fail "安装包不存在: $a"; continue; fi
        work=$(mktemp -d) || { fail "无法创建临时目录"; continue; }
        lower=$(basename "$a" | tr '[:upper:]' '[:lower:]')
        case "$lower" in
            *.exe)  # Tauri NSIS（Windows 腿；externalBin 件名 = hv-control-daemon.exe）
                if ! command -v 7z >/dev/null 2>&1; then
                    fail "本机无 7z（p7zip）—— fail-closed"
                elif 7z x -y -o"$work/nsis" "$a" >/dev/null 2>&1; then
                    verify_unpacked_daemon "$work/nsis" "$(want_sha_for x86_64-pc-windows-msvc)" "NSIS/Windows" 'hv-control-daemon*.exe'
                else
                    fail "7z 解包失败（不是可解的 NSIS 产物？）—— fail-closed"
                fi ;;
            *.tar.gz|*.tgz)  # macOS .app.tar.gz（updater 产物；externalBin 件在 Contents/MacOS/）
                if tar xzf "$a" -C "$work" --no-same-owner 2>/dev/null; then
                    verify_unpacked_daemon "$work" "$(want_sha_for aarch64-apple-darwin)" "macOS(.app)" 'hv-control-daemon'
                else
                    fail "tar 解包失败 —— fail-closed"
                fi ;;
            *.dmg)
                if command -v 7z >/dev/null 2>&1 && 7z x -y -o"$work/dmg" "$a" >/dev/null 2>&1 \
                    && find "$work/dmg" -name "*.app" -type d 2>/dev/null | grep -q .; then
                    app_root=$(find "$work/dmg" -name "*.app" -type d 2>/dev/null | head -1)
                    verify_unpacked_daemon "$app_root" "$(want_sha_for aarch64-apple-darwin)" "DMG/macOS" 'hv-control-daemon'
                else
                    # 与 v2 清单同口径：7z 对 HFS/APFS 支持参差，解不开如实 WARN（不冒充通过）
                    warn "[DMG] 本机解包器无法解此 DMG（.app.tar.gz 才是 macOS 可靠核对对象）"
                fi ;;
            *.deb)  # Debian 包（xfu0nh5q-1 第4轮增补腿：deb 缺 daemon 静默发货的防线——
                    # 如 release.yml deb-repack externalBin 搬移块被删/失效，deb 内缺件本腿拦截）
                if ! command -v ar >/dev/null 2>&1; then
                    fail "本机无 ar（binutils）—— fail-closed"
                else
                    ( cd "$work" && ar x "$a" ) || { fail "ar 解 deb 失败 —— fail-closed"; continue; }
                    data=$(ls "$work"/data.tar.* 2>/dev/null | head -1)
                    if [[ -z "$data" ]]; then fail "deb 内无 data.tar.* —— fail-closed"; continue; fi
                    mkdir -p "$work/deb-root"
                    if tar xf "$data" -C "$work/deb-root" --no-same-owner 2>/dev/null; then
                        verify_unpacked_daemon "$work/deb-root" "$(want_sha_for x86_64-unknown-linux-gnu)" "deb/Linux" 'hv-control-daemon*'
                    else
                        fail "data.tar 解包失败 —— fail-closed"
                    fi
                fi ;;
            *) fail "不认识的安装包扩展名: $a（支持 .exe/.tar.gz/.dmg/.deb）" ;;
        esac
        rm -rf "$work"
    done
fi

echo ""
if [[ "$FAILED" -eq 0 ]]; then
    echo -e "${GREEN}GRAND: hv-control-daemon 随包核对全绿${NC}"
else
    echo -e "${RED}GRAND: FAIL —— 存在缺件/哈希不符，禁止据此发货${NC}"
fi
echo ""
exit "$FAILED"
