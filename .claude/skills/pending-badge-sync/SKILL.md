---
name: pending-badge-sync
description: 「+」角标/pending 计数（好友申请、群邀请、入群申请）不同步类 bug 的链路图谱与修复配方 — 「登录一次性 REST 对账 + WS 单向加法」四写入路径图谱（WebSocketContext pendingNotifications）、病根判定三步（本地减法/服务端推送受众/多端事件能力）、回执后扣减同构修复四细节（成功后 catch 前/floor 0/deps 补齐/与 clear 同构）、服务端推送受众双端锚定核查法（notify 收件人 file:line + 枚举零命中穷举）、无掩蔽面验收原则（桌面 d5 红点递减为本体证明，移动端 openPending 清零是掩蔽路径）、真机双端验收帧清单与 WS 帧体不可用时的 logcat+REST 替代口径。要修「通过好友申请后红点不消失需重登」「角标计数不减/加错」「操作后计数与列表不一致」或要做角标类双端实测验收，先读本 skill。
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Write, Edit
---

# pending 角标同步：链路图谱、修复配方与双端验收

> 来源：块 `1789554954434-8kvwan3p-1-定位修复好友角标红点不同步并实测`（2026-09-16，合入 main @ ae4a4c72；code/review 两层一轮过判，update 层第 1 次 REJECT 整改后落典本 skill）。
> owner 报障原话：「搜索框旁『+』通过好友申请后红点不自动消失，重新登录才消失」。

## 触发场景（命中任一条，先读本 skill）

- 「通过/拒绝好友申请后「+」红点不消失，重新登录才消失」类 bug；
- 任何角标/计数（好友申请、群邀请、入群申请、未读）「操作后不减、加了不消、多端不一致」；
- 改动涉及 `pendingNotifications`、`wsHandlers` 通知分支、好友申请面板；
- 要给角标类修复做双端真机验收与证据打包。

## §1 链路图谱：pending 角标的四条写入路径 + 渲染路径（file:line 为 2026-09-16 实测）

驱动状态：`WebSocketContext` 的 `pendingNotifications = { friendRequests, groupInvites, groupJoinRequests }`
（`src/contexts/WebSocketContext.tsx:244` state；接口 :138-145）。

```
路径A 登录一次性 REST 对账（唯一对账点，ref 锁防重入）
  src/hooks/useMainPage.ts:301-326：initDone.current 锁(:303-304)
  → loadPendingNotifications(:306) → GET /api/friends/requests/pending → initPendingNotifications(:316)
  【坑】initDone 一次性锁 ⇒ 会话期内此路径最多走一次，重登才重对账。

路径B WS 实时增量——只有加法，无减法
  src/contexts/wsHandlers.ts:746-750 friend_request→friendRequests+1；:752-756 group_invite；
  :758-762 group_join_request（switch 全集仅此三分支，无 default 减法）
  【坑】connected 快照(:543-574)只带 unread_summary，不含 pending ⇒ 重连也不纠正角标。

路径C 操作回执后本地扣减（ae4a4c72 新增的减法）
  src/contexts/WebSocketContext.tsx:786-788 decrementPendingNotification(type, by=1)
    functional set + Math.max(0,…)，与 clearPendingNotification(:781-784) 同构
  调用点全在 API 成功之后、catch 之前（失败不扣）：
  src/hooks/usePendingRequests.ts:98 approveFriend→friendRequests；:119 rejectFriend；
  :135 acceptInvite→groupInvites；:160 declineInvite。
  写入面全集（穷举 grep 实证见 §3）：除 A/B/C 与移动端清零外无其他写者。

路径D 移动端既有掩蔽点：打开面板即清零
  src/pages/mobile/MobileAddPage.tsx:250-252（openPending 内 clear 三计数）。
  【坑】桌面端无此清零路径 ⇒ 桌面才是暴露缺口、也是验证修复本体的面（§4）。

渲染：三计数求和 src/hooks/useMainPage.ts:1002-1005
  → 桌面 src/components/unified/AddMenu.tsx:200（.notification-badge）
  → 移动 src/pages/mobile/MobileHeader.tsx + MobileAddPage.tsx:317。
```

**图谱判断法**：任何「登录拉一次 + WS 单向推」的计数，只要存在一个消耗基数的操作路径
而该路径不写回计数，必出「操作后不消、重登才消」——唯一对账点被 initDone 锁死在登录时刻。
排查顺序：找驱动 state → 穷举全部写入路径 → 问「减法在哪、重连兜底在哪」。

## §2 病根判定三步 + 同构修复

**第 1 步·本地减法**：操作回执后有没有写回计数？（本块主根因：修复前四动作只改
usePendingRequests 内部 sources 列表，列表空了≠角标消——两者不共享 state。
凡 UI 角标跨组件，必须定位到共享 store 才算找到根因。）

**第 2 步·服务端推送受众**：服务端有没有「已处理」事件、notify 的收件人是谁？
本块实测（双端穷举，命令与输出模板见 §3）：approve/reject 只推申请人，处理者全设备零帧。

**第 3 步·多端能力**：多端同步靠事件或快照，两者皆无 ⇒ 多端缺口=服务端能力缺口，
如实登记限制，**禁客户端发明轮询/新通道硬凑**（与 forward-echo-e2e「不发明新通道」同纪律）。

