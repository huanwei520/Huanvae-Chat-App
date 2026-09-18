#!/bin/bash
#
# L2 平台安装冒烟 —— 四平台「真安装、真启动、真残留检查」
#
# ## 为什么必须有这一层
# 1.1.47 事故链里，渠道包的 guard 件是坏的，但 CI 全绿、门禁只看配置文本——
# 没有任何一层把包**真的装到一台真机**上跑一遍。L2 就是那一层：
#   Windows VM：静默安装 → sc start HuanvaeGuard 必须返回 0 → 服务 RUNNING → 卸载 → 残留检查
#   macOS VM：  安装(.app) → LaunchDaemon 加载 → 进程存活 → 清理还原
#   Linux 宿主：deb 安装 → 关键落点在位 → systemd 单元核对（deb 未带 unit 则如实登记）→ 卸载
#   Android：   APK 安装 → 启动 → 登录页真渲染（uiautomator dump 判据 + 截图原件）
#
# ## 红线
#   · 连接目标（主机/账号/密钥选项）一律经环境变量注入，**仓内不写任何内网地址/账号**；
#     值不落盘、不入日志（ssh 输出里的远端提示符由对方决定，本脚本不回显任何注入值）。
#   · 某腿环境不可达 = BLOCKED（如实登记原因），**不算 PASS 也不算 FAIL**；
#     未被显式 --ack-blocked 确认的 BLOCKED 使整体退出码为 2。
#   · 清理：每条腿结束恢复安装前状态（L2_KEEP=1 跳过清理，供排障，结果里注明）。
#
# ## 用法
#   scripts/linux/l2-install-smoke.sh --artifact-dir <目录> [--out <证据目录>]
#       [--platforms linux,android,mac,win]      # 默认全四腿
#       [--ack-blocked win]                       # 显式确认某腿 BLOCKED 可接受（决策留档）
#   产物发现（目录内按命名约定）：*_x64-setup.exe / *.deb / *.apk /
#       *_aarch64.app.tar.gz（macOS 腿用 .app.tar.gz，字节同 DMG 且解包可靠）
#   也可逐腿显式指定：--win <exe> --mac <tar.gz> --linux <deb> --android <apk>
#
# ## 环境变量（连接注入，无默认值）
#   L2_WIN_HOST / L2_WIN_SSH_OPTS      Windows 腿 ssh 目标与附加参数
#   L2_MAC_HOST / L2_MAC_SSH_OPTS      macOS 腿 ssh 目标与附加参数
#   L2_ANDROID_SERIAL                  adb 序列号（默认自动取第一台 device）
#   L2_ANDROID_SDK                     adb 所在 SDK（默认 /opt/android-sdk）
#   L2_KEEP=1                          保留安装现场（排障用）
#
# ## 退出码
#   0 = 所有**已尝试**的腿 PASS（BLOCKED 腿均已 ack）
#   1 = 任一腿 FAIL
#   2 = 存在未 ack 的 BLOCKED（环境不齐，不许冒充通过）

set -u

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; GRAY='\033[0;90m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTDIR="" ; OUTDIR="./l2-smoke-evidence" ; ACK_BLOCKED="${L2_ACK_BLOCKED:-}"
PLATFORMS="linux,android,mac,win"
WIN_PKG="" ; MAC_PKG="" ; LINUX_PKG="" ; ANDROID_PKG=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --artifact-dir) ARTDIR="$2"; shift 2 ;;
        --out) OUTDIR="$2"; shift 2 ;;
        --platforms) PLATFORMS="$2"; shift 2 ;;
        --ack-blocked) ACK_BLOCKED="$ACK_BLOCKED,$2"; shift 2 ;;
        --win) WIN_PKG="$2"; shift 2 ;;
        --mac) MAC_PKG="$2"; shift 2 ;;
        --linux) LINUX_PKG="$2"; shift 2 ;;
        --android) ANDROID_PKG="$2"; shift 2 ;;
        -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo -e "${RED}未知参数: $1${NC}" >&2; exit 1 ;;
    esac
done
mkdir -p "$OUTDIR"

