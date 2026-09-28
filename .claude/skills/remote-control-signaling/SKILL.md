---
name: remote-control-signaling
description: 远控/会议信令链路状态机与重连机制速查——useWebRTC 心跳看门狗/指数退避/两条置错路径、ControlWindow 探活三态机、WebSocketContext 世代守卫、空 token「信令断开」误报根修、0x07 帧面断链自愈闭环（移动控制端拓扑：session-restore 探针+DC 重建+帧泵重拉+停滞置红）、授权免选源（display track 缓存复用）与控制会话建立超时/取消/重试。改信令参数/重连逻辑/帧面恢复，或排查任何「连接类」UI 误报/帧计数冻结/反复弹选源器/建立卡死前必读
disable-model-invocation: false
allowed-tools: Read, Grep, Glob
---

# 远控信令链路状态机与重连机制

> 来源：block `1788964672726-2-统一远控UI并修信令断开` 沉淀（code/review 判官双 PASS，2026-09-09）。
> file:line 为 2026-09-09 工作树实测（嵌套仓 /work/Huanvae-Chat-App HEAD 79ce79a4ee87d0a33522ceebf958adf9c1836529）；共享在飞树上行号会漂，引用前先 grep 现查。
> update 层第 4 次执行已逐条 grep/read 复核全文行号并修正 2 处（状态点 css 行号：绿 :59；getSignalingUrl 归属：meeting/api.ts:288）；第 5 次执行（2026-09-09）第三次全量复核零漂移，全部 file:line/计数的完整 grep/read 原始输出见本块 update/deliverable.md 与 update/evidence/（落点双镜像 landing-*.md 同目录在档，diff 可验逐字节一致）。
> 2026-09-22 块 pleibt4s（部署远控生产并双登录实测，基线 ef8c2b62）追加 §7：M1/M2/M3 实测的登录账号前提、三跳 journal 判读模板、移动端「结束控制」不发 M3 既有缺口、被控端横幅数据面收敛设计。file:line 均为该块 update 层亲跑 grep/sed 原文（worktree ef8c2b62）。
> 2026-09-25 块 rt4p73av（修远控 D4/D5 缺陷并真机复测，交付提交 0db2aed4+c6666aed，分支 fix/rt4p73av-d4d5-rc-resume）追加 §8/§9：移动控制端拓扑断链自愈闭环（§8）、授权免选源与控制会话建立超时/取消/重试（§9）。file:line 均为该块 update 层在 HEAD=c6666aed 工作树亲跑 grep 原文；共享在飞树上行号会漂，引用前先 grep 现查。

## 0. 排查任何「连接类」症状，第一步先分清三条链路

「远控信令断开」这类症状横跨三条**相互独立**的链路，先分清载体再动手——本块核心教训：

| 链路 | 载体 | 传什么 | 状态管理 | 误报案例（本块修复） |
|---|---|---|---|---|
| A. 会议窗信令 WS | `src/meeting/useWebRTC.ts`（发起在 `MeetingPage.tsx`） | 房间 join/offer/answer/ICE/心跳 | `meetingState` 四态（:71） | dev 演示面用空 token 拉起本链路 → 必败 → 「信令连接已断开」横幅常驻，而真正承载功能的主窗链路（C）全程健康 |
| B. 控制 daemon 探活（HTTP，非 ws） | `src/remote-control/ControlWindow.tsx` + `api.ts` | GET /control/status 巡检 + 帧轮询 + input 上行 | `LinkState` 三态机（§2） | 旧实现初值 null 首帧宣「未连接」（初值误报）；单次超时立即翻面（竞态误报） |
| C. 主窗业务 WS | `src/contexts/WebSocketContext.tsx`（远控裁决经 `wsSender.ts` 上行） | 聊天/推送 + 远控裁决 M1/M2/M3 | 世代守卫 + 退避重连 + resume（§3） | 零改动；误报判定反证：横幅常驻时段主窗信令双轮 `approved=true delivered_devices=1` |

