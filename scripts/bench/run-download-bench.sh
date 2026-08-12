#!/usr/bin/env bash
# 更新下载器测速台 —— 一键跑（构建 + 跑 + 落 JSON + 人读摘要）
#
# 用法：
#   BENCH_URL='https://<公开更新源>/<产物>' ./scripts/bench/run-download-bench.sh
#   BENCH_URL=... ./scripts/bench/run-download-bench.sh --rounds 12 --label 改后
#
# 🔴 本仓是 PUBLIC 公开仓：URL 一律经 BENCH_URL 环境变量注入，**脚本内不写任何默认地址**
#    （即便更新源本身是公开的，也不在脚本里固化，免得下一个内网地址被顺手写进来）。
#
# 参数原样透传给 download-bench（--rounds / --shards / --variants / --h2-windows / --label / --out）。
#
# 产物：scripts/bench/results/<label>-<时间戳>.json（已 gitignore，随时可重生成）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRATE="$HERE/download-bench"
RESULTS="$HERE/results"

if [[ -z "${BENCH_URL:-}" ]]; then
  echo "错误：必须设 BENCH_URL（本仓公开，脚本不内置任何默认 URL）" >&2
  echo "例：BENCH_URL='https://<更新源>/<产物文件>' $0 --rounds 10" >&2
  exit 2
fi

# 构建产物默认放本机盘：本工作区在共享盘（virtiofs）上，把 target 放共享盘会慢一个数量级。
# 可用 BENCH_TARGET_DIR 覆盖。
TARGET_DIR="${BENCH_TARGET_DIR:-${TMPDIR:-/tmp}/hv-bench-target}"
mkdir -p "$TARGET_DIR" "$RESULTS"

# ⚠️ 必须写 ${TARGET_DIR} 而不是 $TARGET_DIR：后面紧跟的是全角括号（多字节），
#    bash 3.2（macOS 自带）会把它的首字节当成变量名的一部分 ⇒ `TARGET_DIR\xef: unbound variable`。
#    凡是 $VAR 后面紧跟中文/全角标点的地方，一律加花括号。
echo "[bench] 构建（CARGO_TARGET_DIR=${TARGET_DIR}）..." >&2
CARGO_TARGET_DIR="$TARGET_DIR" cargo build --release --manifest-path "$CRATE/Cargo.toml" >&2

BIN="$TARGET_DIR/release/download-bench"
[[ -x "$BIN" ]] || { echo "构建产物不存在: $BIN" >&2; exit 1; }

# 从参数里捞 --label 用于文件名（没给就用 current）
LABEL="current"
prev=""
for a in "$@"; do
  if [[ "$prev" == "--label" ]]; then LABEL="$a"; fi
  prev="$a"
done
OUT="$RESULTS/${LABEL}-$(date +%Y%m%d-%H%M%S).json"

"$BIN" --url "$BENCH_URL" --out "$OUT" "$@"
echo "[bench] 结果: $OUT" >&2
