#!/bin/bash
#
# 产物内容清单断言 v2 —— 全平台必含件清单 + 发货落点 manifest 逐哈希核对
#
# ## 与 v1（assert-artifact-content.sh，v1.1.47 06c45278）的关系
#   v1 根治「安装包不含 HuanvaeGuard 组件」：映射并集静态腿 + 解包看文件**存在**。
#   v1.1.47 事故（发布早于新 guard 件产出 11 分钟、包内旧件 fa1e0f68 流出）暴露的下一个
#   盲区是：**文件在包里 ≠ 在包里的是对的字节**。v2 在 v1 的三条腿之上把产物腿升级为：
#   每个必含件都有**期望 SHA256 及其来源**（发货落点 manifest / 仓内落点文件），
#   解包逐一复算，缺件或哈希不符即 FAIL 并打印差异表。v1 的静态腿原样保留（映射被删
#   仍要红）。v1 文件保持不动，本脚本是独立新件；接入由调用方切换（test-all.sh 第 14 步）。
#
# ## 必含件清单（与真实发货包逐字节核过：v1.1.48 渠道包 ground truth）
#   Windows NSIS(.exe)：
#     HuanvaeGuard/huanvaeguard-svc.exe   期望 sha ← hg-build-manifest.json（windows 腿）
#     HuanvaeGuard/wintun.dll             期望 sha ← 仓内落点 src-tauri/resources/HuanvaeGuard/wintun.dll
#     hv-control-daemon（随 1.1.49 起）    期望 sha ← 仓内落点 src-tauri/binaries/hv-control-daemon-<win 三元组>
#     Notification-Sounds/ ≥1 文件（v1 口径保留：既有映射不得在平台合并中静默丢失）
#   Linux deb / AppImage：
#     usr/lib/Huanvae-Chat-App/HuanvaeGuard/{huanvaeguard-svc.exe,wintun.dll}（同上两期望来源）
#     hv-control-daemon（随 1.1.49 起）← 仓内 binaries/hv-control-daemon-x86_64-unknown-linux-gnu
#   macOS（.app.tar.gz 可靠解；.dmg 7z 如可解一并）：
#     Contents/Resources/HuanvaeGuard-macos/hg-macos               期望 sha ← manifest（macos 腿）
#     Contents/Resources/HuanvaeGuard-macos/com.huanvaeguard.daemon.plist
#                                                    期望 sha ← 仓内落点 resources/HuanvaeGuard-macos/com.huanvaeguard.daemon.plist
#   Android APK：
#     lib/<abi>/libhg_android.so × 四 ABI（arm64-v8a armeabi-v7a x86 x86_64）
#     期望 sha 来源：**无仓内对照**（APK 内 sidecar 由 CI 按目标现构建，非 resources 落点
#     文件——v1.1.45 实包三 ABI 与 resources 件字节数即不同）→ 断言降为「存在 + 非空」，
#     并在本脚本输出中**如实登记该期望来源缺口**；可用 `--expect <包内路径>=<sha256>`
#     由发布记录补钉（补了才核对哈希）。
#
# ## 「随 1.1.49 起」条目的生效口径
#   带 since 的条目：目标版本 ≥ since 才成为必含（旧包核验不误伤）。
#   目标版本来源（优先级）：--target-version > 环境变量 ARTIFACT_TARGET_VERSION > 0.0.0
#   （=since 条目一律不生效，输出会打一行「未启用」提醒，防止被无感跳过）。
#
# ## 用法
#   scripts/assert-artifact-content-v2.sh <产物文件>...      # 静态腿 + 指定产物逐个解包核对
#   scripts/assert-artifact-content-v2.sh                    # 静态腿 + 扫描本机 bundle 目录
#   选项：--target-version 1.1.49        启用 since 门
#         --expect <path>=<sha256>       追加期望（可多次；如 APK sidecar 补钉）
#         --skip-static                  只跑产物腿（对已发布渠道包核验时静态腿可能无意义）
#   环境变量：ARTIFACT_GUARD_ABIS   覆盖 APK 必含 ABI 列表（默认"arm64-v8a armeabi-v7a x86 x86_64"，
#                                     任务口径四 ABI；v1.1.45 实包为三 ABI——用它登记现实并如实上报）
#             BUNDLE_DIR           覆盖扫描根（默认 src-tauri/target/release/bundle）
#
# ## 退出码
#   0 = 静态腿通过（如未跳过）且产物腿全部核对通过
#   1 = 任一断言失败（缺件 / 哈希不符 / 无法解包 fail-closed / 静态腿红）

