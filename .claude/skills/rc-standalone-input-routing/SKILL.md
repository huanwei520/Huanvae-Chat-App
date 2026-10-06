---
name: rc-standalone-input-routing
description: 远控独立控制窗输入路由跨端闭环与输入捕获速查——独立 WebView 控制窗的 DC/channels 属 meeting 窗上下文导致的三类病灶（输入误投本机回环=「注入 0」、桥接收帧不入账=「帧 0」、视口 div 无焦点=键入丢失）与对应修复（isStandaloneControlWindow 三分支寻址/rc-input-up 桥、桥接 framesIn+=1、window 级 isTrusted keydown/keyup 捕获、非 passive 滚轮捕获 bit3/bit4）。改远控输入上行/帧计数/键盘滚轮捕获，或排查「点了没反应/帧 0/注入 0/按键被吞」类症状前必读
disable-model-invocation: false
allowed-tools: Read, Grep, Glob
---

# 独立控制窗输入路由与输入捕获（pz3oo1tp 沉淀）

> 来源：块 `1790709813552-pz3oo1tp-1`（修复提交 696ea186 + b22a130f，merge 66b2725a，随 v1.1.54 入 main）。
> 本落典：2026-10-06 块 `1791241251463-fmuq6rousefe405s2-3`（s2 全量回归+skill 对齐）按整改令补落
> （s1 沉淀缺口 UNMET-1）；file:line 均为 main `9fab3c7c` 工作树实查，共享在飞树行号会漂，引用前先 grep 现查。
> 与 `remote-control-signaling/SKILL.md` 分工：那边是信令链路/探活/重连；本篇是**独立控制窗的输入面**（上行寻址+帧入账+键鼠捕获）。

## 触发场景（命中任一条，先读本 skill）

- 改远控输入上行寻址（controlInput / postLocalInput / rc-input-up 桥）或帧计数；
- 排查「被控端共享全屏后控制端任何操作零反应」「状态条 帧 0 · 注入 0」「键入了但被控端没收到」类症状；
- 给控制窗加新输入形态（手势/触控板/新按键）——先看 §4/§5 的捕获纪律防重复踩坑。

## §1 病灶总览：独立 WebView 控制窗的上下文错位

桌面端控制窗是**独立 WebView**，DC（control-session DataChannel）与 Tauri channels 都属
**meeting 主窗上下文**——控制窗内直接判 `isPeerSessionActive()`（frameChannel.ts:210）恒 false。
由此三连病灶（owner 2026-09-30 报告「对端帧流中…帧 0 · 注入 0」）：

| 病灶 | 面上症状 | 根因 | 修复 |
|---|---|---|---|
| ①输入误投 | 任何操作零反应，「注入 0」 | api.controlInput 仅判 isPeerSessionActive ⇒ 每次点击误落 postLocalInput 投到**控制端本机** daemon（缺席/未受戒即丢），0x06 永不入 DC | 三分支寻址（§2） |
| ②帧不入账 | 「帧 0」与画面实际到达并存 | RC_FRAME_DATA 桥接交付不入账 framesIn（DC 直连路径 ingestSlice 有 +=1，桥接路径漏同源计数） | 桥接 +=1（§3） |
| ③键入丢失 | 真机鼠标注入正常、键盘丢字 | onPointerDown preventDefault 阻止 mousedown 默认聚焦 ⇒ 视口 div 拿不到键盘焦点 ⇒ React onKeyDown 永不触发 | window 级捕获（§4） |

**判别式**：看到「帧 0 / 注入 0 / 键入丢」，先分清症状走的是哪条交付路径（DC 直连 vs Tauri 事件桥），
再查对应计数点/寻址分支；不要被「连接正常」的探活状态带偏（链路 A/B/C 分辨法见 remote-control-signaling §0）。

## §2 修复①：输入上行三分支寻址

`api.controlInput`（src/remote-control/api.ts:164-171）按序三分支：

1. **DC 属主 + 会话在位**：`isPeerSessionActive()` ⇒ 直发 DC（跨端主路，不回归）；
2. **独立控制窗**：`isStandaloneControlWindow()`（frameChannel.ts:226，判据 `!dcOwner && hasTauri()`）
   ⇒ 走 Tauri 事件 `rc-input-up` 桥（frameChannel.ts:76）回 meeting 窗，由主窗转发（api.ts:154-156 注释即根因记录）；
