#!/bin/bash
#
# verify-daemon-build.sh —— hv-control-daemon 构建-打包链路防错闸（exec 包装）
#
# 唯一实现 = scripts/verify-daemon-build.mjs（纯 node 内置模块，零依赖）；
# 本包装只做 exec 转发，保持既有调用契约（bash scripts/verify-daemon-build.sh），
# 供 CI 步（release.yml）与人工调用。tauri.conf.json beforeBundleCommand 直接调
# .mjs（Windows cmd /C 宿主无 bash 亦可执行）。两入口同一实现，零漂移。
#
# 退出码：0 = 全绿；1 = 任一 FAIL（fail-closed）
#
# @date 2026-10-06  xfu0nh5q-1（第2轮整改：bash 单实现改为 node 唯一实现 + 本包装）

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/verify-daemon-build.mjs"