set -u

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; GRAY='\033[0;90m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"   # scripts/ 的上级 = 仓库根
SRC_TAURI="$PROJECT_ROOT/src-tauri"
# 期望 manifest 来源：默认发货落点；环境变量 ARTIFACT_MANIFEST_FILE 可指定替代文件
# （L4 渠道对账用：后发布验证必须锚定发布 tag 自带的 manifest，而非本地工作树——
#  工作树落后于热修时会误报「哈希不符」，实测踩过）
HG_MANIFEST="${ARTIFACT_MANIFEST_FILE:-$SRC_TAURI/resources/hg-build-manifest.json}"
BUNDLE_DIR="${BUNDLE_DIR:-$SRC_TAURI/target/release/bundle}"
GUARD_ABIS="${ARTIFACT_GUARD_ABIS:-arm64-v8a armeabi-v7a x86 x86_64}"

TARGET_VERSION="0.0.0"
SKIP_STATIC=false
EXPECT_ARGS=()
POSITIONAL=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target-version) TARGET_VERSION="$2"; shift 2 ;;
        --expect) EXPECT_ARGS+=("$2"); shift 2 ;;
        --skip-static) SKIP_STATIC=true; shift ;;
        -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) POSITIONAL+=("$1"); shift ;;
    esac
done

FAILED=0
CHECKED_ARTIFACTS=0
declare -a DIFF_LINES=()

fail() { echo -e "  ${RED}✗ FAIL: $1${NC}"; DIFF_LINES+=("FAIL: $1"); FAILED=1; }
pass() { echo -e "  ${GREEN}✓ $1${NC}"; }
warn() { echo -e "  ${YELLOW}⚠ $1${NC}"; }
info() { echo -e "  ${GRAY}· $1${NC}"; }

sha_of() {
    # macOS runner 无 sha256sum（v1.1.50 CI 实证：2>/dev/null 吔掉 command not found → 返回空串
    # → 误报「哈希不符」）。有 sha256sum 用 sha256sum，否则退 shasum -a 256（macOS 自带）。
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" 2>/dev/null | awk '{print $1}'
    else
        shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
    fi
}

