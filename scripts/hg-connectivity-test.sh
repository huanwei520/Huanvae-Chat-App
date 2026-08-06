#!/bin/bash
#
# HuanvaeGuard VPN 连通性测试 (macOS)
#
# 判据是"真握手 + 真收发包 + 端到端 ping"，不是"服务起来了"。
# 已发生过的真实故障：服务状态看着正常，但上下行包**均为 0** —— 隧道从未真正承载过流量。
# 所以本脚本每一项都量真实数字，并把**原始命令输出**打印出来备查，不只打结论。
#
# 五项检查：
#   1. 守护进程被系统真拉起   launchctl print，必须 state = running
#                             （踩过的坑：手工前台跑得起来、但被服务管理器拉不起来，
#                               所以必须验"系统托管路径"这一条，手启成功不算数）
#   2. 隧道接口 + VIP         status JSON 的 active / interface_name / address + ifconfig 原始输出
#   3. 真实握手               peers[0].last_handshake 必须非 0（0 = 从未握手）
#   4. 真实收发包（两向）     ping 前后各采样一次，rx 增量与 tx 增量都必须 > 0，任一为 0 即 FAIL
#   5. 端到端 ping            丢包率 + 每包 ttl 跳数判定 + 路由不得是内核本地交付
#
# 环境变量：
#   HG_PEER_VIP            对端隧道 VIP（形如 <对端VIP>）。**必需，无默认值**
#   HG_PEER_INITIAL_TTL    对端 OS 的初始 TTL。macOS/Linux 对端填 64，Windows 对端填 128。默认 64
#   HG_CONTROL_PORT        本机守护进程控制口。默认：从已装 plist 的 --api-listen 解析，
#                          解析不到才回落 19198
#   HG_PING_COUNT          ping 包数。默认 10
#   HG_EXPECT_DAEMON_SHA   期望的已装守护进程 sha256。设置了就**断言相等**，不等即 FAIL。默认不校验
#
# 退出码（调用方靠它区分三态）：
#   0 = 五项全过
#   1 = 有项 FAIL（真跑了，没通过）
#   3 = 本机物理上跑不了，**未执行**（HG_PEER_VIP 未设置 / 本机没装守护进程 /
#       控制口无应答且 plist 不存在 / 不是 macOS）。这一态**不是通过也不是失败**，
#       调用方登记为"跳过"。
#
# 用法：
#   HG_PEER_VIP=<对端VIP> ./scripts/hg-connectivity-test.sh
#   HG_PEER_VIP=<对端VIP> HG_PEER_INITIAL_TTL=128 ./scripts/hg-connectivity-test.sh   # 对端是 Windows
#
# 关于 ttl 判据（别改成硬编码 63）：
#   ttl 初值由**应答方 OS**决定（macOS/Linux = 64，Windows = 128）。判"包是否真经过转发"
#   要用「初始 TTL − 实测 ttl == 1」，把初值写死成某一个数、或把判据写死成 ttl == 63，
#   换个 OS 的对端就恒错。初值由 HG_PEER_INITIAL_TTL 给出。
#
# 刻意**不用 set -e**：本脚本大量命令"返回非 0 是预期内的观测结果"（ping 全丢包、
#   curl 连不上、grep 没命中）。set -e 会让脚本在第一处观测失败时直接死掉，拿不到后面
#   几项的证据、也打不出汇总和退出码语义。每一处失败都在下面显式判定。
#
# 本仓是 PUBLIC 公开仓：脚本内不出现任何私网 IP / 内部主机名 / 真实对端地址，
#   对端一律由 HG_PEER_VIP 注入，注释里只用 <对端VIP> 占位符。
#
# 改本文件时注意（macOS 系统 bash 是 3.2，本脚本就跑在它上面）：
#   **变量后面紧跟中文字符时必须写 ${VAR}，不能写 $VAR**。bash 3.2 在本机 locale 下
#   会把多字节字符的首字节当成变量名的一部分 —— `"$V（非 0）"` 实测输出成 `"（非 0）"`
#   的残缺形态（变量值和 `（` 的首字节一起丢掉），而 `"${V}（非 0）"` 正常。
#   这类 bug 不报错、只是判据原文里少一段数字，排查时极难发现。

# ============================================
# 颜色（与 scripts/linux/test-all.sh 同款）
# ============================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
NC='\033[0m'