3. **兜底本机回环**：`postLocalInput`（api.ts:175）——无会话时落本机 daemon（**单机演示链保活**，防回归；
   桥回 meeting 窗但无跨端会话也落此，单测 tests/unit/rcStandaloneInputRouting.test.ts:100）。

纪律：**postLocalInput 是本机回环投递原语，只供被控端注入汇（frameChannel.relayInjection）与兜底分支**；
新增输入入口禁止无脑直调（正是修复①前的病灶形态）。桥的建立见 `ensureInputUpBridge`（frameChannel.ts:470）。

## §3 修复②：桥接帧计数同源入账

RC_FRAME_DATA 经 Tauri 事件桥到控制窗的交付路径，必须与 DC 直连重组路径（ingestSlice 处 `framesIn+=1`）
**同源计数**：桥接交付处 `stats.framesIn += 1`（frameChannel.ts:430，注释即「帧 0」根因记录）。
长度不符的脏帧**不入账不交付**（防御性对齐，单测 test:138）。改帧路径时两个计数点都要顾及，漏一处就是「帧 0」复发。

## §4 修复③：window 级键盘捕获（不依赖 div 焦点）

- 捕获核心抽成 `sendKey(key, isDown)`（ControlWindow.tsx:252）供双路复用：
  **React 链**（onKeyDown/onKeyUp，:272/:277——dev 合成事件走此路）+
  **window 级捕获**（:298-299 原生 addEventListener keydown/keyup）。
- window 级监听只信任真实输入：`!e.isTrusted || isFormTarget(e.target)` 直接放行（:289/:294）——
  isTrusted 防 dev 派发双计；INPUT/TEXTAREA 让位保表单可用。
- 教训本体：`onPointerDown` 的 preventDefault（防文本选择/右键菜单误触的副作用）会连带阻止 mousedown
  默认聚焦 ⇒ 视口 div 永远拿不到键盘焦点 ⇒ 一切依赖 div 焦点的 React 键盘链路死透。**控制窗类全屏视口组件
  的键盘捕获必须 window 级 + isTrusted 门**，不要依赖元素焦点。

## §5 滚轮捕获：非 passive 原生监听 + 既有 buttons 域空闲位

- React 17+ 对 wheel 在根节点按 passive 挂载，JSX onWheel 无法 preventDefault（控制窗自身会跟着滚）
  ⇒ 必须在 viewport 元素挂**非 passive 原生监听**（ControlWindow.tsx:312-327，`{ passive: false }` 在 :325）。
- 滚轮是瞬时事件（无按住态）：编码为 buttons **bit3(上)/bit4(下)** 的单发 0x06
  （`BUTTON_WHEEL_UP/DOWN`，coordinates.ts:88-89——既有 buttons 域空闲位，**非新协议域**）；
  被控端 Windows 臂 `MOUSEEVENTF_WHEEL`（src-tauri/src/rc_inject.rs:83，:121-132 派发；
  **瞬时事件不入 held 快照态**，快照重放不含滚轮）。
- 右键：`onContextMenu` 阻断（ControlWindow.tsx:434），注入不再被本地菜单挡。
- **已知缺口（产品级待总监裁决，coordinates.ts:83 登记）**：hv-control-daemon 标准件 XTEST 映射
  （HuanvaeRemote 仓 mapping.rs）仅认 bit0-2 ⇒ Linux 被控端滚轮需 daemon 仓同轮改造，App 仓内已闭环。

## §6 改动自查命令（改输入路由/帧计数/捕获后必跑）

```bash
npx vitest run tests/unit/rcStandaloneInputRouting.test.ts   # 7 项：路由三分支(:68,:86,:100)/桥接帧计数+脏帧(:117,:138)/滚轮位与0x06线格式(:151,:162)
grep -n "isStandaloneControlWindow\|rc-input-up" src/remote-control/frameChannel.ts src/remote-control/api.ts   # 寻址锚点现查
grep -n "MOUSEEVENTF_WHEEL\|BUTTON_WHEEL" src/remote-control/coordinates.ts src-tauri/src/rc_inject.rs          # 滚轮位两端对账
```
