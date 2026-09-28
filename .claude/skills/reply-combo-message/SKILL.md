---
name: reply-combo-message
description: 引用回复组合消息（原消息快照随负载下发）的字段结构、渲染兜底与跨端互发实测配方 — hv_combo_v1 信封走 message_content 扩展字段零协议改动、ReplySnapshot 六字段职责表、全字段严格校验拒收畸形输入、可选字段=版本演进通道、三级渲染优先级（本地反查→随包快照→占位）、信封只在数据入口拆的不变式与 7 处 strip 收口清单、快照显示字符串禁带发送方视角（「我」上行坑与 sender_id 身份锚点解法）、冷启动窗口外引用复现构造、六类跨端互发截图证据集。要做「消息负载加随包扩展数据」「改引用回复/引用块渲染」「改会话预览/搜索/通知等读 message_content 原文的面」或要为引用类改动做 Android↔桌面双向实测时，先读本 skill。
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Write
---

# 引用回复组合消息（快照随负载）字段结构与实测

> 来源：块 `1790275127298-2pb06083-1-改造引用回复为组合消息并实测`（2026-09-25：code 层提交 a0f38be8+df36d45c、review 8 项全过；owner 2026-09-24 实拍「原消息未加载，点击定位」空壳占位为病灶）。
> 消毒：信封三函数调用点与 strip 清单全部 grep 现查锚定（写典时点 src@df36d45c），后续改动若失配以现场 grep 为准。

## 触发场景（命中任一条，先读本 skill）

- 消息负载要**随包携带扩展数据**（快照/引用/卡片上下文等），担心动协议主干或服务端不兼容；
- 引用回复气泡显示「原消息未加载，点击定位」灰占位，要根治而非补丁；
- 新增/修改**读 message_content 原文字符串**的面（预览、搜索、通知、分享、列表）；
- 引用类改动要做 Android↔桌面双向互发实测与判官可复算证据包。

## §1 信封 wire format（走 message_content，协议主干零改动）

```json
{"hv_combo_v1":1,"text":"<回复正文>","reply":{"reply_to":"<原消息uuid>","sender_name":"…","summary":"…","message_type":"text","send_time":"ISO|null","sender_id":"<可选>"}}
```

- `message_type` 恒 `'text'`，信封 JSON 进既有 `message_content`（该字段本有 meeting_invite/card/group_card JSON 载荷先例，服务端按不透明字符串中转，≤10000 字符内）。**两提交 0 个 src-tauri 文件**即此纪律的实证形态。
- 六字段职责：`reply_to`=定位锚点（点击跳转仍走它，与外层 reply_to 同值冗余防失配）；`sender_name`+`sender_id`=显示与身份；`summary`=内容可见（占位条消失的直接原因）；`send_time`/`message_type`=快照完整性（现版渲染不读，留未来 UI）。
- 纯函数层 `src/chat/shared/combinedMessage.ts`：`buildCombinedMessageContent` 打包 / `parseCombinedMessageContent` 拆包 / `stripCombinedEnvelope(Nullable)` 收口，零 React 零 Tauri。

## §2 解析纪律：全字段严格校验，宁当文本不半拆

识别信封必须同时过：`{` 开头快速否决（普通文本零成本）→ JSON.parse 成功 → `hv_combo_v1===1` → text/reply 类型合格 → reply_to/sender_name/summary/message_type 四字符串字段全合格 → send_time 缺省容忍但出现必须 string → sender_id 同理。**任何一处不合格整包返回 null 当普通文本**——防用户手打/粘贴酷似信封的 JSON，防旧消息半拆崩溃。

**可选字段=版本演进通道**：新字段一律「可选+出现必须类型合格」。实证：首版信封无 sender_id，DB 里首版（seq 62–64）与带 sender_id（65–67）同库并存且都正常渲染；旧信封永不过期。

## §3 渲染三级优先级 + 入口拆包不变式

