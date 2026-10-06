#!/bin/bash
#
# build-hv-control-binaries.sh —— hv-control-daemon 标准构建脚本（canonical builder）
#
# ## 背景（xfu0nh5q-1 第2轮整改：让 binaries/README.md 的声称成真）
#   此前 README 声称本脚本存在但仓内从未落地，daemon 件实际由各块异构宿主
#   ad-hoc 手工构建拷入，导致错误构建混入 Windows 分发包（DEFECT-3）。
#   本脚本把已验证的重建流程固化为唯一入口：
#     源锚核验 → 补丁应用(可跳) → 目标构建 → (macOS)adhoc 重签 →
#     产物哈希/标记复核 → 防错闸 → manifest 回填指引。
#
# ## 用法
#   scripts/build-hv-control-binaries.sh --src <HuanvaeRemote 检出根> \
#        [--target x86_64-pc-windows-msvc|aarch64-apple-darwin|<rust 三元组>] \
#        [--patch <patch 文件>]        # 默认 src-tauri/resources/hv-control-daemon.defect3-fix.patch（sha256 419aa4180147…53a2a，随 main 合入在仓）
#        [--no-patch]                  # 不打补丁（构建未修复形态，产出必须人工登记，不得直接入 binaires/）
#        [--out <目录>]                # 产物输出目录（默认 dist-hv-control-daemon/）
#        [--sign]                      # macOS 件 codesign -f -s -（默认开启 when --target *-apple-darwin）
#
# ## 前置（按宿主）
#   - cargo/rustc 于 PATH（版本须与 manifest.rustc 同版，脚本会比对提示）
#   - --target 为交叉目标时需 rustup target 已装 + 对端原生工具链
#     （windows-msvc 须在 Windows 宿主原生构建；linux 宿主交叉 msvc 不受支持——
#      libsodium-sys 选库分支错配，历史判例见 manifest rebuild_2026_10_06 前 notes）
#
# ## 退出码：0 = 产物构建+闸全绿；非 0 = 任一步失败（fail-closed）
#
# @date 2026-10-06  xfu0nh5q-1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$ROOT/src-tauri/resources/hv-control-daemon.manifest.json"
PATCH_DEFAULT="$ROOT/src-tauri/resources/hv-control-daemon.defect3-fix.patch"

SRC="" ; TARGET="" ; PATCH="$PATCH_DEFAULT" ; OUT="" ; NOPATCH=""
usage() { grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --src) SRC="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --patch) PATCH="$2"; shift 2 ;;
    --no-patch) NOPATCH=1; PATCH="" ; shift ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) echo "未知参数: $1"; usage 1 ;;
  esac
done

fail() { echo "[builder] ✗ FAIL: $1" >&2; exit 1; }
info() { echo "[builder] · $1"; }

[[ -n "$SRC" ]] || usage 1
[[ -n "$TARGET" ]] || TARGET="$(rustc -vV 2>/dev/null | awk '/^host:/{print $2}')" || true
[[ -n "$TARGET" ]] || fail "未指定 --target 且无法探测 rustc host"
[[ -d "$SRC/crates/hv-control-demo" ]] || fail "源码根不含 crates/hv-control-demo: $SRC"
command -v cargo >/dev/null 2>&1 || command -v "${HOME}/.cargo/bin/cargo" >/dev/null 2>&1 || fail "cargo 不在 PATH（macOS 固定机注意 ~/.cargo/bin）"
command -v node >/dev/null 2>&1 || fail "node 不在 PATH（防错闸 .mjs 需要）"
OUT="${OUT:-$ROOT/dist-hv-control-daemon}"
mkdir -p "$OUT"

echo "════════ hv-control-daemon 标准构建（target=$TARGET） ════════"

# ---------- 1) 源锚核验（对照 manifest build_anchor） ----------
info "1/6 源锚核验（对照 manifest.build_anchor 四件）"
sha() { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }
anchor_of() { node -e "const j=JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));console.log((j.build_anchor||{})['$1']||'')"; }
check_anchor() { # $1=锚字段名 $2=文件相对路径
  local want got
  want="$(anchor_of "$1")"; [[ -n "$want" ]] || { info "  manifest 无 $1 锚，跳过"; return 0; }
  got="$(sha "$SRC/$2")"
  if [[ "$got" == "$want" ]]; then info "  ✓ $1 = ${got:0:12}…"
  else fail "$1 不符：期望 $want 实际 $got（$SRC/$2）——非锚定源码态，禁止构建分发件"
  fi
}
check_anchor workspace_cargo_toml_sha256 "Cargo.toml"
check_anchor workspace_cargo_lock_sha256 "Cargo.lock"
check_anchor crate_cargo_toml_sha256     "crates/hv-control-demo/Cargo.toml"

# ---------- 2) 补丁 ----------
info "2/6 补丁应用（patch -p0 于源码根）"
if [[ -z "$PATCH" && -z "$NOPATCH" ]]; then
  fail "未显式选择补丁策略：分发件默认用仓内 defect3-fix 补丁（--patch 可覆盖）；--no-patch 产出禁止入 src-tauri/binaries/"
fi
if [[ -z "$PATCH" ]]; then
  info "  --no-patch：跳过（⚠ 未修复形态，产出不得直接入 src-tauri/binaries/）"
