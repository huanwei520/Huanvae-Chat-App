---
paths:
  - "src/contexts/WebSocketContext.tsx"
  - "src/contexts/wsHandlers.ts"
  - "src/contexts/wsSender.ts"
  - "src/services/rustWebSocket.ts"
  - "src/hooks/useInitialSync.ts"
---

# WS 僵尸连接（绿点假活）根因模式与修法三板斧（一页）

> **一句话**：客户端「绿点常亮但推送收不到」≠ 心跳缺失，而是**活性判据只看 transport 层**——
> 服务端静默摘除推送路由后协议层心跳仍由旧连接直发（不经路由表），lastActivityAt 持续新鲜，
> 任何只测「有没有帧进来」的看门狗对此结构性失明。修法=**双层活性裁决 + 踢出帧显式处理 +
> 前台/网络恢复活性校验**三板斧，重连后靠 resumed 重放 + 强制增量 sync 对账兜底不丢消息。

- **定案锚点**：块 `1789679152008-mi8hug16-1`（2026-09-18，提交 `c19406c9`，分支
  `fix/mi8hug16-ws-zombie-liveness`）。行号只在基准 SHA `c19406c9` 内精确，复审先 spot-check。
  全过程证据（修复前假活对照 17 张截图+console/logcat 原文）：
  `test-artifacts/mi8hug16-1/`；机制原文：块 `code/deliverable.md` §1/§4。

## 1. 何时触发本规则（复审条件）

① 改动 WS 连接生命周期（重连/心跳/terminate/connected 帧处理）或活性判据；
② 服务端（Huanvae-Chat-Rust）动 `connection_manager` 注册/注销路由、心跳任务、踢出语义；
③ 新增「同账号多端/同设备重复建连」场景或改 device_id/session 语义；
④ 出现「推送概率性收不到、需重登才恢复、无报错」类 owner 报障——先按 §2 判型再动手。

## 2. 根因模式：三类断流按「活性信号」判型（先判型再修）

| 判型 | 特征 | 根因 | 看门狗能否发现 |
|---|---|---|---|
| A 纯半开（NAT 静默断 idle TCP） | 无任何入站帧，`lastActivityAt` 变陈旧 | 对端死、本端无 FIN → close/error 事件不产生 | ✓ transport-stale 即捕（`evaluateLiveness` 前置分支） |
| B 路由摘除型假活（本块真因） | **协议层心跳仍在流**，应用层帧永绝；绿点常亮 | 服务端同 user+device 重复建连时 `retain(|c| c.device_id != device_id)` 静默摘旧连接路由（Huanvae-Chat-Rust `src/websocket/services/connection_manager.rs:176-177`，仅 retain+push，无任何踢出帧/Close）；旧连接心跳由本连接自己的 heartbeat 任务经其 tx 通道直发**不经路由表**（`src/websocket/handlers/connection.rs:157` spawn / `:168` `tx_heartbeat.try_send(Message::Ping)`） | ✗ 必须第二层：`app-silent`（应用层帧静默 > 3×ping 周期） |
| C 踢出帧可及 | 服务端**有**下发 kick/error 帧 | 客户端无人接（chat 服务端现状：`grep -rniE "kick\|session_replaced\|顶替\|force_logout\|踢出" src/websocket/` 零命中=GREP_EXIT 1；对照 meeting 侧 marker `src/webrtc_room/handlers/signaling_ws.rs:111,261`） | 收到即处理（§3 板斧二），别等看门狗 |

**判型实测法（勿靠猜）**：宿主起同 token 竞争 WS 连接顶替（生产机理精确复现，无需杀服务端），
对照看「竞争连接是否收到 new_message 推送」与「App 端 lastActivityAt 是否仍新鲜」：
B 型=竞争连接收推送 + App 心跳仍活 ⇒ 只有应用层静默判据能救。
本块修复前实测：顶替后 8 分钟绿点仍 #22c55e、3 条消息零到达、零自愈动作
（`test-artifacts/mi8hug16-1/logs/logcat-baseline-zombie.log` 窗口化口径 0/0/0）。

会议/远控信令侧的 WS 状态机/心跳看门狗另有专 skill：`.claude/skills/remote-control-signaling/SKILL.md`
（:3 description、:34-44 useWebRTC 看门狗/重连决策表）——本页只管 **chat 主信令 WS**；
meeting 侧 kicked 语义相反处见本页 §3 条 2。

## 3. 修法三板斧（全部同构复用既有链，不发明新通道；锚点=基准 c19406c9）

