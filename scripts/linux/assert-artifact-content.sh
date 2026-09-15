#!/bin/bash
#
# 产物内容清单断言 —— HuanvaeGuard 组件必须真的进安装包
#
# ## 它根治哪一类缺陷
#
# v1.1.46 及之前（06e52282），tauri.windows/macos.conf.json 的 bundle.resources 映射连同
# externalBin 置空一起被删掉，Windows 安装包从此不含 HuanvaeGuard/huanvaeguard-svc.exe 与
# wintun.dll。后果链：安装器 sc create 成功（注册不校验文件存在）→ sc start 恒返回 2
# （系统找不到文件）→ App 内「修复服务」同样失败。而既有门禁只查脚本与配置文本、
# 从不解开产物看内容，于是带病发版。本脚本堵上"产物内容"这个盲区。
#
# ## 三条腿
#
#   [静态腿·恒跑] 结构化解析 tauri.conf.json + tauri.<platform>.conf.json 的 bundle.resources
#       并集，断言 Guard 映射齐全。合并语义依据：tauri-cli 2.11.1 src/helpers/config.rs:6
#       `use json_patch::merge`（RFC 7396 JSON Merge Patch —— 对象递归深合并、数组整体覆盖），
#       因此平台 conf 的 resources 映射与基础 conf 的映射取并集，externalBin 空数组整体覆盖。
#       映射被删 / 源文件丢失 / 变空文件 → 本腿红（这正是负向验证的抓手）。
#   [产物腿·有产物才跑] 对产物逐个解包核对必含文件。缺任一必含文件 → FAIL（退出码 1）。
#   [无产物] 本宿主不构建安装包（产物由 CI 构建）时，产物腿对象数为 0：如实打印说明，
#       不虚构通过也不谎报失败；静态腿仍然真跑。产物腿的真实 exercised 见
#       scripts/linux/README.md「产物内容断言」一节（对已发布产物包手工执行本脚本）。
#
# ## 用法
#
#   scripts/linux/assert-artifact-content.sh                    # 静态腿 + 扫描本机 bundle 目录
#   scripts/linux/assert-artifact-content.sh <产物文件>...      # 静态腿 + 显式指定产物
#                                                               # （.exe(NSIS)/.deb/.AppImage/.apk/.dmg）
#
#   BUNDLE_DIR 目录覆盖默认扫描根（默认 src-tauri/target/release/bundle）。
#
# ## 退出码
#   0 = 通过（静态腿通过；产物腿若有产物则全部核对通过）
#   1 = 有断言失败（映射缺失 / 源文件缺失 / 产物缺必含文件 / NSIS 产物无法解包核验）
#
# ## 必含文件口径（与 hooks.nsi / huanvaeguard.rs / huanvaeguard_macos.rs 的运行时查找路径对应）
#   Windows NSIS：HuanvaeGuard/huanvaeguard-svc.exe + HuanvaeGuard/wintun.dll
#                 （hooks.nsi:182 `sc create ... binPath= "$INSTDIR\HuanvaeGuard\huanvaeguard-svc.exe"`）
#   Linux deb/AppImage：同上两个文件（bundle.resources 基础映射随包；Linux 暂无 guard 守护，
#                 携带 Windows 件属无害冗余，本脚本按"映射了就必须在包里"的口径核对）
#   macOS DMG/.app：HuanvaeGuard-macos/hg-macos（huanvaeguard_macos.rs:72 RESOURCE_SUBDIR）
#   Android APK：lib/<abi>/libhg_android.so（Kotlin 桥 System.loadLibrary 装载）
#   全部桌面安装包：Notification-Sounds/ 至少 1 个文件（既有映射不得在平台合并中静默丢失）
#
# 本脚本被 scripts/linux/test-all.sh 第 14 步调用；也可独立对已发布产物执行。

set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC_TAURI="$PROJECT_ROOT/src-tauri"
BUNDLE_DIR="${BUNDLE_DIR:-$SRC_TAURI/target/release/bundle}"

FAILED=0
CHECKED_ARTIFACTS=0

