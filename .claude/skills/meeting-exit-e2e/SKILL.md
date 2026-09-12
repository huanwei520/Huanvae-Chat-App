---
name: meeting-exit-e2e
description: 桌面会议窗关窗离会信令闭环与发送侧实证配方 — 无窗口管理器环境下 xdotool windowclose 退化为 XDestroyWindow 炸进程（Gdk X 错误 +3ms 整进程退出、服务端只见 TCP RST、前端钩子从未执行）的假关窗判定与 ICCCM WM_DELETE_WINDOW 真实关窗替代、Tauri CloseRequested 拦截 prevent_close→eval __meetingLeave→延时→destroy 异步时序三落点、WS 客户端帧 RFC6455 掩码致 pcap grep 盲区与去掩码还原、服务端日志措辞三分法（leave INFO / RST / 超时清场）、发送侧三证齐备配方（服务端日志+线路抓包+对端状态变化毫秒级对齐）。要实证「客户端关窗时真实发出了某信令」、桌面 e2e 关窗后服务端只见 Connection reset without closing handshake、或要在 pcap 里找客户端发出的 WS 帧明文时，先读本 skill。
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Write
---

# 会议窗关窗离会信令闭环与发送侧实证

> 来源：块 `1789002902578-4-关窗离会信令补发实证`（2026-09-10：code 层 R1 REJECT 后 R2 judge.jsonl :1 PASS，review 层 :4 PASS；RST 根因由 code 层确诊）。
> 核心教训：历轮把「发送侧代码问题」当嫌疑人，实际是**测试环境让前端钩子从未执行**——发送侧代码（useWebRTC disconnect→sendMessage leave）自始正确，错的是关窗方式。

## 触发场景（命中任一条，先读本 skill）

- 要实证「桌面端关窗/离会时真实发出了某信令」（leave/offline/bye 类）；
- 桌面 e2e 关窗后服务端流水只见 `WebSocket protocol error: Connection reset without closing handshake`（TCP RST）；
- 涉及 Tauri `onCloseRequested` / 窗口关闭拦截 / 关窗前异步发信令的改动；
- 要在 tcpdump pcap 里找客户端发出的 WebSocket 帧明文。

## §1 RST 根因判定：先查关窗方式，别先怀疑发送代码

- **假关窗形态**：测试 X 显示（Xvfb）上通常**没有窗口管理器**。无 WM 时 `xdotool windowclose` 退化为对 X 窗口的裸摧毁（XDestroyWindow）→ GTK 收到致命 X 错误 → **整进程毫秒级退出**，`onCloseRequested`/任何前端钩子都没机会跑，全部 WS 同时 RST。
- **现场签名**：app 日志 `Gdk-WARNING: received an X Window System error` 距 CLOSE_START 仅 **+3ms**；backend 同刻双 WS RST。
- **检测一条命令**：`DISPLAY=:<N> xprop -root _NET_SUPPORTING_WM_CHECK` → `not found` 即无 WM（openbox/mutter/i3 等均不在亦可佐证）。
- **真实关窗替代**：向目标窗直发 ICCCM `WM_DELETE_WINDOW` ClientMessage（= WM 在用户点标题栏 X 时所发之物）→ GTK delete-event → tao/Tauri CloseRequested → 应用层钩子。无 WM 环境下这是**唯一**能触发 GTK delete-event 的方法。发送前先读窗口 `WM_PROTOCOLS` 属性确认支持，不支持则明确报错不留模糊。参考实现：`/work/huanvae-meeting-exit-e2e-1788982832352/wm_delete.py`（python3-xlib），用法 `python3 wm_delete.py <display> <window-id>`。

## §2 闭环三落点（行号为 2026-09-10 工作树值，位移以 grep 现查为准）

| 落点 | 内容 |
|---|---|
| `src-tauri/src/lib.rs:1010-1023` | 拦 `label()=="meeting"` 的 `WindowEvent::CloseRequested`(:1010-1011) → `api.prevent_close()`(:1014) → 后台线程 `eval("window.__meetingLeave && window.__meetingLeave();")`(:1018) → `sleep 600ms`(:1019) → `destroy()`(:1020)。仅 match meeting 窗，主窗托盘（:993-1002）零涉及 |
| `src/meeting/MeetingPage.tsx:535/:544` | `__meetingLeave`(:535) 同步注册调 `webrtc.disconnect()`(:537)；`onCloseRequested`(:544) preventDefault → disconnect → 300ms → 自行 destroy。双路径互备，重复调用由 readyState 守卫去重；卸载清理 `:585-588` |
| `src/meeting/useWebRTC.ts:1645-1650` | `disconnect()` 第一步 `sendMessage({ type: 'leave' })`(:1647) → `cleanup()`(:1649)（内含 ws.close()，**close 排队在 leave 帧之后**——同一 WS 消息队列 FIFO） |

接收侧（对端仓 Huanvae-Chat-Rust）：`src/webrtc_room/handlers/signaling_ws.rs:341-345` `ClientSignaling::Leave` arm 打 INFO「收到客户端主动退出信令(leave)」，room_id/participant_id 取自连接上下文（join 经 URL token 绑定连接，leave 帧无需携带 ID——协议即 `{"type":"leave"}` serde unit variant，与页内「离开」按钮完全同源）。

