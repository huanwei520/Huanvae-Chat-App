#!/usr/bin/env bash
#
# mac-capturable-dev.sh — 启动一个「身份固定、可被截图/授权一次」的调试窗口。
#
# 原理：tauri dev 直接 exec 裸二进制（无 .app 身份，无法稳定授权/捕获）。
# 这里改用 `tauri build --debug` 产出一个 .app（有稳定 bundle id），
# 但把 frontendDist 指向实时的 Vite dev server（http://localhost:1420），
# 所以前端改动靠 Vite HMR 实时热更，窗口不用重开、授权一次永久有效。
# 只有改了 Rust 代码时，才需要重新跑一次本脚本做增量编译。
#
# 用法：
#   bash scripts/dev/mac-capturable-dev.sh
# 产物：
#   src-tauri/target/debug/bundle/macos/Huanvae-Chat-App-Dev.app
#   （第一次在 Cowork 里授权这个 app，之后反复用都不必再授权）

set -euo pipefail

# 项目根目录（本脚本位于 <root>/scripts/dev/）
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

APP="src-tauri/target/debug/bundle/macos/Huanvae-Chat-App-Dev.app"
VITE_URL="http://localhost:1420"
VITE_LOG="/tmp/huanvae-vite-dev.log"

echo "==> 1/3 确保 Vite dev server 在运行 ($VITE_URL)"
if curl -sf "$VITE_URL" >/dev/null 2>&1; then
  echo "    已在运行，复用。"
else
  echo "    未运行，后台启动 pnpm dev（日志：${VITE_LOG}）"
  pnpm dev >"$VITE_LOG" 2>&1 &
  for _ in $(seq 1 80); do
    curl -sf "$VITE_URL" >/dev/null 2>&1 && break
    sleep 0.5
  done
  if ! curl -sf "$VITE_URL" >/dev/null 2>&1; then
    echo "    !! Vite 未能在 40s 内就绪，请查看 $VITE_LOG" >&2
    exit 1
  fi
  echo "    就绪。"
fi

echo "==> 2/3 构建调试包（指向实时 dev server，增量编译）"
pnpm tauri build --debug --config src-tauri/tauri.dev.conf.json

if [ ! -d "$APP" ]; then
  echo "!! 没找到构建产物：$APP" >&2
  echo "   检查 productName 是否为 Huanvae-Chat-App-Dev（见 tauri.dev.conf.json）。" >&2
  exit 1
fi

echo "==> 3/3 重启并打开可捕获的窗口"
# 关掉上一轮旧实例，避免跑的是旧二进制
pkill -f "Huanvae-Chat-App-Dev.app/Contents/MacOS" 2>/dev/null || true
sleep 0.3
open "$APP"

echo
echo "完成。窗口已打开：$APP"
echo "· 前端改动 -> Vite 自动热更，无需重跑本脚本。"
echo "· Rust 改动 -> 重跑本脚本做增量编译。"
echo "· 首次在 Cowork 里授权 \"Huanvae-Chat-App-Dev\"，之后无需再授权。"