# ============================================
# 常量（与 src-tauri/src/desktop/huanvaeguard_macos.rs 对齐）
# ============================================
DAEMON_LABEL="com.huanvaeguard.daemon"
PLIST_PATH="/Library/LaunchDaemons/${DAEMON_LABEL}.plist"
DAEMON_BIN="/usr/local/bin/hg-macos"
DEFAULT_CONTROL_PORT=19198

# ============================================
# 五项登记表（PENDING / PASS / FAIL / NOTRUN）
# ============================================
ITEM_NAME=("" "守护进程被系统真拉起" "隧道接口 + VIP" "真实握手" "真实收发包（两向）" "端到端 ping")
ITEM_STATUS=("" "PENDING" "PENDING" "PENDING" "PENDING" "PENDING")
ITEM_REASON=("" "" "" "" "" "")

pass_item() {   # $1=项号  $2=结论
    ITEM_STATUS[$1]="PASS"
    echo -e "  ${GREEN}✓ PASS: $2${NC}"
}

fail_item() {   # $1=项号  $2=判据原文（同一项可多次调用，判据累加）
    ITEM_STATUS[$1]="FAIL"
    if [[ -n "${ITEM_REASON[$1]}" ]]; then
        ITEM_REASON[$1]="${ITEM_REASON[$1]} ｜ $2"
    else
        ITEM_REASON[$1]="$2"
    fi
    echo -e "  ${RED}✗ FAIL: $2${NC}"
}

notrun_item() { # $1=项号  $2=为什么没跑
    ITEM_STATUS[$1]="NOTRUN"
    ITEM_REASON[$1]="$2"
    echo -e "  ${YELLOW}— 未执行: $2${NC}"
}

step_header() { # $1=项号  $2=标题
    echo ""
    echo -e "${CYAN}[$1/5] $2${NC}"
}

show_cmd() {    # 把即将执行的命令原样打出来，便于人工复现
    echo -e "  ${GRAY}\$ $*${NC}"
}

indent() { sed 's/^/      /'; }

# 本机物理上跑不了 —— 退出码 3，措辞必须明说"未执行"
not_runnable() {
    echo ""
    echo -e "${YELLOW}========================================${NC}"
    echo -e "  ${YELLOW}⚠ 本次未执行：$1${NC}"
    echo -e "  ${YELLOW}未执行 —— 既不是通过也不是失败，不能视为通过${NC}"
    echo -e "  ${GRAY}调用方请把本次登记为「跳过」（退出码 3）${NC}"
    echo -e "${YELLOW}========================================${NC}"
    echo ""
    exit 3
}

# ============================================
# JSON 取值（不依赖 jq —— 发布机上未必装）
# 控制口返回的 JSON 形状固定且扁平，peers 里要的三个键只在 peers 内出现，
# 取第一条命中即 peers[0]。
# ============================================
json_str() {    # $1=键名  $2=JSON 文本 → 字符串值
    printf '%s' "$2" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 \
        | sed -E "s/^\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"$//"
}

json_num() {    # $1=键名  $2=JSON 文本 → 数值
    printf '%s' "$2" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*-?[0-9]+" | head -1 \
        | sed -E "s/^\"$1\"[[:space:]]*:[[:space:]]*//"
}

json_bool() {   # $1=键名  $2=JSON 文本 → true / false
    printf '%s' "$2" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*(true|false)" | head -1 \
        | sed -E "s/^\"$1\"[[:space:]]*:[[:space:]]*//"
}

# ============================================
# 控制口端口解析
# 与 Rust 侧 parse_api_listen_port 同款字符串扫描：定位 <string>--api-listen</string>，
# 取**紧随其后**的 <string>host:port</string> 的端口部分。plist 是我们自己渲染的、
# 形状固定，为读一个参数值引入 XML 解析依赖不划算。
# ============================================
parse_api_listen_port() {
    local xml after rest value port
    xml=$(tr '\n' ' ' < "$PLIST_PATH" 2>/dev/null) || return 1
    [[ -n "$xml" ]] || return 1

    after="${xml#*<string>--api-listen</string>}"
    [[ "$after" == "$xml" ]] && return 1          # 没有该参数（老 plist / 手改过）

    rest="${after#*<string>}"
    [[ "$rest" == "$after" ]] && return 1         # 参数后面没有值元素

    value="${rest%%</string>*}"
    port="${value##*:}"                           # host:port → port
    port="${port// /}"
    case "$port" in
        ''|*[!0-9]*) return 1 ;;                  # 未替换的占位符 / 非数字端口
    esac
    printf '%s' "$port"
}

