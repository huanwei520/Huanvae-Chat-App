---
name: tauri-multi-window
description: Tauri WebviewWindow 多窗口落地模式与真窗口实测配方 — 建窗三件套（main.tsx pathname 路由分支 + getByLabel 幂等开窗函数 + 独立窗口页组件）缺一不可、窗口参数选型（decorations:true=原生拖动/缩放/关闭的来源、尺寸必给 min、右侧定位避让主窗、不强置顶）、capabilities windows 数组追加 label=运行时建窗唯一权限声明落点（tauri.conf 静态声明反而开机自建违语义）、事件三通道+destroyed 设计（业务与状态留原窗单一事实源、新窗纯 UI+意图/结果事件）、关闭语义四行矩阵、三大坑（成败轮询时限必须按 WebView2 原生选源器人工选择耗时设 30s 级而非代码速度 4s 级、parseMediaError 吞 AbortError/unknown 致新窗看不到失败原因需旁路遥测、RESULT+STATE 双通道兜底真救场）、共用 UI 三层拆法（类型层 re-export 零破坏/面板组件层单源双引用/宿主壳 isDesktop 单点条件化）、安卓零 diff 空输出实证法、真窗口实测五件套证据（同框对比图=独立性硬证据/拖动前后帧/三方同框/终态帧/局部 rcapture）+ sha256 manifest + 环境改道留痕口径。要把窗内 UI 提升为独立系统窗口、做 Tauri 多窗口通信/关闭语义、或实测「新窗口与主窗分离可拖动」类需求，先读本 skill 再动手。
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Write
---

# Tauri WebviewWindow 多窗口：落地模式与真窗口实测

> 来源：块 `1789993429798-pvmk3dxq-1-桌面分享框改独立窗口并实测`（2026-09-21，集成分支
> integration/pvmk3dxq-share-window 三提交 c41ccc18→cb11aff0→bf8f9d40，基点 c19406c9；
> 判官 PASS、review 层 6/6 PASS）。桌面分享选择框从会议窗内 framer-motion 模态改为独立系统
> WebviewWindow（label=screen-share，路由 /screen-share），Windows 环境池真机全链路实测通过。
> 本 skill 是该块的完整复用配方；处理前全仓 33 个 skill 无一覆盖本域（grep 取证见该块
> update/deliverable.md §0③），本文即补此缺口。

## 触发场景（命中任一条，先读本 skill）

- 要把窗内 UI（弹窗/面板/选择器）提升为**独立系统窗口**（"分享框变成单独的框"类需求）；
- 要做 Tauri 多窗口事件通信、窗口关闭语义、或新窗与原窗的状态同步；
- 要实测"新窗口与主窗分离、可拖动"并留设备级证据；
- 排查"独立窗误报失败/看不到失败原因/窗口该关没关"类问题。

## §1 建窗三件套（缺一不可，先查仓内先例照抄）

1. **路由分支**：src/main.tsx 顶层 `if (pathname === '/xxx') return <XxxPage/>`——仓内既有
   /meeting、/media、/lan-transfer、/theme-editor、/stocks 等同机制；
2. **开窗函数**（独立模块）：`WebviewWindow.getByLabel(label)` 命中→`setFocus()` 返回（幂等）；
   未命中→`new WebviewWindow(label, { url, … })`，并 `once('tauri://error')` 兜底（本块先例：
   src/meeting/screenShareWindow.ts:54-77；更早先例 src/theme/api.ts:21-41）；
3. **独立窗口页组件**：纯 UI + 事件，**零业务**（见 §2）。

**窗口参数选型**（本块实测有效）：`decorations:true` 是"独立感"核心——系统标题栏（—□×）免费
带来原生拖动/缩放/关闭，勿自实现拖拽；尺寸必给 `minWidth/minHeight`（防缩破布局）；定位避让
主窗（右侧并排）优于 center；不设 alwaysOnTop（普通 z 序，alt-tab 可达）；`focus:true`。

**框架最小触碰 = 仅 capabilities**：`src-tauri/capabilities/default.json` 的 `windows` 数组
追加新 label（如 `"screen-share"`）。**运行时建窗不需要也不应该**在 tauri.conf.json 静态声明
窗口——静态声明会开机自建，违背"点了才弹"语义。

## §2 事件通道与关闭语义：谁持有状态，谁就是通信中枢

三通道 + 一监听（常量集中一个模块定义，本块 screenShareWindow.ts:31-52）：