fail() { echo -e "  ${RED}✗ FAIL: $1${NC}"; FAILED=1; }
pass() { echo -e "  ${GREEN}✓ $1${NC}"; }
warn() { echo -e "  ${YELLOW}⚠ $1${NC}"; }

# ============================================
# [静态腿] 映射并集 + 源文件在仓
# ============================================
echo -e "${CYAN}静态腿：bundle.resources 映射并集 + Guard 源文件在仓${NC}"

STATIC_JSON=$(node -e "
const fs = require('fs');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const base = read('$SRC_TAURI/tauri.conf.json');
const win = read('$SRC_TAURI/tauri.windows.conf.json');
const mac = read('$SRC_TAURI/tauri.macos.conf.json');
// RFC 7396（tauri-cli 2.11.1 json_patch::merge 同语义）：对象递归深合并
const merge = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object'
      || a === null || b === null) return b === undefined ? a : b;
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = merge(a[k], b[k]);
  return out;
};
const resAll = {
  desktop: merge(base.bundle?.resources ?? {}, win.bundle?.resources ?? {}),
  macos: merge(base.bundle?.resources ?? {}, mac.bundle?.resources ?? {}),
};
console.log(JSON.stringify(resAll));
") || { fail "解析 tauri*.conf.json 失败（JSON 非法？）"; }

if [[ -n "$STATIC_JSON" ]]; then
  STATIC_RC=0
  node -e "
const fs = require('fs');
const { desktop, macos } = JSON.parse(process.argv[1]);
const entries = (m) => Object.entries(m ?? {});
const die = (msg) => { console.error(msg); process.exit(1); };

