---
name: android-ime-follow
description: 安卓端软键盘弹起「输入框不跟随/被遮挡、收起不回落」的根因诊断与修复模式（Tauri WebView 类 App 通用）。触发场景：键盘弹起输入框被遮挡或不回落；edge-to-edge 下 adjustResize 不生效的排查；windowSoftInputMode 与「偶发不跟随」；viewport meta 的 interactive-widget 配置与双通道冲突；ime() insets 键盘高度监听的实现；AVD 键盘跟随实测取证（dumpsys/CDP 探针/反复弹收循环）；tauri android build 构建链排障（NDK 目录布局/gradlew WebSocket//tmp 残留）。
---

# 安卓 IME 键盘跟随（edge-to-edge 时代的单一权威通道）

**来源**：块 `1789041370990-3-修输入法弹起输入框不跟随`（2026-09-10，code/review 判官双 PASS 后由 update 层沉淀；AVD 实测 20 弹收循环 40/40 PASS、复核独立 3 轮 6/6 PASS）。

**锚点口径**：下列 file:line 为 2026-09-10 工作树值（update 层 grep 行号法亲验，输出原文见该块 update/deliverable.md）。行号会漂移，引用一律配 grep 符号锚现查（如 `grep -n installImeKeyboardFollow MainActivity.kt`）。

## §0 三层通道模型（先分层，再动手）

键盘弹起时页面要「变小」，全系统只有三个可能的执行者。Keyboard 遮挡类 bug = 三方全空（无人缩）；修复后的新坑 = 多方同动（双通道打架，输入框悬空一个键盘距）：

| 层 | 执行者 | 开关/条件 | 本仓现态（2026-09-10） |
|---|---|---|---|
| ① 系统窗口缩放 | Activity 窗口 | `windowSoftInputMode=adjustResize`；**API 30+ 且 edge-to-edge 下整体静默失效** | 仅 API 28/29 兜底：`AndroidManifest.xml:40` |
| ② Chromium ime-inset 视口重排 | WebView 引擎 | viewport meta `interactive-widget`（Chrome/WebView ≥108，Android） | 显式关闭：`index.html:23` `interactive-widget=overlays-content` |
| ③ 应用自绘（唯一权威） | 壳层 Kotlin | `WindowInsetsCompat.Type.ime()`（**API 30+ 才可用**） | `MainActivity.kt:77` `installImeKeyboardFollow` |

三条第一性认知：

- **edge-to-edge 杀死 adjustResize 是「整体静默」的**：`enableEdgeToEdge()`（MainActivity.kt:24）→ `setDecorFitsSystemWindows(false)` → 窗口 frame 恒为全屏，系统不再帮任何人缩——不是「不可靠」，是彻底没人缩。API 30+ 项目同时用 edge-to-edge 时，不要指望 adjustResize 生效。
- **「偶发不跟随」的经典来源 = adjustUnspecified 的随机性**：Manifest 未声明 windowSoftInputMode 时，系统在可缩放路径上可能随机选 `adjustPan`（平移整窗、输入框不重排，「有时跟随有时不跟随」）。显式声明消灭随机性。
- **双通道叠加是修复时自己引入的坑**：壳层缩了 WebView、Chromium 又缩视口 → 输入框悬空一个键盘距。所以②必须显式关（overlays-content），保证只有③一个权威。

## §1 修复三件套 + 契约锁（本仓实测在位锚点）

1. **壳层** `MainActivity.kt`：`:33` onWebViewCreate 内调用 `installImeKeyboardFollow(webView)`；`:77` 起挂 WebView **父容器**的 ime() insets 监听（`addOnAttachStateChangeListener` 等 attach 再挂——wry 的 `onWebViewCreate` 早于 `setContentView`，等 attach 无竞态）；`:92` 起 `applyImeHeight`：`imeBottom ∈ [1, containerH)` → WebView 高 = 容器高 − 键盘高，否则恢复 `MATCH_PARENT`。**`:83` insets 原样返回（不消费）**——不碰 WebView 自身 insets 派发槽位，`env(safe-area-inset-*)` 原生链路不变。修键盘跟随不能顺手破坏 safe-area。
2. **Manifest** `AndroidManifest.xml:40` `android:windowSoftInputMode="adjustResize"`：只服务 API 28/29（`Type.ime()` 需 API 30+，老系统上③自然空转）；API 30+ 上①不生效、与③不冲突，留着无害。
3. **Web 壳** `index.html:23` viewport meta 含 `interactive-widget=overlays-content`（全仓唯一 HTML 入口、唯一 viewport meta 定义点，检索见 §3）。
4. **契约测试锁** `tests/safe-area-viewport.test.ts`（断言在 :28）：删 `interactive-widget=overlays-content` 即红——viewport meta 是一行小字、最容易被无意删掉，用测试固化「删除必红」（复核端突变红→绿已实证）。并发块 -4 又加了第二把锁 `tests/mobile-three-segment-ime.test.ts:92-94`。

## §2 AVD 实测配方（每状态四件套 + 黄金公式）

```
input tap 弹键盘 → ① screencap 截屏原件   ② dumpsys input_method（mInputShown）
                 → ③ dumpsys window windows（IME frame + mGivenContentInsets）
                 → ④ CDP 探针（adb forward → Runtime.evaluate 读 innerH/dpr/输入框 rect）
→ input keyevent 4 收起 → 同套采集 → 循环 N 轮
```

黄金公式（AVD 1080×2400、dpr 2.625、SDK 34 实测基线）：