`resolveReplyQuoteFromMessage`（replyPreview.ts）：

1. 本地窗口反查命中 → 用本地值（反映最新状态，如原消息刚被撤回）；
2. 反查落空 + 快照存在且 `snapshot.reply_to === message.reply_to` → 渲染快照；`sender_id===currentUserId` 才本地化「我」，否则原样 sender_name；
3. 都没有 → 原灰占位「原消息未加载，点击定位」，零变化可点可跳。

**不变式：信封只在数据入口拆**（DB→UI 与 WS→UI）。拆完下游拿到的 message_content 是纯正文 + `reply_snapshot` 字段。调用点清单（写典时点 grep 现查）：

- parse＝2 文件 4 处：useLocalFriendMessages.ts :107/:994、useLocalGroupMessages.ts :104/:921；
- build＝2 处：useLocalFriendMessages.ts:631、useLocalGroupMessages.ts:566（仅 wire 信封，乐观消息与本地 UI 恒纯正文，本地库**存原样信封**故重启后快照仍可用）；
- strip＝7 文件 7 处：messagePreviewText.ts:65、wsHandlers.ts:102、MobileChatList.tsx:134、ShareTargetPicker.tsx:157、GlobalMessageSearchResults.tsx:143、UnifiedList.tsx:271、useLocalConversations.ts:72。

判别口诀：**走 UI 消息对象→已拆好；读原始字符串（DB last_message/WS preview/群 last_message_content/搜索索引）→必须 strip**。新增读原文的面漏 strip = 预览裸 JSON 泄漏。

## §4 踩坑速查

1. **快照显示字符串禁带发送方视角**：sender_name 存的是发送方视角名字（私聊自己的消息=「我」），原样上行会把别人消息错标成「我」（DB seq 63 铁证）。解法三层：信封加可选 sender_id、发送端一律换真实昵称、接收端比对 currentUserId 才本地化。**凡随负载下发的显示字符串必须是接收端可独立解读的原始值；视角化靠身份锚点在接收端做。**
2. **泄漏面比想象多**：只拆数据入口会漏 7 个读原文的面（§3 清单）；旧代码基线对照截图（d50）留泄漏实锤。
3. **类型摘要禁落截断兜底**：summarizeMessageForReply 对 group_card 等结构化类型必须显式给标签（[卡片] 等），落到 default 截断分支 = 引用块裸 JSON。
4. **定位锚点与快照渲染解耦**：点击跳转恒走 reply_to → locateMessage，别把快照渲染接进定位链。

## §5 跨端互发实测配方

- **复现构造＝「窗外引用」**：灌 ≥50 条消息→冷启动只加载最近 50 条→对窗外 seq 发引用回复。DB `SELECT COUNT(*),MIN(seq),MAX(seq)` 证明目标在窗外即可，不靠肉眼。
- **六类截图一张不少**（发送与接收各留一张才算互发）：①A→B 实时收到 ②B→A 实时收到 ③冷启动纯快照无占位 ④点击定位跳转（历史拉满原消息到窗顶）⑤旧格式四案例同屏（本地命中/真旧消息占位可点/不崩溃）⑥旧代码基线对照。
- **证据三件套**：截图原件 md5 全表＋DB 信封逐字 dump（bug 态与修复态各留行）＋门禁四门完整输出落盘（log+exit+meta 三件，md5 与交付逐字节对得上才可引用）。
- 环境：环境池 POST /claim 租模拟器用毕 release；Android `adb exec-out screencap -p`，桌面 Xvfb `import -window root`；APK `assembleX86_64Debug -x rustBuildX86_64Debug`。

## 相邻 skill 分工

- 转发实时性/双机时序/凭据终扫 → `forward-echo-e2e`；真机 UI 驱动通道 → `ui-real`；引用链四段静默丢失旧训 → rules/common.md「报打通之前问一句」节。