// ① Windows/通用腿：HuanvaeGuard 映射必须在（基础或 windows 平台 conf 任一处，并集后判定）
const guardWin = entries(desktop).filter(([k, v]) => /HuanvaeGuard\/\*$/.test(k) && v === 'HuanvaeGuard/');
if (guardWin.length !== 1) die(\"bundle.resources 并集中 HuanvaeGuard 映射缺失或不唯一：\" + JSON.stringify(guardWin));

// ② macOS 腿：HuanvaeGuard-macos 映射必须在
const guardMac = entries(macos).filter(([k, v]) => /HuanvaeGuard-macos\/\*$/.test(k) && v === 'HuanvaeGuard-macos/');
if (guardMac.length !== 1) die(\"bundle.resources 并集中 HuanvaeGuard-macos 映射缺失或不唯一：\" + JSON.stringify(guardMac));

// ③ 既有 Notification-Sounds 映射不得静默丢失（桌面与 macOS 两条并集都要有）
for (const [label, m] of [['desktop', desktop], ['macos', macos]]) {
  const ns = entries(m).filter(([k, v]) => /Notification-Sounds\/\*$/.test(k) && v === 'Notification-Sounds/');
  if (ns.length !== 1) die(label + ' 并集中 Notification-Sounds 映射缺失或不唯一（平台合并会把它丢掉）');
}
console.log('MAP_OK');
" "$STATIC_JSON" || STATIC_RC=$?

  if [[ "$STATIC_RC" -eq 0 ]]; then
    pass "bundle.resources 映射齐全：HuanvaeGuard（桌面/Windows）+ HuanvaeGuard-macos（macOS）+ 既有 Notification-Sounds"
  else
    fail "bundle.resources 映射断言失败（见上）"
  fi
fi

# 源文件在仓且非空（空文件 = 构建占位损坏，进包也是坏的）
for f in \
  "resources/HuanvaeGuard/huanvaeguard-svc.exe" \
  "resources/HuanvaeGuard/wintun.dll" \
  "resources/HuanvaeGuard-macos/hg-macos"; do
  if [[ -s "$SRC_TAURI/$f" ]]; then
    pass "源文件在仓且非空：src-tauri/$f ($(stat -c%s "$SRC_TAURI/$f" 2>/dev/null || stat -f%z "$SRC_TAURI/$f") 字节)"
  else
    fail "源文件缺失或为空：src-tauri/$f"
  fi
done

# ============================================
# [产物腿] 解包核对必含文件
# ============================================

# 在解包树里核对必含文件（find 按路径模式，不假设安装根前缀——deb 是 usr/lib/<product>/，NSIS 是根）
# $1=解包树  $2=产物标签
assert_tree() {
  local tree="$1" label="$2" f
  for f in "HuanvaeGuard/huanvaeguard-svc.exe" "HuanvaeGuard/wintun.dll"; do
    if find "$tree" -path "*/$f" -type f -size +0c 2>/dev/null | grep -q .; then
      pass "[$label] 必含文件在包内：$f"
    else
      fail "[$label] 必含文件不在包内：$f —— 安装后 sc start 必失败（本脚本能拦住的那类事故）"
    fi
  done
  if find "$tree" -path "*Notification-Sounds/*" -type f 2>/dev/null | grep -q .; then
    pass "[$label] Notification-Sounds 资源在包内（既有映射未在合并中丢失）"
  else
    fail "[$label] Notification-Sounds 资源不在包内（平台 conf 覆盖把基础映射弄丢了？）"
  fi
}

# $1=产物路径 $2=扩展名（小写）
check_artifact() {
  local artifact="$1" ext="$2"
  local work rc
  work=$(mktemp -d) || { fail "[$artifact] 无法创建临时目录"; return; }
  CHECKED_ARTIFACTS=$((CHECKED_ARTIFACTS + 1))
  case "$ext" in
    exe)  # Tauri NSIS 安装器
      if ! command -v 7z >/dev/null 2>&1; then
        fail "[$artifact] 找到 NSIS 产物但本机无 7z（p7zip），无法核验内容 —— fail-closed，请安装 p7zip 后重跑"
      elif 7z x -y -o"$work/nsis" "$artifact" >/dev/null 2>&1; then
        assert_tree "$work/nsis" "NSIS $(basename "$artifact")"
      else
        fail "[$artifact] 7z 解包失败（不是可解的 NSIS 产物？）—— fail-closed"
      fi
      ;;
    deb)
      if command -v dpkg-deb >/dev/null 2>&1; then
        if dpkg-deb -x "$artifact" "$work/deb" 2>/dev/null; then
          assert_tree "$work/deb" "deb $(basename "$artifact")"
        else
          fail "[$artifact] dpkg-deb 解包失败"
        fi
      else
        fail "[$artifact] 本机无 dpkg-deb，无法核验 deb 内容 —— fail-closed"
      fi
      ;;
    appimage)
      local target="$work/$(basename "$artifact")"
      cp "$artifact" "$target" && chmod u+x "$target"
      if (cd "$work" && "$target" --appimage-extract >/dev/null 2>&1); then
        assert_tree "$work/squashfs-root" "AppImage $(basename "$artifact")"
      else
        fail "[$artifact] --appimage-extract 失败（不是可解的 AppImage？）"
      fi
      ;;
    apk)  # Android：guard 数据面 libhg_android.so 按 ABI 进包（Kotlin 桥装载）
      if command -v unzip >/dev/null 2>&1; then
        if unzip -l "$artifact" 2>/dev/null | grep -qE "lib/[^/]+/libhg_android\.so"; then
          pass "[APK $(basename "$artifact")] 必含文件在包内：lib/<abi>/libhg_android.so"
        else
          fail "[APK $(basename "$artifact")] 必含文件不在包内：lib/<abi>/libhg_android.so"
        fi
      else
        fail "[$artifact] 本机无 unzip，无法核验 APK 内容 —— fail-closed"
      fi
      ;;
    dmg)  # DMG 解包依赖 7z 对具体 HFS/APFS 布局的支持，属"如可解一并"：解不开如实 WARN，不强判
      if command -v 7z >/dev/null 2>&1 \
          && 7z x -y -o"$work/dmg" "$artifact" >/dev/null 2>&1 \
          && find "$work/dmg" -name "*.app" -type d 2>/dev/null | grep -q .; then
        local app_root
        app_root=$(find "$work/dmg" -name "*.app" -type d 2>/dev/null | head -1)
        if find "$app_root" -path "*HuanvaeGuard-macos/hg-macos" -type f -size +0c 2>/dev/null | grep -q .; then
          pass "[DMG $(basename "$artifact")] 必含文件在包内：HuanvaeGuard-macos/hg-macos"
        else
          fail "[DMG $(basename "$artifact")] 必含文件不在包内：Contents/Resources/HuanvaeGuard-macos/hg-macos"
        fi
      else
        warn "[DMG $(basename "$artifact")] 本机解包器无法解此 DMG（如可解一并口径：不判 FAIL，但此件未被本腿核验）"
      fi
      ;;
    *)
      fail "[$artifact] 不认识的产物扩展名：.$ext（支持 .exe/.deb/.AppImage/.apk/.dmg）"
      ;;
  esac
  rm -rf "$work"
}