**判别式**：看到「XX已断开/未连接」UI，先问「这个功能实际走哪条链路」——去服务端路由日志（如 `control_session_*` 的 `delivered_devices`）核对该链路当下是否健康，别被单一 UI 文案带偏。

## 1. 会议窗信令 WS（useWebRTC.ts）

### 1.1 组件状态与常量

- `MeetingState = 'idle' | 'connecting' | 'connected' | 'error'`（:71）。
- `HEARTBEAT_INTERVAL_MS = 25_000`（:138）ping 周期；`PONG_TIMEOUT_MS = 60_000`（:140）无 pong 判连（≈2 个心跳周期）；`MAX_RECONNECT_ATTEMPTS = 6`（:142，仅 rejoin 路径生效）；`ICE_DISCONNECT_RESTART_MS = 3_000`（:144）。
- `RejoinFn`（:131）：重连回调类型，`Promise<{ token, iceServers } | null>`。

### 1.2 心跳与看门狗（onopen 内，:1491-1503）

每 25s：先查 readyState → 再查 `isPongExpired(lastPongAt, now, 60s)`（webrtcCore.ts:103-105）→ 超时置 `pongTimedOut = true` 并**主动 `ws.close()`**（:1497-1500）；否则发 `{type:'ping'}`（:1502）。`pong` 消息刷新 `lastPongAtRef`（:1092）。

**`pongTimedOut` 标记存在的原因**（:1487-1489 原注释）：本端因 pong 超时主动关闭时，close 帧的 code 是干净的 1000——若不标记，`onclose` 会把 1000 当「服务器正常关闭」而放弃重连，**半开连接将永久静默**。

### 1.3 关闭→重连决策（webrtcCore.ts `shouldReconnectOnClose` :116-128，纯函数）

```
suppressed（用户 disconnect / room_closed / 卸载）  → 不重连
pongTimedOut（本端看门狗主动关）                    → 重连（无视 1000）
code 1000 / 1001（服务端正常关）                    → 不重连
其余（1006 传输层掉线、401 拒绝后的异常关等）        → 重连
```

`room_closed` 服务端消息会置 `suppressReconnectRef = true`（:1096）并 `setError('房间已关闭: …')`（:1097），此后一切 close 不再重连。退避序列 `nextBackoffDelay(attempt) = min(1000·2^attempt, 30_000)`（webrtcCore.ts:95-97，封顶常量 :89）→ 1s, 2s, 4s, 8s, 16s, 30s。

### 1.4 scheduleReconnect（:1531 起）——两条置错路径必须分清

| 条件（按判断顺序） | 行为 | 行号 |
|---|---|---|
| `suppressReconnectRef` 为 true | 直接返回 | :1532-1534 |
| **无 rejoin 回调** | **首次失败立即** `setError('信令连接已断开')` + `meetingState='error'`（不走退避！） | :1536-1540（setError 在 :1537） |
| `attempt >= 6`（rejoin 路径耗尽） | 同上置错 | :1542-1546（setError 在 :1543） |
| 其余 | `attempts++` → `connecting` → 延迟 `nextBackoffDelay(attempt)` 后：`rejoin()` 拿新 token/ICE → 失败递归再排 → 成功则 `cleanupPeers()` + 新 token 重开信令 | :1547-1575 |

排查「横幅何时出现」时**混用两条路径会得出错误时间线**：无 rejoin 首败即置错（秒级），rejoin 路径要 6 次退避耗尽（累计约 1 分钟）。

### 1.5 error 生命周期＝常驻横幅机理

`setError(null)` 只存在于 `connect()`（:1597）与 `cleanup()`（:1619）两个入口；置错后无超时清理。**设计启示：报错态必须配对写清「谁能清它」，否则瞬时误报会放大成常驻 UI。**

### 1.6 rejoin：信令 token 是一次性的（MeetingPage.tsx:466-484）

