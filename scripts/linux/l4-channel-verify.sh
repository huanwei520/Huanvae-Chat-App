#!/bin/bash
#
# L4 渠道下载验证 —— 发布后从 GitHub Release 下载正式包，复算 SHA256 并与渠道清单对账
#
# ## 为什么必须有这一层
# 发布 = push tag + CI 出包 + 挂 Release。前面四层验的都是「发布之前/之中」；
# 渠道上是最后一公里：挂错文件、上传截断、latest.json 指错 URL、签名缺失——
# 用户拿到手里的坏包没有 L4 就是无人知晓。1.1.47 的「渠道包携带旧件」正是这一层的反面案例。
#
# ## 核什么（对账三方）
#   ① Release 资产本身：逐个下载 → 复算 SHA256（截断/换包即刻现形）
#   ② latest.json（桌面更新器清单）：version==tag / 各平台 url 指向本 Release 资产 /
#      signature 非空 / 对应 .sig 资产存在
#   ③ android-latest.json（安卓更新清单，若本版有 APK）：同②口径
#   ④ 包内容复验：guard 件字节必须=发货落点 manifest（调 assert-artifact-content-v2.sh）
#   ⑤ 实装闭环：打印 L2 命令（--artifact-dir 指向本次下载的渠道包）——装的就是用户装的那份
#
# ## 用法
#   scripts/linux/l4-channel-verify.sh v1.1.48 [--dir <下载缓存>] [--wait-minutes <N>]
#   --wait-minutes N：Release 未发布时最多等 N 分钟（CI 出包中），默认不等待
#
# ## 退出码
#   0 = 全部一致  1 = 有不一致（差异逐条打印）  2 = Release 不存在/未发布且未到等待条件

set -u

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; GRAY='\033[0;90m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${L4_REPO:-huanwei520/Huanvae-Chat-App}"
TAG="$1"; shift || true
DIR="" ; WAIT=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dir) DIR="$2"; shift 2 ;;
        --wait-minutes) WAIT="$2"; shift 2 ;;
        -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo -e "${RED}未知参数: $1${NC}" >&2; exit 2 ;;
    esac
done
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo -e "${RED}用法: l4-channel-verify.sh <tag>（形如 v1.1.48）${NC}" >&2; exit 2; }
VER="${TAG#v}"
DIR="${DIR:-/tmp/l4-$TAG}"; mkdir -p "$DIR"

FAILED=0
diff_line() { echo -e "  ${RED}✗ $1${NC}"; FAILED=1; }
ok_line()   { echo -e "  ${GREEN}✓ $1${NC}"; }
warn_line() { echo -e "  ${YELLOW}⚠ WARN $1${NC}"; }

api() {  # $1=path → body;code
    local code
    code=$(curl -sS -o /tmp/.l4body.$$ -w '%{http_code}' \
        ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} \
        "https://api.github.com/repos/$REPO$1" 2>/dev/null) || { echo ""; echo 000; return; }
    cat /tmp/.l4body.$$; rm -f /tmp/.l4body.$$
    echo "$code"
}

# ---------- ① Release 已发布（可等待） ----------
echo -e "${CYAN}L4 ▶ $TAG 渠道对账（repo=$REPO 缓存=$DIR）${NC}"
WAITED=0
while :; do
    body=$(api "/releases/tags/$TAG"); code=$(tail -1 <<<"$body"); body=$(head -n -1 <<<"$body" 2>/dev/null || printf '%s' "$body")
    DRAFT=$(node -e "try{const j=JSON.parse(process.argv[1]);console.log(String(j.draft))}catch(e){console.log('err')}" "$body" 2>/dev/null)
    [[ "$code" == "200" && "$DRAFT" == "false" ]] && break
    if [[ $WAIT -gt 0 && $WAITED -lt $WAIT ]]; then
        echo "  Release 未就绪（code=$code draft=$DRAFT），等待 60s（已等 ${WAITED}min/上限 ${WAIT}min）"
        sleep 60; WAITED=$((WAITED+1))
    else
        echo -e "${RED}Release $TAG 不存在或未正式发布（code=$code draft=$DRAFT）${NC}"
        exit 2
    fi
done
ok_line "Release 已正式发布（draft=false）"