# ============================================
# 前置：环境与参数
# ============================================
echo ""
echo -e "${MAGENTA}========================================${NC}"
echo -e "${MAGENTA}  HuanvaeGuard VPN 连通性测试 (macOS)${NC}"
echo -e "${MAGENTA}  判据：真握手 + 真收发包 + 端到端 ping${NC}"
echo -e "${MAGENTA}========================================${NC}"

if [[ "$(uname -s)" != "Darwin" ]]; then
    not_runnable "本脚本只覆盖 macOS 侧（launchctl / ifconfig / netstat -ibn / route），当前系统是 $(uname -s)；Windows 侧请用 scripts/hg-connectivity-test.ps1"
fi

PEER_VIP="${HG_PEER_VIP:-}"
if [[ -z "$PEER_VIP" ]]; then
    not_runnable "HG_PEER_VIP 未设置（对端隧道 VIP 无默认值，必须显式注入）"
fi
if ! printf '%s' "$PEER_VIP" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
    not_runnable "HG_PEER_VIP 不是合法 IPv4 地址：$PEER_VIP"
fi

PEER_INITIAL_TTL="${HG_PEER_INITIAL_TTL:-64}"
if ! printf '%s' "$PEER_INITIAL_TTL" | grep -qE '^[0-9]+$'; then
    echo -e "  ${YELLOW}⚠ HG_PEER_INITIAL_TTL=\"$PEER_INITIAL_TTL\" 不是数字，按默认 64 处理${NC}"
    PEER_INITIAL_TTL=64
fi

PING_COUNT="${HG_PING_COUNT:-10}"
if ! printf '%s' "$PING_COUNT" | grep -qE '^[1-9][0-9]*$'; then
    echo -e "  ${YELLOW}⚠ HG_PING_COUNT=\"$PING_COUNT\" 不是正整数，按默认 10 处理${NC}"
    PING_COUNT=10
fi

# 控制口：环境变量 > 已装 plist 的 --api-listen > 默认端口
if [[ -n "${HG_CONTROL_PORT:-}" ]]; then
    CONTROL_PORT="$HG_CONTROL_PORT"
    CONTROL_PORT_SRC="环境变量 HG_CONTROL_PORT"
elif CONTROL_PORT=$(parse_api_listen_port); then
    CONTROL_PORT_SRC="已装 plist 的 --api-listen（${PLIST_PATH}）"
else
    CONTROL_PORT="$DEFAULT_CONTROL_PORT"
    CONTROL_PORT_SRC="回落默认值（plist 不存在或未写 --api-listen）"
fi

echo ""
echo -e "  对端 VIP        : $PEER_VIP"
echo -e "  对端初始 TTL    : $PEER_INITIAL_TTL  （判据：初始 TTL − 实测 ttl == 1）"
echo -e "  ping 包数       : $PING_COUNT"
echo -e "  控制口          : 127.0.0.1:$CONTROL_PORT  ← $CONTROL_PORT_SRC"
echo -e "  期望守护进程 SHA: ${HG_EXPECT_DAEMON_SHA:-（未设置，不校验）}"

# 本机压根没装 → 未执行
if [[ ! -f "$PLIST_PATH" && ! -x "$DAEMON_BIN" ]]; then
    not_runnable "本机没装守护进程（$PLIST_PATH 与 $DAEMON_BIN 都不存在）"
fi

STATUS_URL="http://127.0.0.1:${CONTROL_PORT}/api/tunnel/status"

fetch_status() {
    curl -s --max-time 8 "$STATUS_URL" 2>&1
}

# 先探一次控制口：无应答且 plist 不存在 = 本机跑不了（未执行）；
# plist 在却无应答 = 装了但死了，那是**真失败**，继续往下跑让五项各自判定。
PROBE_JSON=$(fetch_status)
CONTROL_ALIVE=false
if printf '%s' "$PROBE_JSON" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
    CONTROL_ALIVE=true
fi
if ! $CONTROL_ALIVE && [[ ! -f "$PLIST_PATH" ]]; then
    not_runnable "控制口 127.0.0.1:$CONTROL_PORT 无应答，且 $PLIST_PATH 不存在（本机没有本 App 装的守护进程）"