重连前调 join 端点拿**新的** `ws_token`（:481 `return { token: resp.ws_token, … }`）。重连必须换新 token，不能复用旧 token 硬连。

### 1.7 状态迁移图（文字版）

```
idle --connect(token非空)--> connecting --ws open--> connected（心跳25s/pong 60s看门）
 ^                            |    ^                    |
 |                            |    | close(可重连)      | close(不可重连: suppress/1000/1001)
 |                            |    +-> scheduleReconnect+
 |                            |        |无rejoin 或 attempt>=6
 |                            |        v
 +--disconnect/cleanup--------+------> error（横幅常驻；仅 connect/cleanup 可清）
```

## 2. 控制窗 daemon 探活三态机（ControlWindow.tsx，HTTP 探活型）

### 2.1 定义（:47-56）

```ts
export type LinkState = 'probing' | 'connected' | 'down';
export const LINK_DOWN_STREAK = 3;   // 连败 3 次 ≈ ≥3s 连续不可达；单次抖动到不了 3

export function nextLinkState(prev: LinkState, ok: boolean, failStreak: number): LinkState {
  if (ok) { return 'connected'; }                        // 成功恒恢复（含 down → connected）
  return failStreak >= LINK_DOWN_STREAK ? 'down' : prev; // 未达阈值绝不新入 down
}
```

初值 `link='probing'`（:61）——首探未归只许显示「正在连接」，**不得**宣断（旧实现初值 null 直接渲染「未连接」＝初值误报）。

### 2.2 巡检不变式（:73-101，周期 `STATUS_POLL_MS = 1500` :37）

- 探活成功：`failStreak=0`、`link='connected'`、`status` 更新为最新成功快照；
- 探活失败：`failStreak++`、`link=nextLinkState(…)`；**`status` 不清空**——保持上一成功快照，armed/grant 展示位不闪烁；
- 卸载用 `stopped` 标志 + `clearInterval`，防在途应答写状态。

### 2.3 渲染映射与 e2e 锚点（:227-246）

| link | 状态点 | 文案（:235/:237/:239） |
|---|---|---|
| probing | 中性 | `正在连接控制 daemon（127.0.0.1:{port}）…` |
| connected+armed | 绿 `--status-success`（css :59） | `daemon 已连接 · 受戒(armed) · grant=… · 注入 N · 帧 N` |
| connected 未受戒 | 橙 `--status-warning`（css :60） | 同上（未受戒） |
| down | 红 `--status-error`（css :61） | `控制 daemon 未连接（回环 …，自动重试中）` |

e2e 断言用 `data-testid="rc-link-dot"` / `"rc-link-state"`（:245-246，比截图 OCR 稳）。dev 键位钮 `rc-devkeys` 仅 `VITE_DEV_CONTROL=1` 渲染，可复用做输入链路自动化。

### 2.4 参数设计与适用边界

- 探针超时 `connectTimeout: 1500`（api.ts:61/:107）≈ 巡检周期 1500ms → 单次抖动概率高，阈值 3 次才宣断；最坏宣断时延 ≈ (阈值−1)×周期+探针超时 ≈ 4.5s（实测 kill daemon 后 ~2s 仍绿、~7s 红点，含调度余量）。**复用时按「可接受宣断时延 = 阈值×周期」反推参数。**
- 该机是**请求-应答型探活**模式，与 ws 的 onclose 事件驱动模式（§1）不同；阈值去抖不是吞掉真断开——真不可达连败 3 轮后如实宣断。
- 回环端口默认 19290，可被 localStorage `rc.control.port` 覆盖（api.ts:28-32，多实例/自定义部署口）。

## 3. 主窗业务 WS 世代守卫（WebSocketContext.tsx，背景机制，本块零改动）

远控裁决帧经 `wsSender.ts` 上行：WebSocketContext 建连成功后在 `isDevControl()` 门控内注册发送器，生产构建恒不注册。

