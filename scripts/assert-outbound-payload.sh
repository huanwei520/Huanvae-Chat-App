#!/usr/bin/env bash
# ============================================================================
# 出站载荷闸 —— 凡是把仓内容传到本机之外（scp / rsync / tar 给第三方 / 上传），
# 打包完成后【必须】用本脚本核一次载荷，非 0 即中止。
#
# 用法：
#   scripts/assert-outbound-payload.sh <包.tar.gz>      # 核一个 tar 包
#   scripts/assert-outbound-payload.sh --selftest       # 负对照：证明这道闸真的会拦
#
# ── 为什么必须机械化（别删这段，它是这道闸存在的理由）────────────────────────
# 两种口径的失效方向**不对称**（.claude/rules/common.md 已写死）：
#   · 黑名单漏一条 = 静默把用户隐私数据传出本机，**没有任何地方会报错**
#   · 白名单漏一条 = 远端编译报错，**当场可见、当场能补**
# 所以规则本身要求「一律白名单」。但规则靠人记得，而 2026-08-12 实证：人会忘 ——
# 早前轮次用「排除 node_modules/target/.git」的黑名单口径同步源码到远程构建宿主，
# 仓根 data/（App portable 模式的本地运行数据落点）不在排除列表里，于是
# **9 个真实 chat_data.db（含 owner 本人 6.77 MB 的生产聊天库）随源码一起出了本机**，
# 两棵树各 162 MB，直到一天后才被顺带扫到。全程零报错、零告警。
# ⇒ 这道闸把「记得用白名单」从人的自觉变成打包后的一个机械动作。
#
# ⚠️ 它**不替代**白名单：白名单仍是正路（本脚本只是最后一道网）。
#     它也**不保证**穷尽所有敏感物，只拦已知的高危形态。新增形态就往下面加。
# ============================================================================
set -uo pipefail

# 禁止出现在出站载荷里的路径形态。
# 加新条目时：① 在 selftest 里补一条对应的负对照 ② 在注释里写清为什么危险
FORBIDDEN='(^|/)data/|chat_data\.db|(^|/)\.git/|(^|/)node_modules/|\.env$|\.env\.|(^|/)secrets/|\.key\.pem$|\.pem$|\.p12$|\.pfx$|\.jks$|\.keystore$|(^|/)id_[a-z0-9_]+$|id_rsa|id_ed25519'

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'

list_entries() {
    local pkg="$1"
    case "$pkg" in
        *.tar.gz|*.tgz) tar tzf "$pkg" ;;
        *.tar)          tar tf  "$pkg" ;;
        *)              echo "assert-outbound-payload: 不认识的包格式: $pkg" >&2; return 2 ;;
    esac
}

check_pkg() {
    local pkg="$1"
    if [[ ! -f "$pkg" ]]; then
        echo "${RED}✗ 载荷不存在: $pkg${NC}" >&2
        return 2
    fi

    local entries hits total
    entries="$(list_entries "$pkg")" || return 2
    total="$(printf '%s\n' "$entries" | grep -c . || true)"

    # 正对照：包里必须真的有东西。空包会让下面的「0 命中」变成毫无意义的绿。
    if [[ "$total" -eq 0 ]]; then
        echo "${RED}✗ 载荷是空的（0 个条目）—— 「无违禁项」在空包上恒真，不构成通过${NC}" >&2
        return 2
    fi

    hits="$(printf '%s\n' "$entries" | grep -nE "$FORBIDDEN" || true)"
    if [[ -n "$hits" ]]; then
        echo "${RED}✗ 出站载荷含违禁项，已中止（不要传出去）${NC}" >&2
        echo "  包: ${pkg}（共 $total 个条目）" >&2
        printf '%s\n' "$hits" | head -20 | sed 's/^/    /' >&2
        local n; n="$(printf '%s\n' "$hits" | grep -c . || true)"
        [[ "$n" -gt 20 ]] && echo "    …… 另有 $((n - 20)) 条未列出" >&2
        echo "  ⇒ 请改用**白名单**打包（只带需要的目录），不要在黑名单上打补丁。" >&2
        return 1
    fi

    echo "${GREEN}✓ 出站载荷检查通过${NC}（$total 个条目，违禁项 0）"
    return 0
}