fi

START_TIME=$(date +%s)

# ============================================
# 1. 守护进程被系统真拉起（launchctl）
# ============================================
step_header 1 "${ITEM_NAME[1]}"
echo -e "  ${GRAY}判据：launchctl 托管态必须 state = running；"
echo -e "  手工前台能跑起来**不算数**（踩过的坑：服务管理器拉不起同一个二进制）${NC}"

show_cmd "launchctl print system/${DAEMON_LABEL}"
LAUNCHCTL_OUT=$(launchctl print "system/${DAEMON_LABEL}" 2>&1)
printf '%s\n' "$LAUNCHCTL_OUT" | indent

if printf '%s' "$LAUNCHCTL_OUT" | grep -qE '^[[:space:]]*state[[:space:]]*=[[:space:]]*running'; then
    pass_item 1 "launchctl 报告 state = running（系统托管路径已真拉起）"
else
    fail_item 1 "launchctl print system/${DAEMON_LABEL} 输出里没有 \"state = running\"（服务未被 launchd 真拉起）"
fi

# 发货件同一性：设置了期望 sha 就断言相等
if [[ -n "${HG_EXPECT_DAEMON_SHA:-}" ]]; then
    show_cmd "shasum -a 256 $DAEMON_BIN"
    if [[ -f "$DAEMON_BIN" ]]; then
        SHA_OUT=$(shasum -a 256 "$DAEMON_BIN" 2>&1)
        printf '%s\n' "$SHA_OUT" | indent
        ACTUAL_SHA=$(printf '%s' "$SHA_OUT" | awk '{print $1}' | tr 'A-Z' 'a-z')
        EXPECT_SHA=$(printf '%s' "$HG_EXPECT_DAEMON_SHA" | tr 'A-Z' 'a-z')
        if [[ "$ACTUAL_SHA" == "$EXPECT_SHA" ]]; then
            echo -e "  ${GREEN}✓ 守护进程 sha256 与 HG_EXPECT_DAEMON_SHA 一致${NC}"
        else
            fail_item 1 "已装守护进程 sha256 与期望不符：实测 ${ACTUAL_SHA} ≠ 期望 ${EXPECT_SHA}（跑起来的不是这次要发的那份二进制）"
        fi
    else
        fail_item 1 "设置了 HG_EXPECT_DAEMON_SHA，但 $DAEMON_BIN 不存在，无法校验发货件同一性"
    fi
fi

# ============================================
# 2. 隧道接口 + VIP
# ============================================
step_header 2 "${ITEM_NAME[2]}"
echo -e "  ${GRAY}判据：status JSON 的 active == true，且 interface_name / address 非空${NC}"

show_cmd "curl -s $STATUS_URL"
STATUS_JSON=$(fetch_status)
printf '%s\n' "$STATUS_JSON" | indent

ACTIVE=$(json_bool active "$STATUS_JSON")
TUN_IF=$(json_str interface_name "$STATUS_JSON")
TUN_ADDR=$(json_str address "$STATUS_JSON")
LOCAL_VIP="${TUN_ADDR%%/*}"

echo -e "  ${GRAY}解析：active=${ACTIVE:-<空>}  interface_name=${TUN_IF:-<空>}  address=${TUN_ADDR:-<空>}${NC}"

ITEM2_OK=true
if [[ "$ACTIVE" != "true" ]]; then
    fail_item 2 "status JSON 的 active 不是 true（实测：${ACTIVE:-<取不到，控制口可能无应答>}）"
    ITEM2_OK=false
fi
if [[ -z "$TUN_IF" ]]; then
    fail_item 2 "status JSON 取不到 interface_name（隧道接口不存在）"
    ITEM2_OK=false
fi
if [[ -z "$TUN_ADDR" ]]; then
    fail_item 2 "status JSON 取不到 address（隧道未分配 VIP）"
    ITEM2_OK=false
fi

if [[ -n "$TUN_IF" ]]; then
    show_cmd "ifconfig $TUN_IF"
    IFCONFIG_OUT=$(ifconfig "$TUN_IF" 2>&1)
    printf '%s\n' "$IFCONFIG_OUT" | indent
    if ! printf '%s' "$IFCONFIG_OUT" | grep -q "$TUN_IF"; then
        fail_item 2 "ifconfig $TUN_IF 拿不到该接口（status JSON 报了接口名，系统里却没有）"
        ITEM2_OK=false
    fi