| 机制 | 位置 | 说明 |
|---|---|---|
| 连接世代守卫 | `connectionGenRef`（:193），connect `++`（:544）、disconnect `++`（:609） | 每条连接的 onopen/onclose/onmessage 闭包捕获自己的世代，**世代不符的事件一律忽略并 warn**（onmessage :275-277、onclose :439-441、onopen :557-559）——防上一代迟到的 close 把当前连接「连根拔掉并再排一次重连 → 并存双连接」 |
| 退避 + 抖动 + 节点轮换 | `ROTATE_AFTER_ATTEMPTS = 2`（:103），:484 连败 ≥2 先轮换后端 IP 再重连 | 自愈不依赖发现池摘除 |
| token 刷新 | `MAX_RECONNECT_ATTEMPTS = 5`（:100），close code 1008 或连败 ≥5 → refreshToken | 失败登出防无限循环 |

新增长寿命连接应对齐这套惯例：世代守卫（防跨连接生命周期污染）＋多级自愈（换节点→换 token→登出）＋resume 增量同步。

## 4. 空 token「信令断开」误报根修（MeetingPage.tsx，本块唯一 tracked 改动）

### 4.1 误报链四环（判定「X 是误报」的取证模板）

1. **误报源数据**：dev 门控演示面 seed `token:''`（MeetingPage.tsx:426，`isDevControl()` 门控内，React state 写入不落盘）；
2. **必败+放大机理**：空 token 拼 URL（`meeting/api.ts:288` `getSignalingUrl` 以 `?token=${token}` 原样内插，空串直拼）→ 后端对空串 `split('.')` 得 1 段 → InvalidFormat → 401 握手即拒 → close(异常) → 无 rejoin **首败即置错**（:1537）→ error 无清理（§1.5）→ 横幅常驻；
3. **反证**：横幅常驻时段主窗 WS 信令双轮贯通（cmdlog 08e/12，`delivered_devices=1 / approved=true`）——功能实际走的链路健康，自证误报；
4. **修复最小性**：真会议 `ws_token` 写入点全仓 7 处 grep 实测——6 处非空且全部来自服务端签发（MeetingEntryModal.tsx:195/:236、MobileMeetingEntryPage.tsx:158/:193、MeetingInviteCard.tsx:48、rejoin MeetingPage.tsx:481），唯一直写空串就是 dev seed :426；生产构建 `isDevControl()` 恒 false → seed 整支死代码。

### 4.2 修复（:487-501）

```ts
// 信令断开误报根修（2026-09-09 …）：token 为空 = 无真实会议可信令…此时跳过 connect
if (meetingData.token) {          // :493
  webrtc.connect(                 // :494
    meetingData.roomId, meetingData.token, iceServers, meetingData.serverUrl, rejoin);
}
```

修在**发起处守卫**而非改 useWebRTC/URL 拼装/删 seed：动 hook 会碰真会议共享路径（红线），改拼 URL 治标，删 seed 毁演示面载体。真会议 token 恒非空 → 零行为变化。

### 4.3 修误报 ≠ 吞报错

「信令连接已断开」文案**原样保留**在 useWebRTC.ts:1537/:1543（真断开如实报错），由 `tests/meeting/useWebRTC.hook.test.tsx` 断言守护（含「异常关闭且无 rejoin：置信令断开」用例）；ControlWindow 三态机 7 例迁移表穷举在 `tests/remote-control-link-state.test.ts`（describe :19，it ×7 :20/:24/:33/:39/:45/:50/:55：阈值语义/成功恒 connected/probing 不宣断/单双败不翻面/达阈值才 down/down 不闪回且成功恢复/streak 0-20 全扫描）。

## 5. 改动自查命令（改信令参数/重连逻辑后必跑）

```bash
# 信令域 + 本状态机定向测试（6 文件 47 例；上游 R2/review R3 双层实测 RC=0，本层未复跑）
npx vitest run tests/meeting/ tests/remote-control-link-state.test.ts
# 置错与清理点配对自查（当前 2 个置错点 :1537/:1543、2 个清零点 :1597/:1619）
grep -n "setError(" src/meeting/useWebRTC.ts
# 横幅本体字面量守护点（应恰 2 处 + 注释）
grep -rn "信令连接已断开" src/ tests/ --include='*.ts*'
```