else
  [[ -s "$PATCH" ]] || fail "补丁不存在: $PATCH"
  # patch 在 $SRC 子壳内执行，补丁路径须绝对化（相对路径在 cd 后失效）
  case "$PATCH" in /*) ;; *) PATCH="$PWD/${PATCH#./}" ;; esac
  ( cd "$SRC" && patch -p0 --dry-run < "$PATCH" >/dev/null 2>&1 ) || fail "补丁干跑失败（是否已打过？重复应用请改用已含补丁的检出）"
  ( cd "$SRC" && patch -p0 < "$PATCH" )
  sha_src_daemon="$(sha "$SRC/crates/hv-control-demo/src/bin/hv-control-daemon.rs")"
  info "  ✓ 已应用；补丁后 daemon_rs_sha256=$sha_src_daemon（回填 manifest 请记录）"
fi
if [[ -z "$PATCH" ]]; then
  # 未打补丁形态：daemon_rs 必须仍与锚一致（否则非锚定源态，禁出分发件）
  check_anchor daemon_rs_sha256 "crates/hv-control-demo/src/bin/hv-control-daemon.rs"
else
  sha_patched_daemon="$(sha "$SRC/crates/hv-control-demo/src/bin/hv-control-daemon.rs")"
  anchor_daemon="$(anchor_of daemon_rs_sha256)"
  if [[ "$sha_patched_daemon" == "$anchor_daemon" ]]; then
    fail "声称已打补丁但 daemon_rs 仍等于原锚——补丁未生效？"
  fi
  info "  · 补丁后新源锚 daemon_rs_sha256=$sha_patched_daemon（回填 manifest 请记录）"
fi

# ---------- 3) 构建 ----------
info "3/6 cargo build --release -p hv-control-demo --bin hv-control-daemon --target $TARGET"
# 卡面判据（xfu0nh5q-1 F 级修复轮）：分发件 strings 零命中
#   ① crates\hv-control-demo\src\bin\hv-control-daemon.rs（守护进程源码路径串）
#   ② x11rb
# ② 经 hv-demo-x11 依赖 unix 门控（补丁 v2）结构性归零；① 来自 Rust panic
# Location（#[track_caller]/async 机制，非 X11 相关，不可靠删源码消除）——
# 用 rustc 标准机制 --remap-path-prefix 把仓内 crates/ 前缀统一改写为 hvsrc/，
# 判据①同结构性归零。零源码逻辑改动，构建配方在案可复现。
export RUSTFLAGS="--remap-path-prefix=crates=hvsrc"
info "  RUSTFLAGS=$RUSTFLAGS"
( cd "$SRC" && cargo build --release -p hv-control-demo --bin hv-control-daemon --target "$TARGET" ) \
  || fail "cargo build 失败"
BIN="$SRC/target/$TARGET/release/hv-control-daemon"
[[ -f "$BIN" ]] || fail "产物缺失: $BIN"
[[ "$TARGET" == *windows* ]] && BIN="$BIN.exe"
[[ -f "$BIN" ]] || fail "产物缺失(含.exe探测): $BIN"

# ---------- 4) macOS adhoc 重签（判例：linker-signed 形态 launchd 可能拒绝） ----------
if [[ "$TARGET" == *apple-darwin* ]]; then
  info "4/6 codesign -f -s -（adhoc）"
  codesign -f -s - "$BIN" || fail "codesign 失败"
else
  info "4/6 跳过（非 apple-darwin）"
fi

# ---------- 5) 产物复核 + 防错闸 ----------
info "5/6 产物指纹与特征标记"
cp "$BIN" "$OUT/hv-control-daemon-$TARGET"
FINAL="$OUT/hv-control-daemon-$TARGET"
echo "  sha256 = $(sha "$FINAL")"
echo "  bytes  = $(stat -c '%s' "$FINAL" 2>/dev/null || stat -f '%z' "$FINAL")"
if [[ -f "$ROOT/scripts/verify-daemon-build.mjs" ]] && [[ -f "$ROOT/src-tauri/binaries/hv-control-daemon-$TARGET" || -f "$ROOT/src-tauri/binaries/hv-control-daemon-$TARGET.exe" ]]; then
  info "  产物已在 src-tauri/binaries/ 的场景下运行防错闸："
  node "$ROOT/scripts/verify-daemon-build.mjs" || fail "防错闸未全绿（详见上行）"
else
  info "  （产物尚未放入 src-tauri/binaries/，入位后须复跑 scripts/verify-daemon-build.sh）"
fi

# ---------- 6) manifest 回填指引 ----------
info "6/6 完成。请把以下字段回填 src-tauri/resources/hv-control-daemon.manifest.json 对应 target 条目："
echo "    sha256=$(sha "$FINAL")"
echo "    bytes=$(stat -c '%s' "$FINAL" 2>/dev/null || stat -f '%z' "$FINAL")"
echo "    built_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "    host/rustc/command 按实际填记；特征标记用 strings 复核后写入 gate_markers"
echo "  产物: $FINAL"
echo "  ⚠ 回填后必须复跑 node scripts/verify-daemon-build.mjs 且须 rc=0，方可进入打包。"
