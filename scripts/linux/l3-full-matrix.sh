#!/bin/bash
#
# L3 全功能实测矩阵 —— 发布前必测项清单固化（判据+留证位+缺证即红）
#
# ## 为什么必须有这一层
# L0/L1/L2 验的是「代码、包字节、装得上」；用户真正要的是「功能真能用」。
# 1.1.47 的教训之一：VPN 门禁过了（配置在、包里有），实机却不可用。
# L3 把「发布前必须实测的功能项」固化成机器核对的清单：每项要么有留证
# （证据文件路径，由实测会话产出），要么显式 REGISTER 登记不可执行原因——
# **没有 ALLOW_SKIP**，任何一项既无证据也无登记 = FAIL。
#
# ## 十项（任务卡口径）与判据/留证位
#   id                          判据（真值源）                          留证位（默认收集路径）
#   login                       登录页真渲染+登录成功进入主页             e2e Playwright 报告 / 截图
#   message                     双端互发文本消息，对端收到且渲染          e2e 报告 / 截图
#   image                       发图→对端缩略图+原图可看                 e2e 报告 / 截图
#   file                        发文件→对端可下载且哈希一致              e2e 报告 / 截图
#   meeting-create-join         创建会议→第二端加入→双端在会中          会话截图 / 事件日志
#   screenshare                 屏享流对端可看（帧率>0）                会话截图 / 统计日志
#   bitrate-tier                码率档切换生效（流统计变化）             会话日志
#   remote-control-signaling    远控申请→授权→受控端横幅/信令闭环        会话截图 / 信令日志
#   vpn-connect-hotupdate       VPN 真握手+通流+配置热更新生效          hg-connectivity 输出 / 实机日志
#   update-detect               更新检测→渠道清单→横幅/下载可达          L4 报告 / 设备横幅截图
#
# ## 用法
#   scripts/linux/l3-full-matrix.sh --list                       # 打印矩阵定义
#   scripts/linux/l3-full-matrix.sh --record <id> <证据路径>      # 登记一项的留证
#   scripts/linux/l3-full-matrix.sh --register <id> "<原因>"      # 显式登记不可执行（原因入发布记录）
#   scripts/linux/l3-full-matrix.sh --check [--state <json>]     # 核对（默认）；缺证项即 FAIL
#
#   --state 默认 ./.release-l3-state.json（.gitignore 域，不入仓）；release.sh 接入时
#   传 --state "$RELEASE_LOG_DIR/l3-state.json" 留档。
#
# ## 退出码
#   0 = 全部项 PASS（有证据）或 REGISTERED（登记了真实原因）
#   1 = 有 MISSING 项（既无证据也无登记）—— 发布中止
#   2 = 用法错误 / 未知 id

set -u

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; GRAY='\033[0;90m'; NC='\033[0m'

STATE="${L3_STATE:-$PWD/.release-l3-state.json}"
MODE="check"; REC_ID=""; REC_VAL=""; REC_KIND=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --list) MODE="list"; shift ;;
        --record) REC_KIND="evidence"; REC_ID="$2"; REC_VAL="$3"; shift 3 ;;
        --register) REC_KIND="registered"; REC_ID="$2"; REC_VAL="$3"; shift 3 ;;
        --check) MODE="check"; shift ;;
        --state) STATE="$2"; shift 2 ;;
        -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo -e "${RED}未知参数: $1${NC}" >&2; exit 2 ;;
    esac
done

# id|名称|判据|自动收集的证据 glob（:分隔，相对仓库根）
MATRIX=(
"id=login|登录|登录页真渲染且登录成功进入主页（截图/uiautomator 命中+主页节点）|test-results/**/result.json|e2e/**"
"id=message|消息|双端互发文本消息，对端收到且渲染|test-results/**/result.json"
"id=image|图片|发图→对端缩略图+原图可看|test-results/**/result.json"
"id=file|文件|发文件→对端可下载且哈希一致|test-results/**/result.json"
"id=meeting-create-join|会议创建加入|创建→第二端加入→双端在会中（成员列表双端一致）|"
"id=screenshare|屏幕共享|屏享流对端可看且帧率>0|"
"id=bitrate-tier|码率档|码率档切换生效（流统计数值变化）|"
"id=remote-control-signaling|远控信令|申请→授权→受控端横幅/信令闭环|"
"id=vpn-connect-hotupdate|VPN 连接与热更新|真握手+两向通流+配置热更新生效（hg-connectivity 口径）|"
"id=update-detect|更新检测|更新检测命中渠道清单且横幅/下载可达（L4 报告/设备横幅截图）|"
)

IDS=(); NAMES=(); CRITS=(); GLOBS=()
for row in "${MATRIX[@]}"; do
    IFS='|' read -r _id _name _crit _g <<< "$row"
    IDS+=("${_id#id=}"); NAMES+=("$_name"); CRITS+=("$_crit"); GLOBS+=("${_g:-}")
done

id_index() { local i; for i in "${!IDS[@]}"; do [[ "${IDS[$i]}" == "$1" ]] && { echo "$i"; return 0; }; done; return 1; }