全仓回归 `npx vitest run`（上游双层实测 374 文件 / 4186 例 RC=0）。

## 6. 排障速查

| 症状 | 先查 |
|---|---|
| 页顶「信令连接已断开」横幅常驻 | §0 分链路 → 服务端日志核对实际链路 → `grep -n "meetingData.token" src/meeting/MeetingPage.tsx` 守卫是否在位（:493） |
| 控制窗「未连接」闪烁 | 三态机是否在位（ControlWindow.tsx:47-56）；探针超时 vs 巡检周期是否仍同量级（api.ts:61 vs :37） |
| 重连风暴/双连接 | WebSocketContext 世代守卫（:193/:544/:609）+ 节点轮换阈值（:103） |
| 半开连接静默死 | pongTimedOut 标记链（:1487-1500）——本端主动关必须强制重连 |
| 远控 M1 申请发出后无反应/「信令黑洞」 | 先查两端是否已登录账号（§7.1，访客被设计丢弃非 bug）→ 好友昵称是否与被控端显示严格一致（§7.1）→ 服务端 journal 三跳判读（§7.2） |
| 释放后服务端无 control_session_released 行 | 移动端「结束控制」按钮不发 M3（§7.3），改用桌面端停止按钮或服务端超时；被控端横幅滞留≤15s 属数据面收敛设计（§7.4） |

## 7. 远控信令实测前提与三跳取证（2026-09-22 块 pleibt4s 生产实测沉淀）

### 7.1 M1 的登录账号前提（前块 0fbzmdm5 二十轮空转根因，owner 裁决 A）

- **远控限登录用户使用，访客不可被控＝产品设计**：M1 目标解析要求参与者有真实 user_id（ef8c2b62 起：会议参会人经好友列表解析 M1 目标）；访客身份的信令在桥接层按设计静默丢弃，表象酷似「信令黑洞」bug。**排障第一步查测试身份，别改丢弃行为**（owner 裁决保护面）。
- 好友解析依赖**昵称严格匹配**：发起端好友列表显示的被控端昵称必须与服务端账号昵称逐字一致，改昵称会破坏 M1 路由。
- 实测判据：服务端 journal 的 `requester=/target=` 为真实账号明文（非访客）即前提满足。

### 7.2 三跳 journal 判读模板与取证命令

```bash
ssh root@<节点> 'journalctl -u huanvae-chat-app --since "YYYY-MM-DD HH:MM" --no-pager | grep control_session'
```

- **M1** `control_session_requested routed to sharer devices requester=<发起账号> target=<被控账号> request_id=… delivered_devices=N`
- **M2** `control_session_decided routed to watcher devices decider=<被控账号> watcher=<发起账号> approved=true|false`（false 常为授权弹窗 ~11s 超时自动拒，非缺陷）
- **M3** `control_session_released receipt routed to sender devices by=<发起账号> grant_id=… reason=Revoked`
- `delivered_devices` 反映同账号多设备（手机+桌面同会=2）；生产节点二进制/健康判据见本块 update/deliverable.md §二（部署核对不属本 skill 主题）。

### 7.3 移动端「结束控制」不发 M3（既有缺口，2026-09-22 实测+review 三侧实证定性）

全仓封闭命中集（`grep -rn "RC_REQUEST_RELEASE" src/` 恰 5 处；`grep -rn "control_session_release" src/` 12 处中 M3 上行帧仅 mainBridge.tsx:78 一处，余为 N3 下行/注释）：