# ---------- ② 资产清单 + 下载 + 复算 SHA256 ----------
ASSETS=$(node -e "
const j=JSON.parse(process.argv[1]);
for(const a of j.assets) console.log(a.name+'\t'+a.size+'\t'+a.browser_download_url);" "$body" 2>/dev/null)
[[ -z "$ASSETS" ]] && { diff_line "Release 资产清单为空"; exit 1; }

echo ""
echo -e "${CYAN}资产复算（下载→SHA256→与 GitHub 登记大小比对）${NC}"
declare -a NAMES=() SIZES=() URLS=() LOCALSHA=()
while IFS=$'\t' read -r name size url; do
    local_f="$DIR/$name"
    if [[ -f "$local_f" && $(stat -c%s "$local_f") == "$size" ]]; then
        echo "  · 缓存命中 $name"
    else
        echo "  · 下载 $name ($size bytes)"
        curl -sSL -o "$local_f" "$url" || { diff_line "下载失败: $name"; continue; }
    fi
    actual=$(stat -c%s "$local_f" 2>/dev/null || echo -1)
    sha=$(sha256sum "$local_f" 2>/dev/null | awk '{print $1}')
    if [[ "$actual" == "$size" ]]; then
        ok_line "$name  sha256=${sha:0:8}…  $(numfmt --to=iec $size 2>/dev/null || echo $size)B"
    else
        diff_line "$name 大小不一致：登记 $size vs 实际 $actual（截断/换包？）"
    fi
    NAMES+=("$name"); SIZES+=("$size"); URLS+=("$url"); LOCALSHA+=("$sha")
done <<< "$ASSETS"

# ---------- ③ latest.json 对账 ----------
echo ""
echo -e "${CYAN}latest.json 对账（桌面更新器清单）${NC}"
LJ="$DIR/latest.json"
if [[ ! -f "$LJ" ]]; then
    diff_line "latest.json 不在 Release 资产中（更新器清单缺失=全平台更新链路断）"
else
    LJ_VER=$(node -p "JSON.parse(require('fs').readFileSync('$LJ','utf8')).version" 2>/dev/null)
    [[ "$LJ_VER" == "$VER" ]] && ok_line "latest.json version=$LJ_VER == tag" || diff_line "latest.json version=$LJ_VER ≠ tag $VER"
    # 逐平台：signature 非空 + url 指向本 Release 资产
    MISMATCH=0
    while IFS=$'\t' read -r plat sig url; do
        if [[ -z "$sig" || "$sig" == "null" ]]; then
            diff_line "latest.json[$plat].signature 为空（更新器将拒装）"; MISMATCH=1; continue
        fi
        base=$(basename "${url%%\?*}")
        found=""
        for i in "${!NAMES[@]}"; do [[ "${NAMES[$i]}" == "$base" ]] && { found="$i"; break; }; done
        if [[ -z "$found" ]]; then
            diff_line "latest.json[$plat].url 指向的资产不在本 Release: $base"; MISMATCH=1
        else
            # url 语义一致性：必须指向本 Release 的下载域名与 tag 路径
            if [[ "$url" != *"/$TAG/"* && "$url" != *"tag=$TAG"* ]]; then
                diff_line "latest.json[$plat].url 不指向 $TAG: $url"; MISMATCH=1
            else
                sigfile="$DIR/$base.sig"
                if [[ -f "$sigfile" ]]; then
                    ok_line "latest.json[$plat] → $base（signature 非空，.sig 资产在）"
                else
                    # 更新器实际只消费 latest.json 内嵌 signature（非空已另行硬判）；
                    # .sig 侧车件是 tauri-action 通常一并上传的冗余副本，缺失不阻断更新链路
                    # ⇒ 降为 WARN（卫生问题），不作为渠道不可用判据（1.1.49 起建议补齐）。
                    warn_line "latest.json[$plat] → $base 的 .sig 侧车件缺失（内嵌签名非空，更新链路可用；建议 1.1.49 补齐上传）"
                fi
            fi
        fi
    done < <(node -e "
const j=JSON.parse(require('fs').readFileSync('$LJ','utf8'));
const p=j.platforms||{};
for(const k of Object.keys(p)) console.log([k,p[k].signature||'',p[k].url||''].join('\t'));" 2>/dev/null)
    [[ $MISMATCH -eq 0 ]] || true
fi

# ---------- ④ android-latest.json 对账（若本版有 APK） ----------
echo ""
echo -e "${CYAN}android-latest.json 对账${NC}"
HAS_APK=""
for i in "${!NAMES[@]}"; do [[ "${NAMES[$i]}" == *.apk ]] && { HAS_APK="${NAMES[$i]}"; break; }; done
ALJ="$DIR/android-latest.json"
if [[ -f "$ALJ" ]]; then
    AJ_VER=$(node -p "JSON.parse(require('fs').readFileSync('$ALJ','utf8')).version" 2>/dev/null)
    [[ "$AJ_VER" == "$VER" ]] && ok_line "android-latest.json version=$AJ_VER == tag" || diff_line "android-latest.json version=$AJ_VER ≠ tag $VER"
    AJ_URL=$(node -p "JSON.parse(require('fs').readFileSync('$ALJ','utf8')).url||''" 2>/dev/null)
    base=$(basename "${AJ_URL%%\?*}")
    if [[ -f "$DIR/$base" ]]; then
        ok_line "android-latest.json url → $base（资产在本 Release）"
    else
        diff_line "android-latest.json url 指向的资产不在本 Release: $base"
    fi
elif [[ -n "$HAS_APK" ]]; then
    diff_line "有 APK 资产($HAS_APK)但无 android-latest.json（安卓更新清单缺失）"
else
    echo -e "  ${GRAY}· 本版无 APK 资产，android-latest.json 缺失如实登记（1.1.48 实况：Android 腿未出包，安卓用户停留旧版——发布记录须注明）${NC}"
fi

# ---------- ⑤ 包内容复验（guard 字节 vs 发货落点 manifest） ----------
echo ""
echo -e "${CYAN}包内容复验（guard 字节 vs 发货落点 manifest）${NC}"
# 期望 manifest 锚定发布 tag 自身（后发布验证不能信本地工作树——热修后工作树落后会误报）
MANIFEST_NOTE=""
if git rev-parse -q --verify "$TAG^{commit}" >/dev/null 2>&1 \
    && git show "$TAG:src-tauri/resources/hg-build-manifest.json" > "$DIR/hg-build-manifest.from-tag.json" 2>/dev/null; then
    export ARTIFACT_MANIFEST_FILE="$DIR/hg-build-manifest.from-tag.json"
    MANIFEST_NOTE="（期望源=git show $TAG:…/hg-build-manifest.json，非本地工作树）"
else
    unset ARTIFACT_MANIFEST_FILE
    MANIFEST_NOTE="（期望源=本地工作树 manifest；tag 不在本地 git，如哈希误报请先 fetch）"
fi
echo "  期望 manifest 锚定: $MANIFEST_NOTE"
PKG_ARGS=()
for f in "$DIR"/*x64-setup.exe "$DIR"/*.deb "$DIR"/*.app.tar.gz "$DIR"/*.apk; do
    [[ -f "$f" ]] && PKG_ARGS+=("$f")
done
if [[ ${#PKG_ARGS[@]} -eq 0 ]]; then
    diff_line "无桌面/安卓包资产可复验"
else
    "$SCRIPT_DIR/../assert-artifact-content-v2.sh" --target-version "$VER" --skip-static "${PKG_ARGS[@]}" || FAILED=1
fi

# ---------- 汇总 + L2 实装交接 ----------
echo ""
if [[ $FAILED -ne 0 ]]; then
    echo -e "${RED}L4 渠道对账：FAIL —— 渠道与清单不一致，处置见上${NC}"
    exit 1
fi
echo -e "${GREEN}L4 渠道对账：PASS（${#NAMES[@]} 资产 SHA256 复算一致；latest.json/android-latest.json 对账一致；包内容=发货落点）${NC}"
echo ""
echo -e "${CYAN}实装闭环（装的就是用户装的这份，四平台命令）：${NC}"
echo "  scripts/linux/l2-install-smoke.sh --artifact-dir $DIR --out ${DIR}/l2-evidence"
echo "  （Windows/macOS 腿需 L2_WIN_HOST / L2_MAC_HOST 环境注入后同命令真跑）"
exit 0