| 通道 | 方向 | 载荷/语义 |
|---|---|---|
| `<域>-window:confirm` | 新窗 → 原窗 | 用户确认的设置载荷（"发意图"） |
| `<域>-window:result` | 原窗 → 新窗 | started/failed + 诊断 detail（"回结果"） |
| `<域>-window:state` | 原窗广播 | 状态广播；关键态时新窗自关兜底（双保险） |
| `tauri://destroyed` | 原窗监听新窗 | 新窗被 X/取消 → 原窗清 pending = 取消语义 |

**铁律：业务与状态留原窗单一事实源，新窗只承载 UI 与意图/结果事件。** 本块 toggleScreenShare/
getDisplayMedia/controlArm 全留会议窗，共享状态天然只存在一份，不需要状态同步协议。

**关闭语义四行矩阵（动码前先写清）**：成功→原窗主动关（closeXxxWindow）；取消/X→新窗自毁+
原窗 destroyed 监听清 pending；原窗卸载→收孤儿窗；STATE 广播关键态→新窗自关兜底。

## §3 三大坑（真机才暴露，代码评审发现不了）

1. **成败轮询时限 < 人工选源耗时 → 误报 failed**。WebView2 原生选源器要人手动选源，4s 级
   （250ms×16）轮询必误判；按人的反应速度设 **250ms×120=30s**。凡确认链含"系统原生 UI +
   人工交互"，超时按秒级到 30s 级设，不按代码速度设。
2. **既有错误解析吞取消/未知错误**（parseMediaError 对 AbortError/unknown 不进 mediaError）→
   新窗看不到失败原因。解法：旁路遥测（lastScreenShareError 纯记录零语义变化）经 result
   detail 回传展示。新 UI 依赖旧错误通道前，先验证错误真能到达。
3. **双通道兜底真的救场**：轮询误报期间，STATE 广播兜底仍让新窗在共享真正开始后正确自关。
   "结果通道 + 状态广播"双保险是多窗口标配。
   另：WebView2 原生选源器是系统级英文 UI（Chromium 组件），应用层无法样式化/中文化——别把
   选源器外观算进交付面。

## §4 共用 UI 不复制两份：三层拆法 + 零破坏实证

- **类型/常量层**：类型、RESOLUTION_MAP、可用性过滤抽独立模块，原模块 **re-export**——
  既有导入方一行不改；
- **面板组件层**：选项 UI 抽成无窗口概念的纯组件，窗内兜底模态与独立窗页**都只引用它**
  （单一事实源，grep 全仓仅两处引用可证）；
- **宿主壳层**：`isDesktop()` 单点条件化（先例 src/remote-control/dispatch.ts）——桌面开独立
  窗，建窗失败回退窗内模态（优雅降级）；安卓零引用窗口化 API，仍走自有流程。
- **安卓零变化实证法**：`git diff <基点>..<HEAD> -- <移动面路径列表>` 输出为空 + rc=0，
  一命令证明，比逐文件声称可信。

## §5 真窗口实测与取证（"与主窗分离可拖动"类验收的证据设计）

- **证据五件套**（设备级 PNG 原件 + sha256 manifest + `file` 规格核验）：
  ①**同框对比图**（alt-tab 或桌面全景，主窗+新窗同屏）——单窗截图证明不了"独立"，这是硬证据；
  ②拖动前后两帧（位置明显不同仍独立）=可拖动；③三方同框（原生选源器+新窗 pending 态+原窗）
  =事件回传链路真实打通；④终态帧（共享指示条+瓦片递归画面+新窗已自动关）=关闭语义按设计；
  ⑤局部 rcapture 原图（如状态钮 70×70）=状态细节放大可验。
- vncdo 脚本化驱动：每条 `move/click` 后紧跟 `rcapture`，操作序列与截图一一对应可重放。
- **环境改道必须留痕**：卡面指定机器不可用时，现查证据（ping/端口/ Coordination 板摘录）+
  改道登记（VM-COORDINATION.md 占用段）+ 用毕 DONE 还原段，三段齐备，否则判官无法区分
  "改道"与"跳过实测"。
- 多窗口/跨窗异步链路**第一版就带诊断回传通道**（result detail 展示区），否则真机排障靠猜
  （本块轮询误报正是靠它当场定位）。

## §6 复用清单（开工前过一遍）

1. grep 仓内 `WebviewWindow` 先例；路由/开窗函数/窗口页三件套；capabilities windows+label。
2. 关闭语义矩阵先写清再动码；事件常量集中一个模块。
3. 新窗纯 UI；业务留原窗；超时按人工交互耗时设；错误通道可达性先验证。
4. UI 三层拆 + re-export + isDesktop 单点条件化 + 移动面零 diff 空输出实证。
5. 实测五件套 + sha256 manifest + 环境改道三段留痕 + 用毕 release/DONE 还原。