- `src/pages/mobile/MobileMeetingPage.tsx` 按钮块 :528-534（onClick :531）：只调 `useControlSessionStore.getState().release('revoked')`；全文件 `emit` 仅 :359 的 `RC_REQUEST_CONTROL`（M1），**零 RC_REQUEST_RELEASE emit**。
- `src/remote-control/sessionStore.ts:52`：`release: (reason) => set({ state: 'released', releaseReason: reason })` ——纯本地 setState 零外发。
- M3 唯一发送落点 `src/remote-control/mainBridge.tsx:78`（`type:'control_session_release'`），仅由 :175 `listen(RC_REQUEST_RELEASE,…)` 触发；该事件唯一 emit 点 `src/meeting/MeetingPage.tsx:733`（桌面停止按钮）。
- **后果与绕行**：移动端发起的会话点「结束控制」只退本地视图，服务端不知情、对端横幅不撤；要拿真实 M3 必须用桌面端发起并点桌面停止按钮。涉事文件末次提交均早于 2026-09-22 块开工（ef8c2b62/b9bf0bdb/55825f75）＝既有缺口，修复留待专门块。

### 7.4 被控端横幅收敛走数据面，不走信令面

Rust `/work/Huanvae-Chat-Rust/src/control_session/mod.rs:323-325` 注释原文：「对端 UI 收敛走数据面 Bye＋心跳租约 ≤15s……『收回的安全性不依赖任何网络消息的到达』」；:328 `handle_control_session_release` 的 :353 `send_to_user_global(sender_user_id,…)` 仅回执发送端。⇒ M3 后被控端横幅短暂滞留（daemon 未部署期间）是设计口径预期表现，**不要当回归修**。

## 8. 移动控制端拓扑断链自愈闭环（2026-09-25 块 rt4p73av 沉淀：D4 修复，§0 链路 A 的帧面延伸）

### 8.1 根因与不对称：WS 重连只修媒体面，帧面自愈臂桌面有、移动没有

链路传输故障后会议信令 WS 重建只修媒体面；桌面被控端有「参与者重同步」自愈臂，**移动控制端拓扑没有**——
control-session DataChannel 死亡后无人重建，0x07 FrameSlice 帧泵哑火（帧计数冻结），而 UI 状态条不感知帧
停滞恒亮绿点＝假活。实测形态（修复前单 ae6fbn0x）：断链恢复后观察 ≥3 分钟帧计数恒冻结、logcat 零 resume/
重协商活动。**排查任何「帧计数冻结/画面卡死但连接显示正常」症状，第一步就查拓扑有没有自愈臂，别只看 WS 状态。**

### 8.2 修复模式：三段式同源闭环（零新增协议）

| 段 | 落点 | 内容 |
|---|---|---|
| ①恢复事件触发（双保险） | `frameChannel.ts` `ensureControllerRestoreWatchdog`（:376-385） | `window online` 事件 + `CONTROLLER_RESTORE_PROBE_MS=8_000` 周期探针双保险。**只挂 online 事件不够**：网络层「恢复」与信令/DC 层「可用」不同步，必须周期兜底 |
| ②有条件探针+同源重建 | `requestControllerRestore()`（:358，仅 `role=controller 且数据面不在位`才动作）→ `rebuildControlChannel(peerId)`（`useWebRTC.ts:810`） | 对**既有 RTCPeerConnection** `createDataChannel(CONTROL_SESSION_CHANNEL)` 重协商，复用抽取的 `wireChannelFor`（:785，与首次建连同一条接线） |
| ③钩子解耦 | `registerControlChannelRebuilder(fn)`（frameChannel.ts:345），useWebRTC useEffect 注册/注销（:818/:820） | frameChannel 不 import useWebRTC，破环依赖 |

**同源闭环是关键设计**：重建 DC open ⇒ 走与首次建连同一条 `attachChannel onOpen` ⇒ `announceControlResume`
⇒ 被控端 `handleControlResume` ⇒ `pumpOneFrame`（frameChannel.ts:849）重拉 0x07 帧泵。自愈零新增协议消息，
端到端复用既有 resume 消息面。

### 8.3 配套 UI 诚实化：恢复能力与状态可见性必须同修