version_ge() {  # $1=target $2=since → target>=since ?
    # 🔴 不能写 local IFS='.'：实测 local 列表里的 IFS 赋值不作用于后续 read（拆分失效，
    #    a=(1.1.48) 不拆），必须用「IFS='.' read」前缀赋值形式
    local a b x y i
    IFS='.' read -ra a <<< "$1"
    IFS='.' read -ra b <<< "$2"
    for i in 0 1 2; do
        x=${a[i]:-0}; y=${b[i]:-0}
        (( 10#$x > 10#$y )) && return 0
        (( 10#$x < 10#$y )) && return 1
    done
    return 0
}

# ---------- 期望 SHA 来源表 ----------
# load_expected <repo相对路径>  → stdout=sha256 或空；stderr=来源说明
load_expected() {
    local rel="$1"
    # 来源①：发货落点 manifest（构建脚本写入，双腿 sha256）
    if [[ -f "$HG_MANIFEST" ]] && command -v node >/dev/null 2>&1; then
        local m
        m=$(node -e "
const j=JSON.parse(require('fs').readFileSync('$HG_MANIFEST','utf8'));
const hit=(j.artifacts||[]).find(a=>a.path==='$rel');
console.log(hit?hit.sha256:'');" 2>/dev/null)
        if [[ -n "$m" ]]; then
            echo "$m"
            return 0
        fi
    fi
    # 来源②：仓内落点文件本身（随仓发货的字节）
    if [[ -s "$PROJECT_ROOT/$rel" ]]; then
        sha_of "$PROJECT_ROOT/$rel"
        return 0
    fi
    return 1
}

expected_source_label() {  # 与 load_expected 相同顺序，只判来源标签（打印用）
    if [[ -f "$HG_MANIFEST" ]] && command -v node >/dev/null 2>&1; then
        local m
        m=$(node -e "
const j=JSON.parse(require('fs').readFileSync('$HG_MANIFEST','utf8'));
const hit=(j.artifacts||[]).find(a=>a.path==='$1');
console.log(hit?hit.sha256:'');" 2>/dev/null)
        [[ -n "$m" ]] && { echo "发货落点 manifest($HG_MANIFEST 的 $1)"; return; }
    fi
    if [[ -s "$PROJECT_ROOT/$1" ]]; then echo "仓内落点文件($1) 逐字节对照"; return; fi
    echo "无来源"
}

# 额外 --expect 期望（包内路径 → sha）
# bash3.2 兼容（v1.1.50 CI 实证）：macOS runner /bin/bash=3.2 无关联数组（declare -A →
# "invalid option"），且 set -u 下空数组 "${EXPECT_ARGS[@]}" 展开报 unbound variable。
# → 改平行索引数组线性查找 + ${arr[@]+...} 空数组守卫（bash3.2 同样可用）。
EXTRA_EXPECT_KEYS=()
EXTRA_EXPECT_VALS=()
extra_expect_get() {  # $1=key → stdout=sha（未注册=空）
    local i
    for i in ${EXTRA_EXPECT_KEYS[@]+"${!EXTRA_EXPECT_KEYS[@]}"}; do
        [[ "${EXTRA_EXPECT_KEYS[$i]}" == "$1" ]] && { echo "${EXTRA_EXPECT_VALS[$i]}"; return 0; }
    done
    return 0
}
for e in ${EXPECT_ARGS[@]+"${EXPECT_ARGS[@]}"}; do
    [[ "$e" == *=* ]] || { fail "--expect 格式应为 <包内路径>=<sha256>: $e"; continue; }
    EXTRA_EXPECT_KEYS+=("${e%%=*}")
    EXTRA_EXPECT_VALS+=("${e#*=}")
done

# 在解包树里按「必含件断言」核对一个文件
#   $1=解包树  $2=包内相对模式（find -path 尾段）  $3=期望sha(空=只验存在)  $4=期望来源  $5=条目标签  $6=包标签
assert_item() {
    local tree="$1" pattern="$2" want="$3" src="$4" item="$5" label="$6"
    local hit
    hit=$(find "$tree" -path "*/$pattern" -type f -size +0c 2>/dev/null | head -1)
    if [[ -z "$hit" ]]; then
        # 允许 exact（无前导目录）匹配：deb 顶层 usr/lib/... 本就带前导；NSIS 是根相对
        hit=$(find "$tree" -path "./$pattern" -type f -size +0c 2>/dev/null | head -1)
    fi
    if [[ -z "$hit" ]]; then
        fail "[$label] 必含件缺失: $pattern"
        DIFF_LINES+=("  期望存在: $pattern  实际: 无")
        return 1
    fi
    if [[ -z "$want" ]]; then
        pass "[$label] $item 在包内且非空：${hit#$tree/}"
        return 0
    fi
    local got
    got=$(sha_of "$hit")
    if [[ "$got" == "$want" ]]; then
        pass "[$label] $item 字节核对一致 (${got:0:8}… ← $src)"
    else
        fail "[$label] $item 哈希不符 —— 包内不是期望字节（v1.1.47 事故形态：包里是旧件）"
        DIFF_LINES+=("  文件: ${hit#$tree/}")
        DIFF_LINES+=("    期望($src): $want")
        DIFF_LINES+=("    实际        : $got")
    fi
}

# ---------- 静态腿（v1 口径保留） ----------
if ! $SKIP_STATIC; then
    echo -e "${CYAN}静态腿：bundle.resources 映射并集 + Guard 源文件在仓（v1 口径保留）${NC}"
    # node 是原生 exe：git-bash（Windows runner）下 $SRC_TAURI 是 MSYS 风格路径（/d/a/...），
    # node 读不到 → v1.1.50 CI 首跑实证“解析 tauri*.conf.json 失败”。有 cygpath 就转混合斜杠
    # （D:/a/...，JS 字符串安全且 node-windows 可读）；Linux/macOS 无 cygpath 原样不动。
    NODE_SRC_TAURI="$SRC_TAURI"
    if command -v cygpath >/dev/null 2>&1; then NODE_SRC_TAURI=$(cygpath -m "$SRC_TAURI"); fi
    STATIC_JSON=$(node -e "
const fs = require('fs');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const base = read('$NODE_SRC_TAURI/tauri.conf.json');
let win = {}, mac = {};
try { win = read('$NODE_SRC_TAURI/tauri.windows.conf.json'); } catch (e) {}
try { mac = read('$NODE_SRC_TAURI/tauri.macos.conf.json'); } catch (e) {}
const merge = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object'
      || a === null || b === null) return b === undefined ? a : b;
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = merge(a[k], b[k]);
  return out;
};
console.log(JSON.stringify({
  desktop: merge(base.bundle?.resources ?? {}, win.bundle?.resources ?? {}),
  macos: merge(base.bundle?.resources ?? {}, mac.bundle?.resources ?? {}),
}));") || fail "解析 tauri*.conf.json 失败"
    if [[ -n "$STATIC_JSON" ]]; then
        STATIC_RC=0
        node -e "
const { desktop, macos } = JSON.parse(process.argv[1]);
const entries = (m) => Object.entries(m ?? {});
const die = (msg) => { console.error(msg); process.exit(1); };
const guardWin = entries(desktop).filter(([k, v]) => /HuanvaeGuard\/\*$/.test(k) && v === 'HuanvaeGuard/');
if (guardWin.length !== 1) die('bundle.resources 并集中 HuanvaeGuard 映射缺失或不唯一');
const guardMac = entries(macos).filter(([k, v]) => /HuanvaeGuard-macos\/\*$/.test(k) && v === 'HuanvaeGuard-macos/');
if (guardMac.length !== 1) die('bundle.resources 并集中 HuanvaeGuard-macos 映射缺失或不唯一');
for (const [label, m] of [['desktop', desktop], ['macos', macos]]) {
  const ns = entries(m).filter(([k, v]) => /Notification-Sounds\/\*$/.test(k) && v === 'Notification-Sounds/');
  if (ns.length !== 1) die(label + ' 并集中 Notification-Sounds 映射缺失或不唯一');
}
console.log('MAP_OK');" "$STATIC_JSON" || STATIC_RC=$?
        [[ $STATIC_RC -eq 0 ]] && pass "映射并集齐全（HuanvaeGuard / HuanvaeGuard-macos / Notification-Sounds）" \
            || fail "bundle.resources 映射断言失败（见上）"
    fi
    for f in \
        "resources/HuanvaeGuard/huanvaeguard-svc.exe" \
        "resources/HuanvaeGuard/wintun.dll" \
        "resources/HuanvaeGuard-macos/hg-macos" \
        "resources/HuanvaeGuard-macos/com.huanvaeguard.daemon.plist"; do
        if [[ -s "$SRC_TAURI/$f" ]]; then
            pass "源文件在仓且非空：src-tauri/$f"
        else
            fail "源文件缺失或为空：src-tauri/$f"
        fi
    done
fi

# ---------- since 门提示 ----------
DAEMON_SINCE="1.1.49"
if version_ge "$TARGET_VERSION" "$DAEMON_SINCE"; then
    echo -e "${CYAN}since 门：目标版本 $TARGET_VERSION ≥ $DAEMON_SINCE → hv-control-daemon 为必含件${NC}"
else
    echo -e "${YELLOW}since 门：目标版本 $TARGET_VERSION < $DAEMON_SINCE → hv-control-daemon 本次不强制（旧包核验不误伤；任务口径自 1.1.49 起必含）${NC}"
fi

# ---------- 产物腿 ----------
check_artifact() {
    local artifact="$1" ext="$2"
    local work rc label
    label="$(basename "$artifact")"
    work=$(mktemp -d) || { fail "[$label] 无法创建临时目录"; return; }
    CHECKED_ARTIFACTS=$((CHECKED_ARTIFACTS + 1))
    echo -e "${CYAN}产物腿 ▶ $label${NC}"

    case "$ext" in
      exe)  # Tauri NSIS
        # 7z 解析：PATH 优先，GitHub windows runner 的预装位兜底（实测 runner 不一定把它放 PATH）
        SEVENZ="7z"
        command -v 7z >/dev/null 2>&1 || { for c in "/c/Program Files/7-Zip/7z.exe" "/c/Program Files (x86)/7-Zip/7z.exe"; do
            [[ -f "$c" ]] && SEVENZ="$c" && break; done; }
        local want_svc want_dll want_plist=""; local src_svc src_dll
        want_svc=$(load_expected "src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe"); src_svc=$(expected_source_label "src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe")
        want_dll=$(load_expected "src-tauri/resources/HuanvaeGuard/wintun.dll"); src_dll=$(expected_source_label "src-tauri/resources/HuanvaeGuard/wintun.dll")
        if ! command -v "$SEVENZ" >/dev/null 2>&1 && [[ ! -f "$SEVENZ" ]]; then
            fail "[$label] 本机无 7z（p7zip）——fail-closed，安装 p7zip 后重跑"
        elif "$SEVENZ" x -y -o"$work/nsis" "$artifact" >/dev/null 2>&1; then
            assert_item "$work/nsis" "HuanvaeGuard/huanvaeguard-svc.exe" "$want_svc" "$src_svc" "huanvaeguard-svc.exe" "NSIS"
            assert_item "$work/nsis" "HuanvaeGuard/wintun.dll" "$want_dll" "$src_dll" "wintun.dll" "NSIS"
            if find "$work/nsis" -path "*Notification-Sounds/*" -type f 2>/dev/null | grep -q .; then
                pass "[NSIS] Notification-Sounds 资源在包内"
            else
                fail "[NSIS] Notification-Sounds 资源不在包内"
            fi
            if version_ge "$TARGET_VERSION" "$DAEMON_SINCE"; then
                # 打包名由 tauri 按三元组落定，1.1.49 首个实包出得以它为准钉死；先按 hv-control-daemon* 前缀断言
                local hit_repo=""
                for cand in "$SRC_TAURI"/binaries/hv-control-daemon-x86_64-pc-windows-*.exe; do
                    [[ -s "$cand" ]] && hit_repo="$cand" && break
                done
                local want_daemon="" src_daemon="无来源（binaries/ 无 windows 件）"
                [[ -n "$hit_repo" ]] && { want_daemon=$(sha_of "$hit_repo"); src_daemon="仓内落点(${hit_repo#$PROJECT_ROOT/})"; }
                local hit_pkg
                hit_pkg=$(find "$work/nsis" -iname 'hv-control-daemon*.exe' -type f -size +0c 2>/dev/null | head -1)
                if [[ -z "$hit_pkg" ]]; then
                    fail "[NSIS] hv-control-daemon 缺失（随 $DAEMON_SINCE 起必含）—— 安装后远程控制不可用"
                    DIFF_LINES+=("  期望存在: hv-control-daemon*.exe  实际: 无")
                elif [[ -n "$want_daemon" ]]; then
                    local got; got=$(sha_of "$hit_pkg")
                    if [[ "$got" == "$want_daemon" ]]; then
                        pass "[NSIS] hv-control-daemon 字节核对一致 (${got:0:8}… ← $src_daemon)"
                    else
                        fail "[NSIS] hv-control-daemon 哈希不符"
                        DIFF_LINES+=("  文件: ${hit_pkg#$work/nsis/}")
                        DIFF_LINES+=("    期望($src_daemon): $want_daemon")
                        DIFF_LINES+=("    实际              : $got")
                    fi
                else
                    pass "[NSIS] hv-control-daemon 在包内且非空（无仓内对照期望，存在性断言）"
                fi
            fi
        else
            fail "[$label] 7z 解包失败（不是可解的 NSIS 产物？）—— fail-closed（解包器: $SEVENZ）"
        fi
        ;;
      deb)
        local extracted=false
        if command -v dpkg-deb >/dev/null 2>&1; then
            dpkg-deb -x "$artifact" "$work/deb" 2>/dev/null && extracted=true
        fi
        if ! $extracted; then
            # dpkg-deb -x 在部分宿主因 uid 映射 chown 失败：--fsys-tarfile | tar --no-same-owner
            # 等价解法（tar 自动识别 gzip/zstd；实测 v1.1.48 deb=data.tar.zst 可解）
            if command -v dpkg-deb >/dev/null 2>&1 \
                && dpkg-deb --fsys-tarfile "$artifact" 2>/dev/null | tar x --no-same-owner -C "$work/deb" 2>/dev/null; then
                extracted=true
            elif ( cd "$work" && mkdir -p debraw deb && ar x "$artifact" >/dev/null 2>&1 \
                && tar xf "debraw"/data.tar.* -C deb --no-same-owner 2>/dev/null ); then
                extracted=true
            fi
        fi
        if ! $extracted; then
            fail "[$label] deb 解包失败（dpkg-deb 与 ar+tar 双通道都失败）—— fail-closed"
        else
            local want_svc want_dll src_svc src_dll
            want_svc=$(load_expected "src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe"); src_svc=$(expected_source_label "src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe")
            want_dll=$(load_expected "src-tauri/resources/HuanvaeGuard/wintun.dll"); src_dll=$(expected_source_label "src-tauri/resources/HuanvaeGuard/wintun.dll")
            assert_item "$work/deb" "usr/lib/Huanvae-Chat-App/HuanvaeGuard/huanvaeguard-svc.exe" "$want_svc" "$src_svc" "huanvaeguard-svc.exe" "deb"
            assert_item "$work/deb" "usr/lib/Huanvae-Chat-App/HuanvaeGuard/wintun.dll" "$want_dll" "$src_dll" "wintun.dll" "deb"
            if version_ge "$TARGET_VERSION" "$DAEMON_SINCE"; then
                local want_daemon="" src_daemon="无来源"
                local repo_daemon="$SRC_TAURI/binaries/hv-control-daemon-x86_64-unknown-linux-gnu"
                [[ -s "$repo_daemon" ]] && { want_daemon=$(sha_of "$repo_daemon"); src_daemon="仓内落点(${repo_daemon#$PROJECT_ROOT/})"; }
                local hit_pkg
                hit_pkg=$(find "$work/deb" -name 'hv-control-daemon*' -type f -size +0c 2>/dev/null | head -1)
                if [[ -z "$hit_pkg" ]]; then
                    fail "[deb] hv-control-daemon 缺失（随 $DAEMON_SINCE 起必含）"
                    DIFF_LINES+=("  期望存在: usr/lib/**/hv-control-daemon*  实际: 无")
                elif [[ -n "$want_daemon" ]]; then
                    local got; got=$(sha_of "$hit_pkg")
                    [[ "$got" == "$want_daemon" ]] \
                        && pass "[deb] hv-control-daemon 字节核对一致 (${got:0:8}… ← $src_daemon)" \
                        || { fail "[deb] hv-control-daemon 哈希不符"
                             DIFF_LINES+=("  文件: ${hit_pkg#$work/deb/}"); DIFF_LINES+=("    期望($src_daemon): $want_daemon"); DIFF_LINES+=("    实际              : $got"); }
                else
                    pass "[deb] hv-control-daemon 在包内且非空（无仓内对照期望）"
                fi
            fi
        fi
        ;;
      appimage)
        local target="$work/$(basename "$artifact")"
        cp "$artifact" "$target" && chmod u+x "$target"
        if (cd "$work" && "$target" --appimage-extract >/dev/null 2>&1); then
            local want_svc want_dll src_svc src_dll
            want_svc=$(load_expected "src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe"); src_svc=$(expected_source_label "src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe")
            want_dll=$(load_expected "src-tauri/resources/HuanvaeGuard/wintun.dll"); src_dll=$(expected_source_label "src-tauri/resources/HuanvaeGuard/wintun.dll")
            assert_item "$work/squashfs-root" "usr/lib/Huanvae-Chat-App/HuanvaeGuard/huanvaeguard-svc.exe" "$want_svc" "$src_svc" "huanvaeguard-svc.exe" "AppImage"
            assert_item "$work/squashfs-root" "usr/lib/Huanvae-Chat-App/HuanvaeGuard/wintun.dll" "$want_dll" "$src_dll" "wintun.dll" "AppImage"
        else
            fail "[$label] --appimage-extract 失败 —— fail-closed"
        fi
        ;;
      targz)  # macOS .app.tar.gz（updater 产物，字节同 DMG 内容且解包可靠）
        if tar xzf "$artifact" -C "$work" --no-same-owner 2>/dev/null; then
            local want_mac want_plist src_mac src_plist
            want_mac=$(load_expected "src-tauri/resources/HuanvaeGuard-macos/hg-macos"); src_mac=$(expected_source_label "src-tauri/resources/HuanvaeGuard-macos/hg-macos")
            want_plist=$(load_expected "src-tauri/resources/HuanvaeGuard-macos/com.huanvaeguard.daemon.plist"); src_plist=$(expected_source_label "src-tauri/resources/HuanvaeGuard-macos/com.huanvaeguard.daemon.plist")
            assert_item "$work" "*.app/Contents/Resources/HuanvaeGuard-macos/hg-macos" "$want_mac" "$src_mac" "HuanvaeGuard-macos/hg-macos" "macOS(.app)"
            assert_item "$work" "*.app/Contents/Resources/HuanvaeGuard-macos/com.huanvaeguard.daemon.plist" "$want_plist" "$src_plist" "com.huanvaeguard.daemon.plist" "macOS(.app)"
        else
            fail "[$label] tar 解包失败 —— fail-closed"
        fi
        ;;
      dmg)  # 7z 对 HFS/APFS 支持参差：解不开如实 WARN（与 v1 口径一致，.app.tar.gz 才是 macOS 的可靠核对对象）
        if command -v 7z >/dev/null 2>&1 && 7z x -y -o"$work/dmg" "$artifact" >/dev/null 2>&1 \
            && find "$work/dmg" -name "*.app" -type d 2>/dev/null | grep -q .; then
            local app_root want_mac src_mac
            app_root=$(find "$work/dmg" -name "*.app" -type d 2>/dev/null | head -1)
            want_mac=$(load_expected "src-tauri/resources/HuanvaeGuard-macos/hg-macos"); src_mac=$(expected_source_label "src-tauri/resources/HuanvaeGuard-macos/hg-macos")
            assert_item "$app_root" "Contents/Resources/HuanvaeGuard-macos/hg-macos" "$want_mac" "$src_mac" "HuanvaeGuard-macos/hg-macos" "DMG"
            assert_item "$app_root" "Contents/Resources/HuanvaeGuard-macos/com.huanvaeguard.daemon.plist" "$(load_expected "src-tauri/resources/HuanvaeGuard-macos/com.huanvaeguard.daemon.plist")" "$(expected_source_label "src-tauri/resources/HuanvaeGuard-macos/com.huanvaeguard.daemon.plist")" "com.huanvaeguard.daemon.plist" "DMG"
        else
            warn "[DMG $label] 本机解包器无法解此 DMG（如可解一并口径；此件未被产物腿核验——用同名 .app.tar.gz 核对）"
        fi
        ;;
      apk)
        if ! command -v unzip >/dev/null 2>&1; then
            fail "[$label] 本机无 unzip —— fail-closed"
        else
            local abi missing=0
            for abi in $GUARD_ABIS; do
                local line
                line=$(unzip -l "$artifact" 2>/dev/null | grep -E "lib/$abi/libhg_android\.so")
                if [[ -n "$line" ]]; then
                    local size; size=$(awk '{print $1}' <<<"$line")
                    local want; want=$(extra_expect_get "lib/$abi/libhg_android.so")
                    if [[ -n "$want" ]]; then
                        local got; got=$(cd "$work" && unzip -o -q "$artifact" "lib/$abi/libhg_android.so" && sha_of "lib/$abi/libhg_android.so")
                        [[ "$got" == "$want" ]] \
                            && pass "[APK] lib/$abi/libhg_android.so 字节核对一致 (${got:0:8}… ← --expect 补钉)" \
                            || { fail "[APK] lib/$abi/libhg_android.so 哈希不符"
                                 DIFF_LINES+=("  文件: lib/$abi/libhg_android.so"); DIFF_LINES+=("    期望(--expect): $want"); DIFF_LINES+=("    实际          : $got"); }
                    else
                        pass "[APK] lib/$abi/libhg_android.so 在包内（$size 字节；期望来源：无仓内对照——CI 现构建，可用 --expect 补钉哈希）"
                    fi
                else
                    fail "[APK] 必含 sidecar 缺失：lib/$abi/libhg_android.so（ABI 列表口径：$(echo $GUARD_ABIS)）"
                    DIFF_LINES+=("  期望存在: lib/$abi/libhg_android.so  实际: 无")
                    missing=1
                fi
            done
        fi
        ;;
      *)
        fail "[$artifact] 不认识的产物扩展名：.$ext（支持 .exe/.deb/.AppImage/.apk/.dmg/.tar.gz）"
        ;;
    esac
    rm -rf "$work"
}

