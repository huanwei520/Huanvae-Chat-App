---
name: remote-control-signaling
description: 远控/会议信令链路状态机与重连机制速查——useWebRTC 心跳看门狗/指数退避/两条置错路径、ControlWindow 探活三态机、WebSocketContext 世代守卫、空 token「信令断开」误报根修。改信令参数/重连逻辑，或排查任何「连接类」UI 误报前必读
disable-model-invocation: false
allowed-tools: Read, Grep, Glob
---

# 远控信令链路状态机与重连机制

> 来源：block `1788964672726-2-统一远控UI并修信令断开` 沉淀（code/review 判官双 PASS，2026-09-09）。
> file:line 为 2026-09-09 工作树实测（嵌套仓 /work/Huanvae-Chat-App HEAD 79ce79a4ee87d0a33522ceebf958adf9c1836529）；共享在飞树上行号会漂，引用前先 grep 现查。
> update 层第 4 次执行已逐条 grep/read 复核全文行号并修正 2 处（状态点 css 行号：绿 :59；getSignalingUrl 归属：meeting/api.ts:288）；第 5 次执行（2026-09-09）第三次全量复核零漂移，全部 file:line/计数的完整 grep/read 原始输出见本块 update/deliverable.md 与 update/evidence/（落点双镜像 landing-*.md 同目录在档，diff 可验逐字节一致）。

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