fi

if $ITEM2_OK; then
    pass_item 2 "隧道 active=true，接口 $TUN_IF 存在，VIP $TUN_ADDR"
fi

# ============================================
# 3. 真实握手
# ============================================
step_header 3 "${ITEM_NAME[3]}"
echo -e "  ${GRAY}判据：peers[0].last_handshake 必须非 0（0 = 从未握手过）${NC}"

PEER_PUBKEY=$(json_str public_key "$STATUS_JSON")
LAST_HANDSHAKE=$(json_num last_handshake "$STATUS_JSON")
echo -e "  ${GRAY}解析：peers[0].public_key=${PEER_PUBKEY:-<空>}  last_handshake=${LAST_HANDSHAKE:-<空>}${NC}"

if [[ -z "$PEER_PUBKEY" ]]; then
    fail_item 3 "status JSON 的 peers 为空（没有任何 peer，谈不上握手）"
elif [[ -z "$LAST_HANDSHAKE" ]]; then
    fail_item 3 "status JSON 取不到 peers[0].last_handshake"
elif [[ "$LAST_HANDSHAKE" == "0" ]]; then
    fail_item 3 "peers[0].last_handshake == 0（从未握手成功，隧道只是「配上了」而已）"
else
    pass_item 3 "peers[0].last_handshake = ${LAST_HANDSHAKE}（非 0，握手真发生过）"
fi

# ============================================
# 4 + 5：采样 T0 → ping → 采样 T1
# 收发包必须**两向分开量**：只报"通/不通"会把"发出去了没人应"和"压根没发出去"
# 混成同一句话，而这两者根因完全不同。
# ============================================
# 采样一次：结果写进全局 SAMPLE_JSON / SAMPLE_NETSTAT。
# 刻意只跑一次命令、把**打印出来的那份输出**原样拿去解析 —— 若打印一次再另跑一次去解析，
# 打印的证据和判定用的数字就不是同一次观测，对不上账。
sample_counters() {  # $1=T0/T1 标签
    echo -e "  ${GRAY}—— 采样 $1 ——${NC}"
    show_cmd "curl -s $STATUS_URL"
    SAMPLE_JSON=$(fetch_status)
    printf '%s\n' "$SAMPLE_JSON" | indent

    SAMPLE_NETSTAT=""
    if [[ -n "$TUN_IF" ]]; then
        show_cmd "netstat -ibn -I $TUN_IF"
        SAMPLE_NETSTAT=$(netstat -ibn -I "$TUN_IF" 2>&1)
        printf '%s\n' "$SAMPLE_NETSTAT" | indent
    fi
}

# netstat 的两行（<Link#N> 行与地址行）列数不同（地址行多一列 Address），
# 所以按**从右往左**取列：… Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
#   → Ibytes = NF-4，Obytes = NF-1（两行都成立）。取 <Link#N> 行。
netstat_bytes() {   # $1=in|out  $2=netstat 原始输出 → 该方向累计字节数
    printf '%s' "$2" | awk -v d="$1" '
        /<Link#/ { if (d == "in") { print $(NF-4) } else { print $(NF-1) }; found=1; exit }
        END { if (!found) print 0 }
    '
}

step_header 4 "${ITEM_NAME[4]}"
echo -e "  ${GRAY}判据：ping 前后 rx 增量 > 0 **且** tx 增量 > 0，任一为 0 即 FAIL${NC}"
echo -e "  ${GRAY}（真实故障形态：服务状态正常但上下行包均为 0 —— 单看状态发现不了）${NC}"

PING_OUT=""
PING_RAN=false

if ! $ITEM2_OK || [[ -z "$TUN_IF" || -z "$LOCAL_VIP" ]]; then
    notrun_item 4 "第 2 项未通过（拿不到隧道接口 / 本机 VIP），无法采样计数器"