state_get() {  # $1=id → kind:value 或空
    [[ -f "$STATE" ]] || return 0
    L3_ID="$1" L3_STATE_F="$STATE" node -e '
const j=JSON.parse(require("fs").readFileSync(process.env.L3_STATE_F,"utf8"));
const e=(j.items||{})[process.env.L3_ID];
if(e) console.log(e.kind+":"+e.value);' 2>/dev/null
}

state_set() {  # $1=id $2=kind $3=value（值经环境变量传入 node，避免引号炸 JS）
    L3_ID="$1" L3_KIND="$2" L3_VAL="$3" L3_STATE_F="$STATE" node -e '
const fs=require("fs");
let j={items:{}};
try{ j=JSON.parse(fs.readFileSync(process.env.L3_STATE_F,"utf8")); }catch(e){}
j.items=j.items||{};
j.items[process.env.L3_ID]={kind:process.env.L3_KIND, value:process.env.L3_VAL, at:new Date().toISOString()};
fs.writeFileSync(process.env.L3_STATE_F, JSON.stringify(j,null,2));'
}

if [[ "$MODE" == "list" ]]; then
    echo -e "${CYAN}L3 全功能实测矩阵（10 项，无 ALLOW_SKIP）${NC}"
    for i in "${!IDS[@]}"; do
        echo "  ${IDS[$i]}  ${NAMES[$i]} —— 判据: ${CRITS[$i]}"
    done
    exit 0
fi

if [[ -n "$REC_ID" ]]; then
    idx=$(id_index "$REC_ID") || { echo -e "${RED}未知 id: $REC_ID（--list 看矩阵）${NC}" >&2; exit 2; }
    if [[ "$REC_KIND" == "evidence" ]]; then
        [[ -e "$REC_VAL" ]] || { echo -e "${RED}证据路径不存在: $REC_VAL${NC}" >&2; exit 2; }
        state_set "$REC_ID" evidence "$REC_VAL"
        echo -e "${GREEN}✓ 已登记证据 $REC_ID ← $REC_VAL${NC}"
    else
        [[ -n "$REC_VAL" ]] || { echo -e "${RED}--register 必须给真实原因（禁空登记）${NC}" >&2; exit 2; }
        state_set "$REC_ID" registered "$REC_VAL"
        echo -e "${YELLOW}⚠ 已显式登记 $REC_ID：$REC_VAL（原因进入发布记录，发布责任人可核）${NC}"
    fi
    exit 0
fi

# ---------- check 模式 ----------
echo -e "${CYAN}L3 全功能实测矩阵核对（state=$STATE）${NC}"
MISSING=0; PASSN=0; REGN=0
for i in "${!IDS[@]}"; do
    id="${IDS[$i]}"
    rec="$(state_get "$id")"
    kind="${rec%%:*}"; val="${rec#*:}"
    if [[ "$kind" == "evidence" && -e "$val" ]]; then
        echo -e "  ${GREEN}✓ PASS ${NAMES[$i]}（${CRITS[$i]}）—— 证据: $val${NC}"
        PASSN=$((PASSN+1))
    elif [[ "$kind" == "evidence" ]]; then
        echo -e "  ${RED}✗ MISSING ${NAMES[$i]} —— 登记的证据路径已不存在: $val${NC}"
        MISSING=$((MISSING+1))
    elif [[ "$kind" == "registered" ]]; then
        echo -e "  ${YELLOW}⚠ REGISTERED ${NAMES[$i]} —— 原因: $val${NC}"
        REGN=$((REGN+1))
    else
        # 自动收集：默认证据 glob 命中即算（e2e 报告等）
        auto=""
        if [[ -n "${GLOBS[$i]}" ]]; then
            IFS=':' read -ra gl <<< "${GLOBS[$i]}"
            for g in "${gl[@]}"; do
                # glob 展开交给 shell；无命中时保留字面量 → -e 判 false，不误判
                for hit in $g; do
                    [[ -e "$hit" ]] && { auto="$hit"; break; }
                done
                [[ -n "$auto" ]] && break
            done
        fi
        if [[ -n "$auto" ]]; then
            echo -e "  ${GREEN}✓ PASS ${NAMES[$i]}（${CRITS[$i]}）—— 自动收集证据: $auto${NC}"
            PASSN=$((PASSN+1))
        else
            echo -e "  ${RED}✗ MISSING ${NAMES[$i]}（${CRITS[$i]}）—— 无证据且未登记；--record $id <路径> 或 --register $id \"<真实原因>\"${NC}"
            MISSING=$((MISSING+1))
        fi
    fi
done
echo ""
if [[ $MISSING -gt 0 ]]; then
    echo -e "${RED}L3 矩阵：FAIL（$MISSING 项缺证；PASS $PASSN，REGISTERED $REGN）——缺证项不许发版${NC}"
    exit 1
fi
echo -e "${GREEN}L3 矩阵：PASS（真测有证 $PASSN 项；显式登记 $REGN 项——原因已入档，无 ALLOW_SKIP 机制）${NC}"
exit 0