## §3 时序不变式（改动时破任一条即扩大回归面）

1. **扣住再放**：prevent_close 先扣窗，leave 帧 + WS close 握手真正上线后才 destroy；固定延时兜底（Rust 600ms / JS 300ms）而非精确等待 send 回调——实测 leave 帧关窗后 +42~+51ms 即达服务端（四轮独立实测），裕量约一个数量级。
2. **关窗结果不变**：窗口最终销毁，仅延后 ≤600ms；拦截仅限 `label()=="meeting"`。
3. **协议零新造**：帧即既有 `{"type":"leave"}`，无新消息类型、无新字段。
4. **beforeunload 不可依赖**：Tauri 关窗（标题栏 X/系统关闭）在部分平台不触发，必须有显式 CloseRequested 拦截。
5. **双路径互备**：Rust 原生层 eval 前端钩子 + JS onCloseRequested，任一先到都能发出 leave。

## §4 服务端日志措辞三分法（判据速查）

| 服务端看到的现象 | 含义 |
|---|---|
| `收到客户端主动退出信令(leave)` + `客户端主动关闭连接` | ✅ 主动信令本体收到，正常 WS close 握手 |
| `Connection reset without closing handshake`（RST） | ❌ 前端钩子**未执行**即断链——先查关窗方式/有无 WM（§1），别急着怀疑发送代码 |
| 仅 `参与者已断开连接`（无 leave INFO） | ❌ 只有被动超时清场，无主动信令 |

## §5 发送侧三证实证配方（缺一不可）

「客户端发了 X 信令」单凭一端日志都可能被质疑（客户端日志可伪造、服务端日志可能来自别处），三路独立证据毫秒级对齐才闭合：

1. **服务端接收日志**：Leave arm INFO 原文（含 room_id/participant_id/毫秒时间戳）。读前先 `sed 's/\x1b\[[0-9;]*m//g'` 去终端色码；用 marker 文件记录日志行号/offset 作证据窗口起点。
2. **线路抓包帧原文**（发送方铁证）：`tcpdump -i lo -s 0 -w x.pcap port <信令端口>`。⚠ **WS 客户端帧全帧掩码**（RFC6455）：`tcpdump -A | grep leave` 只能看到 server→client 方向的明文广播（如 `{"type":"peer_left",…}`），客户端帧在 ASCII 里是乱码——grep 不到 ≠ 没发。解法：按帧格式解析（0x81=FIN+text、mask 位/长度扩展、4 字节掩码键）逐字节 XOR 去掩码还原明文（参考 `/work/huanvae-meeting-exit-e2e-1788982832352/decode_ws_pcap.py`，`tcpdump -r x.pcap -x -t | python3 decode_ws_pcap.py`）；复核侧可按掩码键亲手去掩码独立复现。
3. **对端状态变化**（业务效果）：观察端 adb 截屏原件 + CDP 读回页面文本，成员列表 N→N-1 等状态迁移——证明信令确实驱动了房间状态而非只留日志。
- **共享端口抓包**遇并行会话流量：按 TCP 流（src_port）逐一隔离归属，别人的 RST/广播不算到自己头上。
- **构建-行为互证**：源码 mtime 早于运行二进制构建时间 + 该行为只有含新代码的二进制才能产生，双重锁定改动真实性。
- **关窗后回归清单**：进程同 pid 存活（`pgrep -af`）、窗口列表仅剩主窗+托盘、主窗仍保持登录、**关窗后能再次入会**。

## §6 坑速查

| 坑 | 现象 | 解法 |
|---|---|---|
| 无 WM 假关窗 | xdotool windowclose → Gdk X 错误 +3ms 整进程退出、双 WS RST | `wm_delete.py` 发 WM_DELETE_WINDOW（§1） |
| 帧未冲刷即销毁 | 钩子发了 send 但立即 destroy，服务端仍只见 RST | prevent_close → 发送+close 排队 → 300/600ms → destroy（§3） |
| WS 帧掩码盲区 | pcap ASCII grep 不到客户端帧，误判「没发」 | 去掩码解码（§5-2） |
| 空置房间 janitor | 房间清空后 ~2.4min 被 `房间已关闭(空置房间已清理)`，复用旧房号报「房间不存在」 | 跨 cycle 换新房间 |
| cargo test 假回归 | 不带 HG token env 复现 187/5（huanvaeguard key_service 失败） | 显式传 `DATABASE_URL/TURN_AGENT_AUTH_TOKEN/HG_AGENT_TOKEN_SECRET` |

## 相邻 skill

- `forward-echo-e2e`：双机实测时钟口径、CDP 驱动、neutralize 归因、凭据变量法终扫；
- `remote-control-signaling`：useWebRTC 信令 WS 状态机/心跳看门狗/重连决策表（同一发送通道的另一面）；
- `ui-real`：真机 UI 自动化登录/导航/截图取证。