**修复优先级**：回执后本地即时更新 > 操作后主动重拉 > 接 WS 事件（事件存在才接）。

**实现四细节**：
1. 扣减放「API 成功之后、catch 之前」——失败回滚不扣（单测 tests/unit/pendingBadgeSync.test.tsx 覆盖「失败不扣/未登录不扣」）；
2. floor 0 必须：`Math.max(0, prev[type] - by)`，防并发/重复事件负数；
3. 新注入 context 方法，接口声明、contextValue、useCallback deps 三处一起补（漏 deps 则 eslint exhaustive-deps 红）；
4. 与既有 clear/init 完全同构（functional set），不新增状态源。

## §3 服务端推送受众核查：双端锚定法（穷举命令模板）

凡下「服务端无 X 事件/不推 Y」类缺失结论，必须双端给 file:line+CMD+OUT：

**服务端侧（/work/Huanvae-Chat-Rust）**——三连：
1. `grep -n "notify" <相关 handlers>` → 列出该生命周期全部通知点（本块好友域恰 3 处）；
2. 读各通知点收件人实参（approve_request.rs:53-63 收件人 `&applicant_user_id`、
   reject_request.rs:42-52 同、create_request.rs:43 推目标用户=加法源）；
3. 枚举事件类型全集证明无「通知处理者」变体：`SystemNotificationType` 枚举
   （websocket/models/ws_message.rs:243 起，好友段仅 FriendRequest/:246 Approved/:248 Rejected/:250 Deleted/:252），
   再 `grep -rn "<EventType>" src/ | wc -l` 全仓计数（本块 FriendRequestApproved 恰 2 命中=枚举定义+唯一 emit）。

**客户端侧（/work/Huanvae-Chat-App）**——两连：
1. `grep -rn "<事件名字符串>" src/` → 处理逻辑全集（本块 friend_request_approved/rejected 12 命中，
   唯一逻辑处理=useMainPage.ts:360-380 store.addFriend（申请人侧加好友）+ :381 rejected no-op；
   其余为类型声明/notificationService 系统通知展示，零角标分支）；
2. `grep -rn "setPendingNotifications\|decrementPendingNotification" src/`（排除测试）→ 写入面全集对账 §1 四路径。

## §4 验收：无掩蔽面原则 + 帧清单 + WS 留证替代口径

**无掩蔽面原则**：移动端 openPending 既有清零会把修复效果「洗掉」（看不出因果）；选验证面先问
「这条路径上有没有既有逻辑会把现象掩盖」。本块桌面链（无任何清零路径）才是扣减本体证明。

**移动双端帧序**（B=被申请人端，fx=emulator-5554；A=申请人端，req24=emulator-5556）：

| 帧 | 判据（截图原件在 code/evidence/screens/，f*.png/a*.png） |
|---|---|
| 帧0 | B 登录主列表「+」无红点（基线，不证基线则帧1无因果） |
| 帧1 | A 真机发申请（A 端同分钟「已发送」）→ B 红点"1" WS 实时出现、未重登 |
| 帧2a/2b/2c | 「+」菜单红点1 → 待通过列表含申请人行+同意/拒绝 → 点同意后行移除+空态 |
| 帧3 | 返回主列表红点已消；**同会话**（状态栏时间连续可证未重登） |
| 帧4 | B→A 消息上屏 + A 端收到并回复 + B 同会话见双消息（己发双勾+对方回复）⇒ 好友关系双向生效 |
| 服务端复核 | apihelper.py：pending 列表 `data:[]` + 双方 friends 各含对方 add_time |

**桌面实装帧序**（owner 报障确切面；evidence/desktop/ d1-d6）：基线无红点 → 两条申请实推红点=2 →
菜单/面板红点2 → **同意一条后面板仍开、红点当场 2→1（d5，扣减本体证明）** → 全部同意红点消+新好友入会话列表。

**WS 帧体不可用时的留证三件套**（本块 Rust ws_proxy 不打帧体）：①红点秒级变化帧（f1/d2/d5）
+ ②logcat 事件行（会话起点 resumed=false / `[DB] 保存 N 个好友` 与同意同秒 / 收到 WS 新消息）
+ ③服务端 REST 复核。**验收前先确认应用有无帧日志能力，没有就用此口径，勿声称「WS 帧留证」却拿不出帧。**

**前置**：双模拟器 + 本块新注册账号对；`pnpm tauri android build --debug --target x86_64 --apk` + `adb install -r`。

## §5 遗留缺口（动手前先查是否已被后续块修掉）

1. 群主审批入群申请不扣 `groupJoinRequests`：`src/chat/group/useChatMenu.ts:400` handleApproveJoinRequest
   （handleRejectJoinRequest 同邻），且该计数无 REST 初始化——与本块修复前同病。
2. 多端消红点：需服务端向处理者全端广播「申请已处理」事件，或 connected 快照补 pending 计数
   （后者顺带修「重连不对账」）。改服务端契约须另开块。
3. 已知环境：干净检出全量 vitest 首跑依赖 `test-artifacts/dg80pf1a-interop/` fixture（不在 git），
   复跑前先补该目录——见 CLAUDE.md 备案族。