# CLI 显式指定的产物优先
if [[ $# -gt 0 ]]; then
  echo ""
  echo -e "${CYAN}产物腿：显式指定了 $# 个产物${NC}"
  for a in "$@"; do
    if [[ ! -f "$a" ]]; then
      fail "指定产物不存在：$a"
      continue
    fi
    lower=$(basename "$a" | tr '[:upper:]' '[:lower:]')
    case "$lower" in
      *.exe) check_artifact "$a" exe ;;
      *.deb) check_artifact "$a" deb ;;
      *.appimage) check_artifact "$a" appimage ;;
      *.apk) check_artifact "$a" apk ;;
      *.dmg) check_artifact "$a" dmg ;;
      *) fail "指定产物扩展名不认识：$a" ;;
    esac
  done
else
  # 扫描本机 bundle 目录（本宿主通常不构建安装包：对象数为 0 时如实说明）
  shopt -s nullglob
  NSIS_ARTIFACTS=("$BUNDLE_DIR"/nsis/*.exe "$BUNDLE_DIR"/nsis/*-setup.exe)
  DEB_ARTIFACTS=("$BUNDLE_DIR"/deb/*.deb)
  APPIMAGE_ARTIFACTS=("$BUNDLE_DIR"/appimage/*.AppImage)
  APK_ARTIFACTS=("$BUNDLE_DIR"/apk/*.apk)
  DMG_ARTIFACTS=("$BUNDLE_DIR"/dmg/*.dmg)
  shopt -u nullglob

  ALL_ARTIFACTS=("${NSIS_ARTIFACTS[@]}" "${DEB_ARTIFACTS[@]}" "${APPIMAGE_ARTIFACTS[@]}" "${APK_ARTIFACTS[@]}" "${DMG_ARTIFACTS[@]}")

  echo ""
  if [[ ${#ALL_ARTIFACTS[@]} -eq 0 ]]; then
    echo -e "${CYAN}产物腿：本机 $BUNDLE_DIR 下无已构建安装包产物（本宿主不构建安装包，产物由 CI 构建并在分发侧复验）${NC}"
    echo -e "${CYAN}        —— 静态腿已真跑；产物腿对象数为 0。对已发布产物核验：$0 <产物文件>${NC}"
  else
    echo -e "${CYAN}产物腿：发现 ${#ALL_ARTIFACTS[@]} 个本地产物，逐个解包核对${NC}"
    for a in "${NSIS_ARTIFACTS[@]}"; do check_artifact "$a" exe; done
    for a in "${DEB_ARTIFACTS[@]}"; do check_artifact "$a" deb; done
    for a in "${APPIMAGE_ARTIFACTS[@]}"; do check_artifact "$a" appimage; done
    for a in "${APK_ARTIFACTS[@]}"; do check_artifact "$a" apk; done
    for a in "${DMG_ARTIFACTS[@]}"; do check_artifact "$a" dmg; done
  fi
fi

# ============================================
# 汇总
# ============================================
echo ""
if [[ "$FAILED" -ne 0 ]]; then
  echo -e "${RED}产物内容清单断言：FAIL${NC}"
  exit 1
fi
echo -e "${GREEN}产物内容清单断言：PASS（产物腿核验对象数：${CHECKED_ARTIFACTS}）${NC}"
exit 0
