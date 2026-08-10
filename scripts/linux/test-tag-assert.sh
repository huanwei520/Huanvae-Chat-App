#!/bin/bash
# release.sh 的 assert_tag_points_at_head 回归测试（两个方向都要过）
#
# 背景：`git tag` 写完 .git/refs/tags/<tag> 后立刻 `git rev-parse "<tag>^{commit}"` 读回，
# 在 virtiofs / 网络共享卷上会**瞬时读不到**（fatal: ambiguous argument ... unknown revision）。
# 旧实现不区分「读失败」与「指向不符」：rev-parse 失败 → tag_sha 空串 → 空串 != head_sha
# → 误判成"标签指错"并中止发布。v1.1.22/23/24/25/26 **连续五次**命中，每次都要人工取证后手动 push。
# ref 本身是好的（同期 `cat .git/refs/tags/<tag>` 恒能读出正确 sha），纯属可见性滞后。
#
# 本测试用 PATH 前置的 stub git 精确模拟该竞态，并同时守住反向：
# 真正的指向错误必须仍然被拦下，否则重试就把校验吞废了。
#
# 用法：bash scripts/linux/test-tag-assert.sh

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/release.sh"
REAL_GIT="$(command -v git)"
FAILED=0

extract_fn() {   # $1=目标文件
  {
    echo 'RED=""; GREEN=""; YELLOW=""; NC=""'
    echo 'print_error(){ echo "ERR: $*"; }; print_ok(){ echo "OK: $*"; }'
    sed -n '/^assert_tag_points_at_head() {/,/^}/p' "$SCRIPT"
  } > "$1"
  grep -q 'assert_tag_points_at_head' "$1"
}

# ── 用例 1：首次 rev-parse 瞬时失败 ⇒ 必须仍然判定通过 ────────────────────
case1() {
  local TMP; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' RETURN
  mkdir -p "$TMP/bin"
  cat > "$TMP/bin/git" <<EOS
#!/bin/bash
if [[ "\$1" == "rev-parse" && "\$2" == *"^{commit}" ]]; then
  if [[ ! -f "$TMP/.hit" ]]; then
    : > "$TMP/.hit"
    echo "fatal: ambiguous argument '\$2': unknown revision or path not in the working tree." >&2
    exit 128
  fi
fi
exec "$REAL_GIT" "\$@"
EOS
  chmod +x "$TMP/bin/git"
  ( mkdir -p "$TMP/repo" && cd "$TMP/repo" \
    && "$REAL_GIT" init -q . && "$REAL_GIT" config user.email t@t && "$REAL_GIT" config user.name t \
    && echo x > f && "$REAL_GIT" add f && "$REAL_GIT" commit -qm c1 && "$REAL_GIT" tag v9.9.9 HEAD ) || return 2
  extract_fn "$TMP/fn.sh" || { echo "  抽不出被测函数"; return 2; }
  ( cd "$TMP/repo" && PATH="$TMP/bin:$PATH" bash -c "source '$TMP/fn.sh'; assert_tag_points_at_head v9.9.9" ) >/dev/null 2>&1
}

# ── 用例 2：tag 真的落后于 HEAD ⇒ 必须仍然判定失败 ───────────────────────
case2() {
  local TMP OUT RC; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' RETURN
  ( mkdir -p "$TMP/repo" && cd "$TMP/repo" \
    && "$REAL_GIT" init -q . && "$REAL_GIT" config user.email t@t && "$REAL_GIT" config user.name t \
    && echo a > f && "$REAL_GIT" add f && "$REAL_GIT" commit -qm c1 && "$REAL_GIT" tag v9.9.9 HEAD \
    && echo b >> f && "$REAL_GIT" add f && "$REAL_GIT" commit -qm c2 ) || return 2
  extract_fn "$TMP/fn.sh" || return 2
  OUT=$( cd "$TMP/repo" && bash -c "source '$TMP/fn.sh'; assert_tag_points_at_head v9.9.9" 2>&1 ); RC=$?
  [[ $RC -ne 0 ]] && echo "$OUT" | grep -q '没有指向当前 HEAD'
}

echo "[1/2] 瞬时读失败后仍应通过（原五次故障的形态）..."
if case1; then echo "  ✓ PASS"; else echo "  ✗ FAIL —— 瞬时 rev-parse 失败被误判为标签指向错误"; FAILED=1; fi

echo "[2/2] 真实指向错误仍应被拦下（重试不得吞掉真故障）..."
if case2; then echo "  ✓ PASS"; else echo "  ✗ FAIL —— 校验已失效，标签指错竟被放行"; FAILED=1; fi

if [[ $FAILED -eq 0 ]]; then echo "全部通过"; exit 0; else echo "存在失败项"; exit 1; fi