declare -a RESULT_IDS=() RESULT_STATES=() RESULT_NOTES=()
note_result() {  # $1=id $2=PASS|FAIL|BLOCKED $3=说明
    RESULT_IDS+=("$1"); RESULT_STATES+=("$2"); RESULT_NOTES+=("$3")
    case "$2" in
        PASS)    echo -e "  ${GREEN}✓ [$1] PASS — $3${NC}" ;;
        FAIL)    echo -e "  ${RED}✗ [$1] FAIL — $3${NC}" ;;
        BLOCKED) echo -e "  ${YELLOW}⚠ [$1] BLOCKED — $3${NC}" ;;
    esac
}
have_leg() { [[ ",$PLATFORMS," == *",$1,"* ]]; }
ssh_run() {  # $1=host  其余=远端命令；注入值不回显
    local host="$1"; shift
    local opts=(-o BatchMode=yes -o ConnectTimeout=12)
    [[ -n "${L2_MAC_SSH_OPTS:-}" && "$host" == "$L2_MAC_HOST" ]] && read -ra extra <<< "$L2_MAC_SSH_OPTS" && opts+=("${extra[@]}")
    [[ -n "${L2_WIN_SSH_OPTS:-}" && "$host" == "$L2_WIN_HOST" ]] && read -ra extra <<< "$L2_WIN_SSH_OPTS" && opts+=("${extra[@]}")
    ssh "${opts[@]}" "$host" "$@"
}
pick() {  # $1=dir $2=glob → 最旧优先稳定选择
    local hits=( "$1"/$2 )
    [[ ${#hits[@]} -gt 0 && -f "${hits[0]}" ]] && { printf '%s' "${hits[0]}"; return 0; }
    return 1
}

# ============================================
# Linux 宿主腿（本机 deb 安装）
# ============================================
if have_leg linux; then
    echo -e "${CYAN}L2 ▶ linux：deb 安装 → 关键落点 → systemd 单元核对 → 卸载${NC}"
    pkg="$LINUX_PKG"
    [[ -z "$pkg" && -n "$ARTDIR" ]] && pkg=$(pick "$ARTDIR" '*.deb') || true
    if [[ -z "$pkg" || ! -f "$pkg" ]]; then
        note_result linux BLOCKED "无可用 deb（--linux 或 --artifact-dir 内 *.deb）"
    elif [[ ! -w /var/lib/dpkg || ! -d /var/lib/dpkg ]] && ! touch /var/lib/dpkg/.l2wtest 2>/dev/null; then
        # 卡口径「deb 安装→systemd 单元→进程存活」在本容器物理不可执行：
        #   · /var/lib/dpkg 只读 → dpkg 无法注册（私根全量安装亦被 bwrap chown 限制判死，实测）；
        #   · PID1=bwrap（非 systemd）→ systemctl 加载无从谈起；
        #   · 主程序需 GUI/webkit，headless 容器无法拉起进程。
        # 按卡授权走「不可用项登记原因」路径：BLOCKED 登记 + 附私根载荷核对作补充参考（不计 PASS）。
        rm -f /var/lib/dpkg/.l2wtest 2>/dev/null
        L2ROOT="$OUTDIR/l2root"; rm -rf "$L2ROOT"; mkdir -p "$L2ROOT"
        LLOG="$OUTDIR/linux-private-root.log"
        set -o pipefail
        if dpkg-deb --fsys-tarfile "$pkg" 2>"$LLOG" | tar --no-same-owner -x -C "$L2ROOT" 2>>"$LLOG"; then
            APPBIN=$(find "$L2ROOT" -type f -name 'huanvae-chat-app' 2>/dev/null | head -1)
            GUARDDIR=$(find "$L2ROOT" -type d -name 'HuanvaeGuard' 2>/dev/null | head -1)
            SUP="补充参考（不计 PASS）：私根载荷核对 "
            [[ -n "$APPBIN" && -x "$APPBIN" ]] && SUP+="主程序在位可执行($(stat -c%s "$APPBIN")B); " || SUP+="主程序缺失; "
            [[ -n "$GUARDDIR" ]] && ls "$GUARDDIR"/ >/dev/null 2>&1 && SUP+="guard 件: $(cd "$GUARDDIR" && ls | tr '\n' ' '); " || SUP+="guard 目录缺失; "
            note_result linux BLOCKED "卡口径三判据（deb 安装/systemd 单元/进程存活）本容器物理不可执行（PID1=$(ps -p 1 -o comm= 2>/dev/null)，/var/lib/dpkg 与 / 只读，私根 dpkg 安装被 chown 限制判死）——需可写 Linux 宿主原样实跑。$SUP"
        else
            note_result linux BLOCKED "卡口径三判据本容器物理不可执行（同上）；且私根解包失败（$LLOG）"
        fi
        set +o pipefail
    else
        rm -f /var/lib/dpkg/.l2wtest 2>/dev/null
        echo "  安装 $(basename "$pkg")"
        L2LOG="$OUTDIR/linux-install.log"
        if dpkg -i "$pkg" >"$L2LOG" 2>&1; then
            : 
        else
            # 依赖缺失时按 deb 惯例补依赖再装一次（仍失败才 FAIL）
            if command -v apt-get >/dev/null 2>&1; then
                apt-get -f install -y >>"$L2LOG" 2>&1 && dpkg -i "$pkg" >>"$L2LOG" 2>&1 || true
            fi
        fi
        if ! dpkg -s huanvae-chat >/dev/null 2>&1 && ! dpkg -s huanvae-chat-app >/dev/null 2>&1; then
            note_result linux FAIL "dpkg -i 后包未处于已安装状态（详见 $L2LOG 末尾）"
            tail -5 "$L2LOG" | sed 's/^/    /'
        else
            PKGNAME=$(dpkg -l | awk '/^ii/ && ($2=="huanvae-chat"||$2=="huanvae-chat-app"){print $2}' | head -1)
            APPBIN=$(dpkg -L "$PKGNAME" 2>/dev/null | grep -E '/huanvae-chat-app$' | head -1)
            GUARDDIR=$(dpkg -L "$PKGNAME" 2>/dev/null | grep -E 'HuanvaeGuard/huanvaeguard-svc\.exe$' | head -1)
            [[ -n "$APPBIN" && -x "$APPBIN" ]] \
                && note_result linux PASS "deb 安装完成，主程序在位可执行: $APPBIN" \
                || note_result linux FAIL "deb 安装完成但主程序缺失/不可执行 (dpkg -L $PKGNAME)"
            [[ -n "$GUARDDIR" ]] && echo "  · guard 件随包落点: $GUARDDIR"
            # systemd 单元核对（判据=真实状态，不预设）
            if systemctl list-unit-files 2>/dev/null | grep -qi huanvae; then
                systemctl list-unit-files 2>/dev/null | grep -i huanvae | sed 's/^/    unit: /'
                note_result linux PASS "systemd 单元存在（见上）"
            else
                echo -e "  ${YELLOW}⚠ REGISTER: $(dpkg-deb -f "$pkg" Version 2>/dev/null) 的 deb 未携带任何 systemd 单元（dpkg -L 全量核对）——L2 卡口径里的「systemd 单元→进程存活」在当前包形态下物理不可执行，此缺口登记上报，不冒充通过${NC}"
            fi
            if [[ "${L2_KEEP:-0}" != "1" ]]; then
                dpkg -r "$PKGNAME" >>"$L2LOG" 2>&1 \
                    && echo "  · 清理: dpkg -r $PKGNAME 完成" \
                    || echo -e "  ${YELLOW}⚠ 清理失败（$L2LOG）${NC}"
            else
                echo "  · L2_KEEP=1 保留安装现场（未卸载）"
            fi
        fi
    fi
fi

# ============================================
# Android 腿（模拟器/真机 APK 安装 → 启动 → 登录页真渲染）
# ============================================
if have_leg android; then
    echo -e "${CYAN}L2 ▶ android：APK 安装 → 启动 → 登录页真渲染（截图+uiautomator 双证据）${NC}"
    ADB="${L2_ANDROID_SDK:-/opt/android-sdk}/platform-tools/adb"
    [[ -x "$ADB" ]] || ADB=$(command -v adb || echo adb)
    pkg="$ANDROID_PKG"
    [[ -z "$pkg" && -n "$ARTDIR" ]] && pkg=$(pick "$ARTDIR" '*.apk') || true
    SERIAL="${L2_ANDROID_SERIAL:-}"
    if [[ -z "$SERIAL" ]]; then
        SERIAL=$("$ADB" devices 2>/dev/null | awk '$2=="device"{print $1; exit}')
    fi
    if [[ -z "$SERIAL" ]]; then
        note_result android BLOCKED "adb 无在线 device（$("$ADB" devices 2>/dev/null | tail -n +2 | tr '\n' ' ')）"
    elif [[ -z "$pkg" || ! -f "$pkg" ]]; then
        note_result android BLOCKED "无可用 APK（--android 或 --artifact-dir 内 *.apk）"
    else
        A="\"$ADB\" -s $SERIAL"; A="$ADB -s $SERIAL"
        echo "  设备 $SERIAL ← $(basename "$pkg")"
        ADBSH() { "$ADB" -s "$SERIAL" shell "$@"; }
        INSTALL_OK=0; LAUNCH_DESC=""; RENDER="no"; RENDER_NOTE=""
        # 装前先卸旧：渠道自更新可能已在设备上装了更高 versionCode（实测发生过：
        # 应用内更新器把 v1.1.48 实装到模拟器，debug 包 1001046 装不过去=降级拒绝）
        OLD=$(ADBSH pm list packages 2>/dev/null | sed -n 's/^package:\(.*huanvae[^ ]*\)$/\1/p' | head -1)
        [[ -n "$OLD" ]] && { ADBSH pm uninstall "$OLD" >/dev/null 2>&1; echo "  · 装前卸旧: pm uninstall $OLD"; }
        if "$ADB" -s "$SERIAL" install -r "$pkg" >"$OUTDIR/android-install.log" 2>&1; then
            INSTALL_OK=1
            echo "  · APK 安装成功（$OUTDIR/android-install.log）"
            PKGID=$(ADBSH pm list packages 2>/dev/null | sed -n 's/^package:\(.*huanvae[^ ]*\)$/\1/p' | head -1)
            if [[ -z "$PKGID" ]]; then
                RENDER_NOTE="安装后 pm list packages 找不到 huanvae 包名"
            else
                # 复位到未登录态：登录页判据的前提（残留会话会让 App 直达主页）
                ADBSH pm clear "$PKGID" >/dev/null 2>&1
                echo "  · pm clear $PKGID（复位到未登录态）"
                echo "  启动 $PKGID（monkey LAUNCHER）"
                ADBSH monkey -p "$PKGID" -c android.intent.category.LAUNCHER 1 >"$OUTDIR/android-am-start.log" 2>&1
                LAUNCH_DESC="monkey 启动日志 $OUTDIR/android-am-start.log"
                SHOT="$OUTDIR/android-login-page.png"
                # WebView（Tauri）可访问性树就绪有延迟：轮询重试 dump，命中后落最终截图
                RENDER="no"; RENDER_NOTE=""
                for attempt in 1 2 3 4 5 6; do
                    sleep 6
                    ADBSH uiautomator dump /sdcard/l2ui.xml >/dev/null 2>&1
                    "$ADB" -s "$SERIAL" pull /sdcard/l2ui.xml "$OUTDIR/android-ui.xml" >/dev/null 2>&1
                    ADBSH rm -f /sdcard/l2ui.xml >/dev/null 2>&1
                    if [[ -s "$OUTDIR/android-ui.xml" ]] \
                        && grep -aoE 'text="(登陆|登录)"' "$OUTDIR/android-ui.xml" | grep -q . \
                        && grep -aoE 'class="android\.widget\.EditText"' "$OUTDIR/android-ui.xml" | grep -q .; then
                        RENDER="yes"
                        RENDER_NOTE="uiautomator 命中精确登陆节点+输入框（第${attempt}次轮询）"
                        "$ADB" -s "$SERIAL" exec-out screencap -p > "$SHOT" 2>/dev/null
                        break
                    fi
                done
                # 🔴 判据必须排除「退出登录」这类主页节点的子串误命中，且要兼容「登陆/登录」
                #   两种文案（实机 ui.xml 证实本 App 用「登陆」）：
                #   登录页 = 精确 text="登陆|登录" 节点 + 输入框（EditText）节点，两者同屏
                if [[ "$RENDER" != "yes" ]]; then
                    # 判据未中：落末次画面供人工判读（真页面在屏与否以截图原件为准）
                    "$ADB" -s "$SERIAL" exec-out screencap -p > "$SHOT" 2>/dev/null
                    if [[ -s "$OUTDIR/android-ui.xml" ]] \
                        && grep -aoE 'text="(消息|通讯录|退出登录|退出登陆)"' "$OUTDIR/android-ui.xml" | grep -q .; then
                        RENDER_NOTE="当前是已登录主页（消息/通讯录节点在屏）——非登录页，判据不成立"
                    else
                        RENDER_NOTE="六次轮询 ui.xml 均无登录表单命中（WebView 可访问性树未暴露？）；截图 ${SHOT} 供人工判读"
                    fi
                fi
            fi
        else
            RENDER_NOTE="APK 安装失败（$OUTDIR/android-install.log: $(tail -1 "$OUTDIR/android-install.log")）"
        fi
        if [[ $INSTALL_OK -eq 1 && "$RENDER" == "yes" && -s "${SHOT:-}" ]]; then
            note_result android PASS "安装→启动→登录页真渲染成立（$RENDER_NOTE；截图原件 ${SHOT} $(stat -c%s "$SHOT") 字节）"
        elif [[ $INSTALL_OK -eq 1 ]]; then
            note_result android FAIL "安装成功但登录页渲染判据未成立：$RENDER_NOTE；截图 $([ -s "${SHOT:-}" ] && echo "存在 ${SHOT}" || echo 缺失)"
        else
            note_result android FAIL "$RENDER_NOTE"
        fi
        if [[ $INSTALL_OK -eq 1 && "${L2_KEEP:-0}" != "1" && -n "${PKGID:-}" ]]; then
            ADBSH pm uninstall "$PKGID" >/dev/null 2>&1 && echo "  · 清理: pm uninstall $PKGID"
        fi
    fi
fi

# ============================================
# macOS VM 腿（.app 安装 → LaunchDaemon 加载 → 进程存活 → 还原）
# ============================================
if have_leg mac; then
    echo -e "${CYAN}L2 ▶ mac：.app 安装 → LaunchDaemon 加载 → 进程存活 → 清理还原${NC}"
    pkg="$MAC_PKG"
    [[ -z "$pkg" && -n "$ARTDIR" ]] && pkg=$(pick "$ARTDIR" '*aarch64.app.tar.gz'); [[ -z "$pkg" ]] && pkg=$(pick "$ARTDIR" '*.app.tar.gz') || true
    if [[ -z "${L2_MAC_HOST:-}" ]]; then
        note_result mac BLOCKED "未注入 L2_MAC_HOST（连接目标经环境变量注入，仓内不落盘）"
    elif [[ -z "$pkg" || ! -f "$pkg" ]]; then
        note_result mac BLOCKED "无可用 .app.tar.gz（--mac 或 --artifact-dir）"
    else
        if ! ssh_run "$L2_MAC_HOST" 'uname -s' >/dev/null 2>&1; then
            note_result mac BLOCKED "ssh 不可达（BatchMode；检查密钥/网络）"
        else
            REMOTE_DIR="l2smoke.$$"
            scp -o BatchMode=yes -o ConnectTimeout=12 "$pkg" "$L2_MAC_HOST:/tmp/$REMOTE_DIR.tar.gz" >/dev/null 2>&1
            SCP_RC=$?
            [[ $SCP_RC -ne 0 ]] && { note_result mac FAIL "scp 上传失败（rc=$SCP_RC）"; }
            if [[ $SCP_RC -eq 0 ]] && ssh_run "$L2_MAC_HOST" "test -f /tmp/$REMOTE_DIR.tar.gz"; then
                MLOG="$OUTDIR/mac-install.log"
                ssh_run "$L2_MAC_HOST" REMOTE_DIR="$REMOTE_DIR" bash -s >"$MLOG" 2>&1 <<'MAC_EOF'
set -u
rm -rf "/tmp/$REMOTE_DIR" && mkdir -p "/tmp/$REMOTE_DIR"
tar xzf "/tmp/$REMOTE_DIR.tar.gz" -C "/tmp/$REMOTE_DIR" || { echo "FAIL tar"; exit 1; }
APP=$(find "/tmp/$REMOTE_DIR" -maxdepth 2 -name '*.app' -type d | head -1)
[ -n "$APP" ] || { echo "FAIL no .app"; exit 1; }
echo "APP=$APP"
GDIR="$APP/Contents/Resources/HuanvaeGuard-macos"
for f in hg-macos com.huanvaeguard.daemon.plist; do
    if [ -s "$GDIR/$f" ]; then echo "OK bundle: $f ($(stat -f%z "$GDIR/$f") bytes)"
    else echo "FAIL bundle missing: $f"; exit 1; fi
done
# 真安装：daemon + plist 进系统位（先备份既有件，结束还原）
PRESENT=0
mkdir -p /Library/PrivilegedHelperTools || { echo "FAIL mkdir PrivilegedHelperTools"; exit 1; }
[ -f /Library/PrivilegedHelperTools/hg-macos ] && { PRESENT=1; cp -p /Library/PrivilegedHelperTools/hg-macos /tmp/l2-backup-hg-macos.$$; }
cp "$GDIR/hg-macos" /Library/PrivilegedHelperTools/hg-macos || { echo "FAIL cp daemon"; exit 1; }
# 渲染 plist 占位符（与 App 安装行为同源：huanvaeguard_macos.rs render_plist ——
# 发货件是模板，直接装未渲染件会带 __HG_*__ 字面量参数启动即退 exit 2，实测踩过）
sed -e 's/__HG_INSTANCE__/l2smoke/' -e 's|__HG_API_LISTEN__|127.0.0.1:19198|' \
    "$GDIR/com.huanvaeguard.daemon.plist" > /Library/LaunchDaemons/com.huanvaeguard.daemon.plist \
    || { echo "FAIL render plist"; exit 1; }
grep -q '__HG_' /Library/LaunchDaemons/com.huanvaeguard.daemon.plist && { echo "FAIL render leftover placeholder"; exit 1; }
chmod 755 /Library/PrivilegedHelperTools/hg-macos
launchctl unload /Library/LaunchDaemons/com.huanvaeguard.daemon.plist >/dev/null 2>&1
launchctl load /Library/LaunchDaemons/com.huanvaeguard.daemon.plist || { echo "FAIL launchctl load"; exit 1; }
sleep 6
if pgrep -f 'hg-macos' >/dev/null 2>&1; then
    echo "OK process alive: $(pgrep -l -f 'hg-macos' | head -2)"
    l1=$(launchctl print system/com.huanvaeguard.daemon 2>/dev/null | grep -E 'state|pid =' | head -2)
    [ -n "$l1" ] && echo "launchctl: $l1"
    echo "SMOKE_PASS"
else
    echo "FAIL process not alive; launchctl print: $(launchctl print system/com.huanvaeguard.daemon 2>/dev/null | grep -E 'last exit code|state =' | head -2 | tr '\n' ' ')"
    echo "FAIL stderr 日志: $(tail -3 /var/log/huanvaeguard/launchd-stderr.log 2>/dev/null | tr '\n' ' ')"
    echo "SMOKE_FAIL"
fi
# 还原/清理
launchctl unload /Library/LaunchDaemons/com.huanvaeguard.daemon.plist >/dev/null 2>&1
if [ "$PRESENT" = "1" ]; then mv /tmp/l2-backup-hg-macos.$$ /Library/PrivilegedHelperTools/hg-macos; else rm -f /Library/PrivilegedHelperTools/hg-macos; fi
rm -f /Library/LaunchDaemons/com.huanvaeguard.daemon.plist
rm -rf "/tmp/$REMOTE_DIR" "/tmp/$REMOTE_DIR.tar.gz"
echo "CLEANED"
MAC_EOF
                if grep -q SMOKE_PASS "$MLOG"; then
                    note_result mac PASS "daemon 安装+launchctl 加载+进程存活全过（$MLOG）；$(grep -q CLEANED "$MLOG" && echo '现场已还原' || echo '⚠ 现场未完全清理')"
                else
                    note_result mac FAIL "smoke 判据未过（$MLOG 末尾：$(tail -3 "$MLOG" | tr '\n' ' ')）"
                fi
            else
                note_result mac FAIL "上传后远端未收到文件"
            fi
        fi
    fi
fi

# ============================================
# Windows VM 腿（静默安装 → sc start=0 → RUNNING → 卸载 → 残留检查）
# ============================================
if have_leg win; then
    echo -e "${CYAN}L2 ▶ win：静默安装 → sc start HuanvaeGuard=0 → RUNNING → 卸载 → 残留检查${NC}"
    pkg="$WIN_PKG"
    [[ -z "$pkg" && -n "$ARTDIR" ]] && pkg=$(pick "$ARTDIR" '*x64-setup.exe') || true
    if [[ -z "${L2_WIN_HOST:-}" ]]; then
        note_result win BLOCKED "未注入 L2_WIN_HOST（连接目标经环境变量注入，仓内不落盘）"
    elif [[ -z "$pkg" || ! -f "$pkg" ]]; then
        note_result win BLOCKED "无可用 NSIS 安装包（--win 或 --artifact-dir 内 *x64-setup.exe）"
    else
        if ! ssh_run "$L2_WIN_HOST" 'echo ok' >/dev/null 2>&1; then
            note_result win BLOCKED "ssh 不可达/认证失败（BatchMode；检查凭据注入；本机实测可用 -i /root/.ssh/id_ed25519；注意 VM 默认 shell 是 PowerShell，探针勿用 cmd 内建如 ver）"
        else
            WLOG="$OUTDIR/win-install.log"
            WOPTS=(-o BatchMode=yes -o ConnectTimeout=12)
            [[ -n "${L2_WIN_SSH_OPTS:-}" ]] && read -ra wextra <<< "$L2_WIN_SSH_OPTS" && WOPTS+=("${wextra[@]}")
            # 远端动作收拢为一个 bat（避免 ssh 单行转义地狱），scp 上传后执行，输出整体回取
            BAT="$OUTDIR/l2win-leg.bat"
            cat > "$BAT" <<'BAT_EOF'
@echo off
setlocal enabledelayedexpansion
echo ===L2WIN BEGIN===
echo [pre] current state:
sc query HuanvaeGuard 2>nul | findstr /i "STATE"
echo [1] silent install C:\l2smoke-setup.exe /S
C:\l2smoke-setup.exe /S
set FOUND=
for /l %%i in (1,1,45) do ( 
  if not defined FOUND ( 
    ping -n 3 127.0.0.1 >nul
    sc query HuanvaeGuard >nul 2>&1 && set FOUND=1
  ) 
)
if not defined FOUND ( echo FAIL service never appeared after install & exit /b 1 )
echo OK service exists after install
sc query HuanvaeGuard 2>nul | findstr /i "STATE"
echo [sc-cycle] installer auto-started the service; stopping it so the card-mandated literal "sc start HuanvaeGuard=0" can be exercised on the real SCM start path (stop is mere test-preparation; the start below is the same code path as a cold boot and will expose the known start-race crash just the same)
sc stop HuanvaeGuard >nul 2>&1
set STOPPED=
for /l %%i in (1,1,20) do ( 
  if not defined STOPPED ( 
    ping -n 3 127.0.0.1 >nul
    sc query HuanvaeGuard 2>nul | findstr /i "STOPPED" >nul && set STOPPED=1
  ) 
)
if not defined STOPPED echo WARN service not reached STOPPED within wait window
sc query HuanvaeGuard 2>nul | findstr /i "STATE"
set START_RC=
sc start HuanvaeGuard >nul 2>&1
set START_RC=!errorlevel!
echo [sc start] rc=!START_RC!  (card criterion: rc=0)
if not "!START_RC!"=="0" goto start_failed
set RUN=
for /l %%a in (1,1,3) do ( 
  if not defined RUN (
    ping -n 8 127.0.0.1 >nul
    sc query HuanvaeGuard 2>nul | findstr /i "RUNNING" >nul && set RUN=1
  ) 
)
if defined RUN goto start_ok
echo FAIL sc start rc=0 but service not RUNNING afterwards
goto start_failed
:start_failed
echo FAIL literal card criterion "sc start HuanvaeGuard=0" not met —— diagnostic product-standard repair flow follows (hooks.nsi MessageBox guidance: stop→delete→create→sdset→start); per verdict discipline repair NEVER flips this leg to PASS
set REPAIRED=1
call :dorepair
if defined RUN goto start_ok_repair1
call :dorepair
if defined RUN goto start_ok_repair2
call :dorepair
if not defined RUN goto forensic
echo OK service RUNNING after product-standard repair round 3
goto start_ok
:start_ok_repair1
echo OK service RUNNING after product-standard repair round 1
goto start_ok
:start_ok_repair2
echo OK service RUNNING after product-standard repair round 2
:start_ok
echo OK service RUNNING
goto after_svc
:dorepair
sc stop HuanvaeGuard >nul 2>&1
sc delete HuanvaeGuard >nul 2>&1
ping -n 6 127.0.0.1 >nul
powershell -NoProfile -Command "New-Service -Name HuanvaeGuard -BinaryPathName ('\"' + 'C:\Program Files\Huanvae-Chat-App\HuanvaeGuard\huanvaeguard-svc.exe' + '\"') -DisplayName 'HuanvaeGuard VPN Service' -StartupType Manual | Out-Null"
sc sdset HuanvaeGuard "D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)(A;;CCLCSWRPWPLOCRRC;;;AU)" >nul 2>&1
sc start HuanvaeGuard >nul 2>&1
ping -n 21 127.0.0.1 >nul
sc query HuanvaeGuard 2>nul | findstr /i "RUNNING" >nul && set RUN=1
goto :eof
:after_svc
tasklist | findstr /i "HuanvaeGuard" >nul
if errorlevel 1 ( echo FAIL guard process not found in tasklist & goto forensic )
for /f "tokens=1" %%p in ('tasklist ^| findstr /i "HuanvaeGuard"') do echo OK process alive: %%p
if defined REPAIRED (echo L2WIN_REPAIRED) else (echo L2WIN_NATIVE)
echo [2] silent uninstall
taskkill /f /im huanvae-chat-app.exe >nul 2>&1
taskkill /f /im huanvaeguard-svc.exe >nul 2>&1
set UNINS=
for /d %%d in ("C:\Program Files\Huanvae*") do @if exist "%%~fd\uninstall.exe" set "UNINS=%%~fd\uninstall.exe"
if not defined UNINS ( echo FAIL uninstaller not found & goto forensic )
echo uninstaller: !UNINS!
"!UNINS!" /S
set GONE=
for /l %%i in (1,1,45) do ( 
  if not defined GONE ( 
    ping -n 3 127.0.0.1 >nul
    sc query HuanvaeGuard >nul 2>&1 || set GONE=1
  ) 
)
if not defined GONE ( echo FAIL service still exists after uninstall & goto forensic )
echo OK service removed
ping -n 4 127.0.0.1 >nul
echo [3] leftover check (service/dir/process, should show 1060/not-exist/empty):
sc query HuanvaeGuard 2>&1 | findstr /i "1060"
sc query HuanvaeGuard 2>&1 | findstr /C:"specified service does not exist"
dir /b "C:\Program Files\Huanvae*" 2>nul
tasklist | findstr /i "Huanvae" 2>nul
echo [4] restore original state (reinstall + start + relaunch app):
C:\l2smoke-setup.exe /S
set F2=
for /l %%a in (1,1,3) do ( 
  if not defined F2 (
    sc start HuanvaeGuard >nul 2>&1
    ping -n 16 127.0.0.1 >nul
    sc query HuanvaeGuard 2>nul | findstr /i "RUNNING" >nul && set F2=1
  ) 
)
if defined F2 ( echo OK restored service RUNNING ) else ( echo RESTORE service not RUNNING & sc query HuanvaeGuard 2>nul | findstr /i "STATE" )
start "" "C:\Program Files\Huanvae-Chat-App\huanvae-chat-app.exe" >nul 2>&1
del "C:\l2smoke-setup.exe" >nul 2>&1
echo L2WIN-DONE
goto :eof
:forensic
echo [forensic] service start-failure forensics:
echo --- WER crashes (huanvaeguard) count ---
powershell -NoProfile -Command "(Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000} -ErrorAction SilentlyContinue | Where-Object { $_.Message -match 'huanvaeguard' } | Measure-Object).Count"
echo --- latest crash detail ---
powershell -NoProfile -Command "Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000} -ErrorAction SilentlyContinue | Where-Object { $_.Message -match 'huanvaeguard' } | Select-Object -First 1 | ForEach-Object { $_.TimeCreated; $_.Message.Substring(0,[Math]::Min(500,$_.Message.Length)) }"
echo --- SCM recent (last 8) ---
powershell -NoProfile -Command "Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Service Control Manager'} -MaxEvents 60 -ErrorAction SilentlyContinue | Where-Object { $_.Message -match 'HuanvaeGuard' } | Select-Object -First 8 | ForEach-Object { $_.TimeCreated; ($_.Message -replace \"`r`n\",' ').Substring(0,[Math]::Min(140,($_.Message -replace \"`r`n\",' ').Length)) }"
echo --- binary hashes ---
certutil -hashfile "C:\Program Files\Huanvae-Chat-App\HuanvaeGuard\huanvaeguard-svc.exe" SHA256 | findstr /v /i "hash certutil"
echo [restore-after-fail] still restore app state:
C:\l2smoke-setup.exe /S
start "" "C:\Program Files\Huanvae-Chat-App\huanvae-chat-app.exe" >nul 2>&1
del "C:\l2smoke-setup.exe" >nul 2>&1
echo L2WIN-DONE-FAIL
BAT_EOF
            scp "${WOPTS[@]}" "$pkg" "$L2_WIN_HOST:C:/l2smoke-setup.exe" >>"$WLOG" 2>&1 \
                && scp "${WOPTS[@]}" "$BAT" "$L2_WIN_HOST:C:/l2win-leg.bat" >>"$WLOG" 2>&1 || { note_result win FAIL "scp 上传安装包/腿脚本失败（$WLOG）"; }
            ssh_run "$L2_WIN_HOST" 'C:\l2win-leg.bat' >"$OUTDIR/win-leg-output.txt" 2>&1
            RC=$?
            grep -aE '^\[|^OK|^FAIL|rc=|BEGIN|DONE|STATE|uninstaller|process alive|1060|not exist|REPAIRED|NATIVE' "$OUTDIR/win-leg-output.txt" | head -30 | sed 's/^/    /'
            if grep -aq '^L2WIN-DONE-FAIL' "$OUTDIR/win-leg-output.txt" || grep -aq '^FAIL' "$OUTDIR/win-leg-output.txt"; then
                if grep -aq '^L2WIN_REPAIRED' "$OUTDIR/win-leg-output.txt"; then
                    note_result win FAIL "装后 sc start≠0/服务未 RUNNING，产品标准修复流后恢复 RUNNING——按卡口径「静默安装→sc start→服务运行」原样实跑仍判 FAIL；修复细节留证 $OUTDIR/win-leg-output.txt（需修 daemon 启动竞态后才能过）"
                else
                    note_result win FAIL "远端腿未全过：静默安装/服务 RUNNING/进程存活/卸载残留 至少一项不成立（取证已入 $OUTDIR/win-leg-output.txt）"
                fi
            elif grep -aq '^L2WIN_REPAIRED' "$OUTDIR/win-leg-output.txt"; then
                note_result win FAIL "卸载/残留/进程腿有成立但装后启动系修复流达成（L2WIN_REPAIRED）——按卡口径原样实跑判 FAIL，非原样 PASS（输出 $OUTDIR/win-leg-output.txt）"
            elif grep -aq '^L2WIN-DONE' "$OUTDIR/win-leg-output.txt" \
               && grep -aq '^L2WIN_NATIVE' "$OUTDIR/win-leg-output.txt" \
               && grep -aq 'OK service RUNNING' "$OUTDIR/win-leg-output.txt" && grep -aq 'OK service removed' "$OUTDIR/win-leg-output.txt" \
               && grep -aq 'OK process alive' "$OUTDIR/win-leg-output.txt"; then
                note_result win PASS "卡口径字面全过：静默安装→sc stop 让路→sc start HuanvaeGuard rc=0（字面判据，真实 SCM 启动路径）→服务 RUNNING→进程存活→卸载→残留检查（1060/目录空）→原态还原，全程无修复兜底（L2WIN_NATIVE；输出 $OUTDIR/win-leg-output.txt）"
            else
                note_result win FAIL "远端腿脚本未全过（rc=$RC；输出 $OUTDIR/win-leg-output.txt）"
            fi
        fi
    fi
fi

# ============================================
# 汇总
# ============================================
echo ""
echo -e "${CYAN}── L2 汇总 ──${NC}"
FAILS=0; BLOCKS=0; PASSES=0
for i in "${!RESULT_IDS[@]}"; do
    case "${RESULT_STATES[$i]}" in
        PASS) PASSES=$((PASSES+1)); echo -e "  ${GREEN}✓ ${RESULT_IDS[$i]}: PASS${NC}" ;;
        FAIL) FAILS=$((FAILS+1)); echo -e "  ${RED}✗ ${RESULT_IDS[$i]}: FAIL — ${RESULT_NOTES[$i]}${NC}" ;;
        BLOCKED) BLOCKS=$((BLOCKS+1)); echo -e "  ${YELLOW}⚠ ${RESULT_IDS[$i]}: BLOCKED — ${RESULT_NOTES[$i]}${NC}" ;;
    esac
done
if [[ $FAILS -gt 0 ]]; then
    echo -e "${RED}L2 安装冒烟：FAIL（$FAILS 腿失败）${NC}"; exit 1
fi
UNACKED=()
for i in "${!RESULT_IDS[@]}"; do
    [[ "${RESULT_STATES[$i]}" == "BLOCKED" ]] || continue
    id="${RESULT_IDS[$i]}"
    if ! [[ ",$ACK_BLOCKED," == *",$id,"* ]]; then UNACKED+=("$id"); fi
done
if [[ ${#UNACKED[@]} -gt 0 ]]; then
    echo -e "${YELLOW}L2 安装冒烟：BLOCKED 未确认（${UNACKED[*]}）——环境不齐不许冒充通过；确认可接受则 --ack-blocked ${UNACKED[0]} 并在发布记录留档${NC}"
    exit 2
fi
echo -e "${GREEN}L2 安装冒烟：PASS（真跑 $PASSES 腿；BLOCKED ${BLOCKS} 腿均已 ack 登记）${NC}"
exit 0