# ── 负对照自检：故意造一个含 data/ 与 chat_data.db 的包，证明这道闸真的会拦 ──
# 没做过「故意弄坏」的检查器一律按未验证对待（2026-08-12 立，与「假实现」同族纪律）。
selftest() {
    local tmp rc_bad rc_good rc_empty fails=0
    tmp="$(mktemp -d)"
    # ⚠️ 不要用 `trap … RETURN`：RETURN 陷阱会在**被调用函数**（check_pkg）返回时就触发，
    # 把临时目录提前删掉，后续两组对照全部失真。2026-08-12 实测踩到，改为显式清理。

    # 负对照包：含违禁项，必须被拦
    mkdir -p "$tmp/pkg_bad/src" "$tmp/pkg_bad/data/HuanWei_api_huanvae_cn/chat"
    echo 'console.log(1)' > "$tmp/pkg_bad/src/main.ts"
    echo 'FAKE-SQLITE'    > "$tmp/pkg_bad/data/HuanWei_api_huanvae_cn/chat/chat_data.db"
    tar czf "$tmp/bad.tar.gz" -C "$tmp" pkg_bad 2>/dev/null

    # 私钥专项负对照：只含私钥、不含 data/ —— 证明私钥这一类**单独**也会被拦，
    # 而不是靠 data/ 顺带命中（否则「私钥被纳入」就是个没验过的声称）。
    mkdir -p "$tmp/pkg_key/src-tauri/resources"
    echo 'console.log(1)'            > "$tmp/pkg_key/src-tauri/main.ts"
    echo '-----BEGIN PRIVATE KEY-----' > "$tmp/pkg_key/src-tauri/resources/app-client.key.pem"
    tar czf "$tmp/key.tar.gz" -C "$tmp" pkg_key 2>/dev/null

    # 正对照包：干净，必须放行
    mkdir -p "$tmp/pkg_good/src" "$tmp/pkg_good/src-tauri"
    echo 'console.log(1)' > "$tmp/pkg_good/src/main.ts"
    echo '[package]'      > "$tmp/pkg_good/src-tauri/Cargo.toml"
    tar czf "$tmp/good.tar.gz" -C "$tmp" pkg_good 2>/dev/null

    echo "── 负对照：含 data/ 与 chat_data.db 的包 ──"
    check_pkg "$tmp/bad.tar.gz" >/dev/null 2>&1; rc_bad=$?
    if [[ "$rc_bad" -eq 1 ]]; then
        echo "${GREEN}  ✓ 被拦下（rc=1）—— 这道闸是活的${NC}"
    else
        echo "${RED}  ✗ 没拦住（rc=${rc_bad}）—— 闸失效，等于永远绿${NC}"; fails=$((fails+1))
    fi

    echo "── 正对照：干净包 ──"
    check_pkg "$tmp/good.tar.gz" >/dev/null 2>&1; rc_good=$?
    if [[ "$rc_good" -eq 0 ]]; then
        echo "${GREEN}  ✓ 正常放行（rc=0）—— 不是「一律拦」的假闸${NC}"
    else
        echo "${RED}  ✗ 误拦干净包（rc=${rc_good}）${NC}"; fails=$((fails+1))
    fi

    echo "── 负对照2：只含私钥、不含 data/ ──"
    local rc_key
    check_pkg "$tmp/key.tar.gz" >/dev/null 2>&1; rc_key=$?
    if [[ "$rc_key" -eq 1 ]]; then
        echo "${GREEN}  ✓ 私钥单独也被拦下（rc=1）${NC}"
    else
        echo "${RED}  ✗ 私钥没拦住（rc=${rc_key}）—— 「已纳入私钥」是个假声称${NC}"; fails=$((fails+1))
    fi

    echo "── 空包（防「0 命中」在空包上恒真）──"
    tar czf "$tmp/empty.tar.gz" -T /dev/null 2>/dev/null
    check_pkg "$tmp/empty.tar.gz" >/dev/null 2>&1; rc_empty=$?
    if [[ "$rc_empty" -eq 2 ]]; then
        echo "${GREEN}  ✓ 空包被判为无效（rc=2），不算通过${NC}"
    else
        echo "${RED}  ✗ 空包被当成通过（rc=${rc_empty}）${NC}"; fails=$((fails+1))
    fi

    rm -rf "$tmp"
    echo
    if [[ "$fails" -eq 0 ]]; then
        echo "${GREEN}自检全过：这道闸能拦、不误拦、不在空包上假绿${NC}"; return 0
    fi
    echo "${RED}自检失败 $fails 项${NC}"; return 1
}

main() {
    if [[ $# -lt 1 ]]; then
        echo "用法: $0 <包.tar.gz> | --selftest" >&2; exit 2
    fi
    [[ "$1" == "--selftest" ]] && { selftest; exit $?; }
    check_pkg "$1"; exit $?
}

main "$@"