else
    sample_counters "T0（ping 前）"
    T0_RX=$(json_num rx_bytes "$SAMPLE_JSON"); T0_RX="${T0_RX:-0}"
    T0_TX=$(json_num tx_bytes "$SAMPLE_JSON"); T0_TX="${T0_TX:-0}"
    T0_IB=$(netstat_bytes in  "$SAMPLE_NETSTAT"); T0_IB="${T0_IB:-0}"
    T0_OB=$(netstat_bytes out "$SAMPLE_NETSTAT"); T0_OB="${T0_OB:-0}"

    # 触发流量：直接用第 5 项的 ping（同一批包既当流量源，又当端到端判据）
    echo ""
    echo -e "  ${GRAY}触发流量：执行第 5 项的 ping（原始输出见第 5 项）${NC}"
    PING_TIMEOUT=$((PING_COUNT * 2 + 5))
    PING_OUT=$(ping -c "$PING_COUNT" -t "$PING_TIMEOUT" -S "$LOCAL_VIP" "$PEER_VIP" 2>&1)
    PING_RAN=true
    echo ""

    sample_counters "T1（ping 后）"
    T1_RX=$(json_num rx_bytes "$SAMPLE_JSON"); T1_RX="${T1_RX:-0}"
    T1_TX=$(json_num tx_bytes "$SAMPLE_JSON"); T1_TX="${T1_TX:-0}"
    T1_IB=$(netstat_bytes in  "$SAMPLE_NETSTAT"); T1_IB="${T1_IB:-0}"
    T1_OB=$(netstat_bytes out "$SAMPLE_NETSTAT"); T1_OB="${T1_OB:-0}"

    D_RX=$((T1_RX - T0_RX))
    D_TX=$((T1_TX - T0_TX))
    D_IB=$((T1_IB - T0_IB))
    D_OB=$((T1_OB - T0_OB))

    echo ""
    echo -e "  ${GRAY}peer 计数器增量 : rx ${T0_RX} → ${T1_RX} (Δ ${D_RX})   tx ${T0_TX} → ${T1_TX} (Δ ${D_TX})${NC}"
    echo -e "  ${GRAY}接口计数器增量  : Ibytes ${T0_IB} → ${T1_IB} (Δ ${D_IB})   Obytes ${T0_OB} → ${T1_OB} (Δ ${D_OB})${NC}"

    ITEM4_OK=true
    if [[ "$D_TX" -le 0 ]]; then
        fail_item 4 "tx（上行）增量为 ${D_TX} —— 包压根没发出去（不是网络问题，是本机数据面/控制面问题）"
        ITEM4_OK=false
    fi
    if [[ "$D_RX" -le 0 ]]; then
        fail_item 4 "rx（下行）增量为 ${D_RX} —— 发出去了但对端没有任何应答（网络/加密/对端侧问题）"
        ITEM4_OK=false
    fi
    if $ITEM4_OK; then
        pass_item 4 "两向都真有包：rx Δ ${D_RX} 字节 > 0，tx Δ ${D_TX} 字节 > 0"
    fi
fi

# ============================================
# 5. 端到端 ping
# ============================================
step_header 5 "${ITEM_NAME[5]}"
echo -e "  ${GRAY}判据：丢包率不得 100%；每包必须满足「初始 TTL($PEER_INITIAL_TTL) − ttl == 1」；${NC}"
echo -e "  ${GRAY}route 的 flags 不得含 LOCAL（含 LOCAL = 内核本地交付，包永不进隧道）${NC}"

if ! $PING_RAN; then
    notrun_item 5 "第 2 项未通过（拿不到本机 VIP 作为 ping 源地址），ping 未执行"
