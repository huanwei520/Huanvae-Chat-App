#!/bin/bash
# release.sh 的 sed_inplace 回归测试（GNU / BSD 两种 sed 语义都要能改成）
#
# 背景：release.sh 是 Linux 脚本，但本仓在 macOS 上跑发布。
# GNU:  sed -i  "<脚本>" <文件>
# BSD:  sed -i '' "<脚本>" <文件>      ← -i **必须**带备份后缀参数
#
# 在 BSD 上照 GNU 写法调用，"<脚本>" 被当成备份后缀、**文件路径反被当成脚本执行**，
# 报出 `sed: 1: "/path/to/file": invalid command code M`。
# 因为错误信息里出现的是路径，v1.1.23 时被误诊成「路径含空格没加引号」，
# 于是靠"手工预设版本号跳过该分支"绕过，根因留到 v1.1.27 再次撞上 —— 发布在 2/7 步中止。
#
# 本测试直接抽出 release.sh 里的 sed_inplace 跑真文件，覆盖两件事：
#   1. 能真正改成（在本机 sed 上）
#   2. 路径含空格时同样能改成（钉死"与空格无关"这个结论，防止再次误诊）
#
# 用法：bash scripts/linux/test-sed-inplace.sh

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/release.sh"
FAILED=0

# 从 release.sh 抽出被测函数（与 test-tag-assert.sh 同一手法：只测真正发货的那份实现）
extract_fn() {
  sed -n '/^sed_inplace() {/,/^}/p' "$SCRIPT" > "$1"
  grep -q 'sed_inplace' "$1"
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

extract_fn "$TMP/fn.sh" || { echo "  ✗ 抽不出 sed_inplace（release.sh 里没有该函数？）"; exit 2; }

# ── 用例 1：普通路径能改成 ────────────────────────────────────────────────
echo "[1/2] 普通路径就地替换..."
printf '"version": "1.0.0"\n' > "$TMP/plain.json"
( source "$TMP/fn.sh"; sed_inplace 's/1\.0\.0/2\.0\.0/' "$TMP/plain.json" ) >/dev/null 2>&1
if grep -q '"2.0.0"' "$TMP/plain.json"; then
  echo "  ✓ PASS"
else
  echo "  ✗ FAIL —— 未替换成功（本机 sed 语义未被正确分派）"; FAILED=1
fi

# ── 用例 2：路径含空格同样能改成 ──────────────────────────────────────────
# 这条钉死「与空格无关」：真因是 -i 语义，不是引号/空格。
echo "[2/2] 路径含空格时就地替换（钉死与空格无关）..."
mkdir -p "$TMP/My Shared Files"
printf '"version": "1.0.0"\n' > "$TMP/My Shared Files/spaced.json"
( source "$TMP/fn.sh"; sed_inplace 's/1\.0\.0/2\.0\.0/' "$TMP/My Shared Files/spaced.json" ) >/dev/null 2>&1
if grep -q '"2.0.0"' "$TMP/My Shared Files/spaced.json"; then
  echo "  ✓ PASS"
else
  echo "  ✗ FAIL —— 含空格路径未替换成功"; FAILED=1
fi

if [[ $FAILED -eq 0 ]]; then echo "全部通过"; exit 0; else echo "存在失败项"; exit 1; fi