`RC_FRAME_STALL_MS=5_000` 停滞看门（`ControlWindow.tsx:61`，检查循环 :117-125）：peerMode 在位且 ≥5s 无帧 ⇒
`peerStalled` ⇒ 状态点 `rc-window__dot--down` 红点 +「对端帧流中断（≥5s 无帧，断链自愈探针进行中）」文案
（:299-311）。**通用教训：断链修复只修恢复能力不修状态可见性，用户看到的是假绿点假活。**

### 8.4 实测判据（本块真机双端：Android 模拟器控制端 × Windows 池化 VM 被控端，生产信令）

- **「断前值」锚定链路实际断开时刻，不是截图时刻**：断开指令下达后链路有惯性继续送帧（基线截图帧 15 →
真断点后冻结在 22），判据口径用 logcat `ConnectivityService … DISCONNECTED` 时间戳定义断点、飞行模式恢复
日志定义恢复点，断链窗口由此直算（本块 50.0s ≥30s）。
- **帧计数是全局累计不是会话内计数**：第二次会话帧 126 > 第一次 66 是累加不是回归，复测读数别误判。
- **UX 缺陷最强证据形态 = 正反对照**：同场景旧构建 vs 新构建各留一张实拍（sha256 在案），比单张好截图有力。
- 证据路径：`code/evidence/real-ui/d4d5-device/logcat-d4-full.log`（行锚点 52031/54382/57187）与
`d5-reauth-round7/`（块 1790313105455-rt4p73av-1）。

## 9. 授权免选源（display track 缓存复用）与控制会话建立超时/取消/重试（同块 D5 沉淀）

### 9.1 免选源模式：轨生命周期从「停泵即销毁」改「停泵入缓存」

根因：停泵时对自取的 display 轨 `track.stop()`，轨死则下次授权必重弹 getDisplayMedia 选源器。模式三件：

- `cachedOwnTrack` + `cacheOwnTrack()`（`frameChannel.ts:149-160`）：停泵不停轨，缓存供下次授权复用；
- 缓存轨挂 `ended` 监听（:160）：轨被系统/外部终结 ⇒ 清缓存回落现选。**缓存必须有失效路径，否则复用死轨黑屏**；
- `acquireInFlight` 并发护栏（:201，采集入口 :804-820）：防双路同时走采集 ⇒ 弹两个选源器。

**最大踩坑（第 7 轮卡面场景真机复测撞出，催生补丁 c6666aed）**：第一版只缓存自己采集来的轨（owned=true），
**漏了会议共享经 `attachLocalTrack` 注入的轨（owned=false）**——「会议内共享→结束控制→再授权」场景缓存为空，
选源器重现。修法：`stopControlledPump` 对**全部存活轨统一入缓存，不区分 owned 来源**，同时**永不 stop 共享轨**
（所有权仍在会议，toggleScreen 才是它的销毁者）。**教训：按所有权标签分叉的轨生命周期代码必须穷举每条路径，
单测两条都要有**（本块已补 owned=false 用例入 rcFrameChannelResilience.test.ts）；卡面场景真机复测不是走形式。

### 9.2 建立等待三件套：超时+取消+重试，缺一不可

根因：信令 `approved:true` 已回但对端 DC 永远建不起来时，前端只有「对方已授权，控制会话建立中…」转圈没有出口。
模式（`src/pages/mobile/MobileMeetingPage.tsx:463` 起，超时视图 :610-643）：`LINKING_TIMEOUT_MS=30_000`；
30s 内＝转圈 + **取消控制**（任何等待态都要有取消出口）；超时后＝明确文案「控制会话建立超时（30 秒未收到对端
帧流，链路恢复后可重试）」+ **重试建立**（重挂 30s 窗 + 复用 §8 同一 `requestControllerRestore()` 探针——
**重试不是刷新 UI，是复用同一个自愈入口**）+ 取消控制。三个动词缺一不可：只有超时没有重试会把可恢复故障变死局。