echo ""
if [[ ${#POSITIONAL[@]} -gt 0 ]]; then
    echo -e "${CYAN}产物腿：显式指定 ${#POSITIONAL[@]} 个产物，逐个解包核对（必含件+期望 SHA256 来源）${NC}"
    for a in "${POSITIONAL[@]}"; do
        if [[ ! -f "$a" ]]; then fail "指定产物不存在: $a"; continue; fi
        lower=$(basename "$a" | tr '[:upper:]' '[:lower:]')
        case "$lower" in
            *.exe) check_artifact "$a" exe ;;
            *.deb) check_artifact "$a" deb ;;
            *.appimage) check_artifact "$a" appimage ;;
            *.apk) check_artifact "$a" apk ;;
            *.dmg) check_artifact "$a" dmg ;;
            *.tar.gz|*.tgz) check_artifact "$a" targz ;;
            *) fail "指定产物扩展名不认识: $a" ;;
        esac
    done
else
    shopt -s nullglob
    NSIS_ALL=("$BUNDLE_DIR"/nsis/*.exe)
    DEB_ALL=("$BUNDLE_DIR"/deb/*.deb)
    APPIMAGE_ALL=("$BUNDLE_DIR"/appimage/*.AppImage)
    APK_ALL=("$BUNDLE_DIR"/apk/*.apk)
    DMG_ALL=("$BUNDLE_DIR"/dmg/*.dmg)
    TARGZ_ALL=("$BUNDLE_DIR"/macos/*.tar.gz "$BUNDLE_DIR"/*.app.tar.gz)
    shopt -u nullglob

    # 🔴 只核对**本次目标版本**的产物：bundle 目录里常沉积历史版本的旧包（本机实测
    #    有 1.1.40~1.1.46 的 deb），不设版本过滤就会拿陈年旧包误伤本次门禁。
    #    版本号从文件名取（Huanvae-Chat-App_<version>_amd64.deb 命名约定）；
    #    文件名不含版本的产物：--target-version 为 0.0.0（未指定）时纳入，否则忽略并登记。
    filter_by_version() {
        local -a in=("$@") out=()
        local f
        for f in "${in[@]}"; do
            if [[ "$TARGET_VERSION" == "0.0.0" ]] || [[ "$(basename "$f")" == *_"$TARGET_VERSION"_* ]]; then
                out+=("$f")
            else
                info "忽略非本版本产物（扫描模式防陈货误伤）: $(basename "$f")" >&2
            fi
        done
        [[ ${#out[@]} -eq 0 ]] || printf '%s\n' "${out[@]}"
    }

    NSIS_ARTIFACTS=($(filter_by_version "${NSIS_ALL[@]}"))
    DEB_ARTIFACTS=($(filter_by_version "${DEB_ALL[@]}"))
    APPIMAGE_ARTIFACTS=($(filter_by_version "${APPIMAGE_ALL[@]}"))
    APK_ARTIFACTS=($(filter_by_version "${APK_ALL[@]}"))
    DMG_ARTIFACTS=($(filter_by_version "${DMG_ALL[@]}"))
    TARGZ_ARTIFACTS=($(filter_by_version "${TARGZ_ALL[@]}"))
    ALL=("${NSIS_ARTIFACTS[@]}" "${DEB_ARTIFACTS[@]}" "${APPIMAGE_ARTIFACTS[@]}" "${APK_ARTIFACTS[@]}" "${DMG_ARTIFACTS[@]}" "${TARGZ_ARTIFACTS[@]}")
    echo ""
    if [[ ${#ALL[@]} -eq 0 ]]; then
        info "本机 $BUNDLE_DIR 下无已构建安装包（本宿主不构建安装包，产物由 CI 构建）——产物腿对象数为 0；静态腿已真跑"
    else
        echo -e "${CYAN}产物腿：发现 ${#ALL[@]} 个本地产物，逐个核对${NC}"
        for a in "${NSIS_ARTIFACTS[@]}"; do check_artifact "$a" exe; done
        for a in "${DEB_ARTIFACTS[@]}"; do check_artifact "$a" deb; done
        for a in "${APPIMAGE_ARTIFACTS[@]}"; do check_artifact "$a" appimage; done
        for a in "${APK_ARTIFACTS[@]}"; do check_artifact "$a" apk; done
        for a in "${DMG_ARTIFACTS[@]}"; do check_artifact "$a" dmg; done
        for a in "${TARGZ_ARTIFACTS[@]}"; do check_artifact "$a" targz; done
    fi
fi

# ---------- 汇总 ----------
echo ""
if [[ "$FAILED" -ne 0 ]]; then
    echo -e "${RED}产物内容清单断言 v2：FAIL（差异明细 ${#DIFF_LINES[@]} 行）${NC}"
    printf '  %s\n' "${DIFF_LINES[@]}"
    exit 1
fi
echo -e "${GREEN}产物内容清单断言 v2：PASS（产物腿核验对象数：$CHECKED_ARTIFACTS；期望来源：发货落点 manifest/仓内落点逐字节）${NC}"
exit 0