1. **双层活性裁决**（`WebSocketContext.tsx:129,143-152,605-625`）：
   `evaluateLiveness(now, lastActivityAt, lastAppFrameAt)` 先 transport-stale（无任何入站帧>70s，
   既有语义）后 app-silent（应用层入站帧静默>75s=`APP_FRAME_SILENCE_TIMEOUT`=3×PING_INTERVAL）。
   关键：**lastAppFrameAt 只记应用层帧**（`handleMessage` 入口 `:355-356`），协议层 Ping/Pong
   不计——否则 B 型永远「健康」。onopen 必须**基线化**两枚时刻（`:663-665`），防跨连接旧值误判。
2. **踢出帧显式处理**（`wsHandlers.ts:82,535-545,795-806` + `WebSocketContext.tsx:431-437`）：
   `isKickServerFrame(code,message)` 严格白名单 kick/session_replaced/force_logout（普通业务
   error 绝不误判）；命中 → `result.kicked` → 立即 terminate 走既有重连。**语义与会议侧相反**：
   meeting `useWebRTC.ts:1129-1134` kicked 后 suppressReconnect（防旧会话复活）；chat 必须重连
   （只有重连才能夺回推送路由）。
3. **前台/网络恢复活性校验**（`WebSocketContext.tsx:160-181,883-941`）：
   `visibilitychange→visible` 与 `window online` → `checkLiveness(source)`：活性异常即 terminate
   （重连+补拉）；看似新鲜也**立即补发一次应用层 ping 探测**（后台冻结期定时器不可信，回前台
   不能等下一 tick）；连接未打开且无重连在途 → 立即 connect。决策抽纯函数
   `decideForegroundAction` 便于单测。

## 4. resumed 重放 vs 强制增量 sync 的对账分工（重连后消息不丢）

- **resumed=true**：服务端 64 事件缓冲内重放漏收段，免费但窗口有限。
- **resumed=false / 不确定时**：先置 `halfOpenSyncPendingRef=true` 再 terminate，connected 帧
  到达后强制 `performSync` 增量补拉（seq 对账）——**宁可多拉一次，不可赌 resumed**。
- 三处新触发面（看门狗/踢出帧/前台校验）**一律先置 halfOpenSyncPendingRef 再 terminate**，
  这是「消息不丢」不依赖判断正确性的关键。useInitialSync 只挂 onReconnected（`:240-245`），
  半开/被顶替不产生事件则永无人补拉——所以所有自杀路径必须汇入同一条重连链。
- 单测挂靠：`tests/unit/wsZombieConnectionRecovery.test.ts`（19 用例）+ 既有
  `tests/unit/wsLivenessWatchdog.test.ts`（7 用例，transport 层回归）。裁决/决策全抽纯函数
  （`evaluateLiveness`/`decideForegroundAction`/`isKickServerFrame`），不 mock 定时器即可测。

## 5. 踩坑与实测要点（留给未来复测者）

- **WebView console 不落 logcat**（本仓 Tauri Android 形态实测）：App 端 `[WebSocket]` 日志取证
  走 debug 包 CDP（`webview_devtools_remote_<pid>` → `adb forward` → `Runtime.consoleAPICalled`）。
- **消息气泡文本不暴露给 uiautomator**：消息到达以设备级截图像素/卡片预览为证，勿依赖 ui dump。
- 绿点色值锚：`#22c55e`（connected）/`#ef4444`（disconnected），`src/styles/mobile/header.css:57`
  附近；dot(122,248) 采样 88~138 像素命中=状态实证。
- logcat 跨阶段长抓时**必须窗口化 grep**（按时间前缀切片）再计数，否则他阶段命中污染结论
  （本块交付第 1 轮即栽在这上面，勘误见 code/deliverable.md §4.1）。
- 服务端二阶缺陷（未修，客户端已可自愈）：被顶替连接延迟退出时按 device_id `unregister`
  （`connection_manager.rs:232` fn / `:236` `connections.retain(|c| c.device_id != device_id)`）会**误删新连接的路由条目** ⇒ 复发型假活；修复后看门狗
  ~88s 内二次自愈（console 23:54:00 实证），但根治应改服务端 unregister 按 session_id。
- 「服务端侧断开」实测勿杀生产进程：同 token 竞争连接顶替即任务卡所指「踢会话」精确机理。
- **缺失类（absence）结论的举证法**：「服务端没有 X」必须落全目录 grep 零命中原文（exit 1）+
  对照面命中（如 meeting marker），并给 file:line；仅转录上游交付文字不算独立证据。