else
    show_cmd "ping -c $PING_COUNT -t $PING_TIMEOUT -S $LOCAL_VIP $PEER_VIP"
    printf '%s\n' "$PING_OUT" | indent

    LOSS=$(printf '%s' "$PING_OUT" | grep -oE '[0-9]+(\.[0-9]+)?% packet loss' | head -1 | sed -E 's/%.*//')
    TTLS=$(printf '%s' "$PING_OUT" | grep -oE 'ttl=[0-9]+' | sed 's/ttl=//')
    TTL_COUNT=$(printf '%s' "$TTLS" | grep -c '[0-9]')

    echo -e "  ${GRAY}解析：丢包率=${LOSS:-<解析不到>}%  收到应答包=${TTL_COUNT} 个  ttl 取值=$(printf '%s' "$TTLS" | tr '\n' ' ')${NC}"

    ITEM5_OK=true
    if [[ -z "$LOSS" ]]; then
        fail_item 5 "ping 输出里解析不到丢包率（ping 未正常执行，见上方原始输出）"
        ITEM5_OK=false
    elif [[ "${LOSS%%.*}" -ge 100 ]]; then
        fail_item 5 "丢包率 ${LOSS}% —— 端到端完全不通"
        ITEM5_OK=false
    fi

    if [[ "$TTL_COUNT" -eq 0 ]]; then
        fail_item 5 "没有收到任何带 ttl 的应答包，无法验证转发跳数"
        ITEM5_OK=false
    else
        BAD_TTLS=""
        for t in $TTLS; do
            if [[ $((PEER_INITIAL_TTL - t)) -ne 1 ]]; then
                BAD_TTLS="$BAD_TTLS $t"
            fi
        done
        if [[ -n "$BAD_TTLS" ]]; then
            fail_item 5 "有包不满足「初始 TTL($PEER_INITIAL_TTL) − ttl == 1」：异常 ttl =${BAD_TTLS}（包没经过预期的那一跳转发）"
            ITEM5_OK=false
        fi
    fi

    # 路由归属：flags 含 LOCAL = 内核本地交付，包永远不会进隧道
    echo ""
    show_cmd "route -n get $PEER_VIP"
    ROUTE_OUT=$(route -n get "$PEER_VIP" 2>&1)
    printf '%s\n' "$ROUTE_OUT" | indent
    ROUTE_FLAGS=$(printf '%s' "$ROUTE_OUT" | grep -E '^[[:space:]]*flags:' | head -1)
    if printf '%s' "$ROUTE_FLAGS" | grep -q 'LOCAL'; then
        fail_item 5 "route -n get $PEER_VIP 的 flags 含 LOCAL（$(printf '%s' "$ROUTE_FLAGS" | sed 's/^[[:space:]]*//')）—— 内核本地交付，包永不进隧道"
        ITEM5_OK=false
    fi

    if $ITEM5_OK; then
        pass_item 5 "丢包率 ${LOSS}%，${TTL_COUNT} 个应答包 ttl 均满足「${PEER_INITIAL_TTL} − ttl == 1」，路由未走本地交付"
    fi
fi

# ============================================
# 汇总
# ============================================
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

PASS_COUNT=0
HAS_FAIL=false
HAS_NOTRUN=false
for i in 1 2 3 4 5; do
    case "${ITEM_STATUS[$i]}" in
        PASS)   PASS_COUNT=$((PASS_COUNT + 1)) ;;
        FAIL)   HAS_FAIL=true ;;
        *)      HAS_NOTRUN=true ;;
    esac
done

echo ""
echo -e "${MAGENTA}========================================${NC}"
echo -e "${MAGENTA}  VPN 连通性测试汇总${NC}"
echo -e "  耗时: ${DURATION} 秒"
echo -e "${MAGENTA}========================================${NC}"
echo ""
echo -e "  ${CYAN}5 项中真跑通过 ${PASS_COUNT} 项${NC}"
for i in 1 2 3 4 5; do
    case "${ITEM_STATUS[$i]}" in
        PASS) echo -e "  ${GREEN}✓ [$i] ${ITEM_NAME[$i]}${NC}" ;;
        FAIL) echo -e "  ${RED}✗ [$i] ${ITEM_NAME[$i]}${NC}" ;;
        *)    echo -e "  ${YELLOW}— [$i] ${ITEM_NAME[$i]}（未执行）${NC}" ;;
    esac
done

if $HAS_FAIL || $HAS_NOTRUN; then
    echo ""
    echo -e "  ${RED}未通过项的判据原文：${NC}"
    for i in 1 2 3 4 5; do
        if [[ "${ITEM_STATUS[$i]}" != "PASS" && -n "${ITEM_REASON[$i]}" ]]; then
            echo -e "  ${RED}- [$i] ${ITEM_NAME[$i]}: ${ITEM_REASON[$i]}${NC}"
        fi
    done
fi

echo ""
if $HAS_FAIL; then
    echo -e "  ${RED}VPN 连通性测试未通过（真跑了，没过）${NC}"
    echo ""
    exit 1
fi
if $HAS_NOTRUN; then
    echo -e "  ${RED}有项未执行 —— 不视为通过${NC}"
    echo ""
    exit 1
fi
echo -e "  ${GREEN}5/5 真跑通过：真握手 + 两向真收发包 + 端到端 ping 均达标${NC}"
echo ""
exit 0