- **IME 内容顶(px) = InputMethod 窗口 frame.top + mGivenContentInsets.bottom**（本例 128+1389=1517；`touchable region` 可互证）
- **WebView 底(px) = innerH(CSS) × dpr**（578×2.625=1517）
- UP 判 PASS：两值 Δ≤8px 且输入框底 < IME 顶（零遮挡）；DOWN 判 PASS：`mInputShown=false` 且 innerH 回满（915 CSS）、输入框底回基线（897.90 CSS）
- 本块结果：20 弹收循环 40/40 PASS（Δ=0px）。
- **判读坑**：键盘收起后 dumpsys 的 InputMethod window 条目有**残留读数**（本例 ime_top=2274），不代表键盘还在——down 判据只依赖 `mInputShown=false` + 视口回满，判读文档必须写明，否则后人复算误判。

量具与截屏互锁的通用手法（CDP DOMRect 零外推、截屏三证、时钟↔mtime↔探针 ts 互锁、哈希查重「up/down 不混组」）不在此重复：见 [popup-clamp](../popup-clamp/SKILL.md)、[ui-real](../ui-real/SKILL.md)、[android-screenshare-e2e](../android-screenshare-e2e/SKILL.md)。

## §3 桌面端边界——双端结论的三层分离写法

主张「桌面不受影响」时，把结论拆成三层呈现，**禁止混写**（引擎行为猜测与代码结论混写 = update 层判官打回实例，块 1789041370990-3 第 1 次执行 §六-6）：

1. **代码级事实（仓内可证：给穷举检索 + file:line + 真实输出）**：本块实测 `interactive-widget` 全仓命中 11 行、分布于 6 个文件（index.html、MainActivity.kt 注释、tests 两个、src/pages/mobile、src/styles/mobile），**零桌面消费方**；Rust 后端 `src-tauri/src` 对 `viewport`、`ime|keyboard|softinput` 两组检索均 No matches found；前端 `visualViewport` 唯一命中 `src/pages/mobile/useImeThreeSegmentLayout.ts:36`（仅 `MobileChatView.tsx:249` 挂载）；`tauri.conf.json` 桌面窗口为纯尺寸配置（无 IME/键盘键），`frontendDist: "../dist"` 全端共享单一构建产物。
2. **引擎级声明（外部知识，明确标注非仓内可证）**：`interactive-widget` 的消费方是 WebView 引擎自身的 Android 视口逻辑；Windows（WebView2）/Linux（WebKitGTK）桌面端软键盘为系统浮窗、无 inset 通道，该 key 无可观察效果。注意：index.html:15-20 注释块（「桌面浏览器/Playwright 忽略」在 :18）一句是 code 层自书的声称，**不构成本命题的独立证据**。仓内代码只能证「无应用层消费方」，证不了引擎内部行为。
3. **运行态实测（转述必须标注）**：桌面零改动＝mtime/git 双证（上游 review 交付 §七-5 实测，本层未复算）；全量 vitest 全绿（桌面环境跑）引上游实测并标注。

## §4 构建链三坑（本块实际踩过）

| 坑 | 现象 | 解法 |
|---|---|---|
| gradlew 直跑 | `failed to build WebSocket client: Connection refused`——gradle 的 rustBuild 任务回连 tauri CLI 的 WebSocket | 必须由 `pnpm tauri android build` 作父进程驱动，不能直接 `./gradlew` |
| tauri-cli 找不到 NDK | `failed to ensure Android environment`——tauri-cli 只认 `$ANDROID_HOME/ndk/<ver>` 目录布局，本机 NDK 装在别处 | `ln -sfn` 把 NDK 链进它认的路径（仓外系统修正，零仓内改动） |
| 重做残留 | 上回合被杀遗留的 `/tmp/*-server-addr` 陈旧 WS 地址文件把后续构建带偏 | 重做任务先清 /tmp 残留；全程每条命令带 timeout、分步执行，杜绝无界阻塞 |

## §5 与相邻 skill 分工

- [enter-key-strategy](../enter-key-strategy/SKILL.md)：管**回车键语义**（软键盘 IME 动作键派发、IME 组字 isComposing 误发送）——「按了键盘会发生什么」；本 skill 管「键盘弹起后页面布局怎么跟着变」。同域近邻不合并；排查键盘类问题时两边都要看。
- 页面层布局护栏（视口变矮后 flex 三段式压缩、贴底保持）：已由块 -4 update 层沉淀为 [mobile-three-segment-ime](../mobile-three-segment-ime/SKILL.md)（三段式契约/双护栏 hook/scrollingElement 唯一性指纹/前后对照实证配方）；源码锚 `src/pages/mobile/useImeThreeSegmentLayout.ts` 头注释 + `src/styles/mobile/chat-view.css:1-13` 契约头注。
- 长任务/被杀重做纪律（timeout、分步、增量存档）：[long-task-card](../long-task-card/SKILL.md)。

## §6 来源与证据

- 修复交付：pipeline 区 `blocks/1789041370990-3-修输入法弹起输入框不跟随/code/deliverable.md`（根因链/diff/AVD 40 状态对账/排障披露）
- 复核交付：同块 `review/deliverable.md`（verdict: PASS；独立 3 轮复测 + 截屏互锁 + 契约突变红→绿 + §七 7 条可复跑抽验命令）
- 关键 diff：`code/evidence/fix_android.diff`；对账表：`code/evidence/verification_table.txt`、`review/evidence/rvw_verification_table.txt`
