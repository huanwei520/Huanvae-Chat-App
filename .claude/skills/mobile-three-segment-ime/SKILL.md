---
name: mobile-three-segment-ime
description: 移动端聊天页「键盘弹起后三段式布局」的结构契约与双护栏（header 固定 / 消息区唯一可压缩 / 输入栏贴键盘上沿），及布局类改动前后对照的真机实证方法论。触发场景：改移动端聊天布局或 chat-view.css；契约测试 tests/mobile-three-segment-ime.test.ts 被改红；scrollingElement 出现第二处引用；IME 弹起后顶栏被推出屏或输入栏不贴键盘上沿；压缩态底部消息被裁（Guard B 覆盖空隙 O1）；要做「改版前后对照」的 AVD 实测取证；要证明「条件触发的护栏」真的生效（前置态时序）。
---

# 移动端聊天页三段式 IME 布局契约（页面层）

**来源**：块 `1789041370990-4-输入布局顶固底贴键盘改版`（2026-09-10，code/review 判官双 PASS 后由 update 层沉淀；AVD 前后对照 10 态数值+截屏双实证，review 层独立重演全部复现）。

**域分工**：本 skill 管**页面层**——视口被壳层压矮之后，页面内部怎么排、怎么防布局退化为整页平移；壳层（谁把视口压矮、interactive-widget 单权威通道、构建链）见 [android-ime-follow](../android-ime-follow/SKILL.md)。键盘类问题先按三层通道模型分层，再对号入座到两边。

## §0 三段式契约（改这块之前必读）

`.mobile-chat-view` 固化为三段（锚点为 2026-09-10 工作树 grep 实测值，行号会漂移，引用配 grep 符号锚现查）：

| 段 | 元素 | 结构约束 | 锚点 |
|---|---|---|---|
| ① header | 顶栏 | `flex-shrink: 0`，键盘弹起时位移恒为零 | `src/styles/mobile/chat-view.css:54` |
| ② messages | 消息区 | **唯一可压缩段**：`flex: 1 1 0%` + `min-height: 0` | `chat-view.css:113-117` |
| ③ input | 输入栏 | `flex-shrink: 0`，贴容器底沿 = 键盘上沿 | `chat-view.css:129`、`:137` |

三条第一性认知：

- **视口变化的唯一合法表达是 flex 压缩中间段**，永不允许以「文档整体上推」表达——「整页顶起/顶栏被推出屏」的根因形态就是后者。契约头注与三段总约束注释见 `chat-view.css:2`、`:36-39`。
- **消息区是 column-reverse**（scrollTop=0 即视觉底部）——「贴底」「回底」的全部判据建立在这上面；换方向布局时护栏判定要跟着改符号。
- 中间段的滚动由**内部容器**（`.chat-messages-container`）管理，文档级滚动（`document.scrollingElement`）恒应钉在 0。

## §1 双护栏 hook（useImeThreeSegmentLayout，仅挂 MobileChatView）

`src/pages/mobile/useImeThreeSegmentLayout.ts`（79 行，grep 行号法；正常宿主上均为 no-op，异常宿主上兜底）：

- **Guard A · 文档滚动钉扎**（`pinDocument`，`:50-54`）：视口 resize/scroll 时把 `document.scrollingElement.scrollTop` 恒钉 0（`:51-52`）——防「整页顶起、顶栏出屏」。钉 0 后条件不再成立，无循环。
- **Guard B · 压缩贴底保持**（`:57-66`）：滚动跟踪用户是否贴底（column-reverse 下 `|scrollTop| ≤ BOTTOM_EPS=8`，`:25`/`:46`）；视口 resize 落定后（双 rAF）若原本贴底则强制回 `scrollTop=0`（`:64`）；`CLAMP_QUIET_MS=160` 静默窗（`:27`/`:58`）滤掉收缩瞬间各引擎钳位伪滚动。用户主动离底读历史时不打扰。
- 挂载点唯一：`src/pages/mobile/MobileChatView.tsx:37`（import）、`:248-249`（viewRef+调用）、`:271`（ref）。桌面入口不加载此链路。

**🔴 `scrollingElement` 全仓唯一性 = 行为指纹**。2026-09-10 实测枚举（`grep -rn scrollingElement` 排除 node_modules）：全仓 **3 处** = src 生产代码 1（`useImeThreeSegmentLayout.ts:51`）＋ tests 契约断言 1（`tests/mobile-three-segment-ime.test.ts:73`）＋ e2e helpers 1（`e2e/helpers/visual-settle.ts:186`，测试工具非生产代码）。即 **src 内唯一**。因此「设备上文档被钉回 0」这一行为只能来自本 hook——本块 code 与 review 两层都利用它做「新代码确在装机包内」的活性实证（CDP 置 `scrollTop=100` → 300ms 后实测回 0）。**引入第二处 `scrollingElement` 即失去该证明能力**；契约测试 `:73` 同时钉住 hook 内含该符号。

**契约测试 8 条**（`tests/mobile-three-segment-ime.test.ts`，`it(` 位于 `:46/:52/:57/:63/:68/:72/:78/:92`）：CSS 三段断言 4＋hook 挂载 1＋hook 双护栏符号 1＋**桌面零引用泄漏扫描** 1（`:78`，hook 只允许出现在 `src/pages/{mobile,styles}/mobile`）＋`interactive-widget=overlays-content` 存续 1（`:92-94`，与壳层块（android-ime-follow）配套的防双通道钉子）。**改移动端聊天布局先跑**：`npx vitest run tests/mobile-three-segment-ime.test.ts`。

## §2 布局类改动的前后对照实证配方（本块 10 态，review 层完整复现）

1. **基线界定先于一切（防基线顶替）**：装机 base.apk md5 == 盘上 APK md5 == 改版前工作树（`find src index.html tests -newermt "<构建时刻>"` 零命中）三方对账，B 组截屏才配叫「改版前」。
2. **每状态四件套**（与 android-ime-follow §2 同款）：`dumpsys input_method`（mInputShown）＋ IME frame/insets ＋ CDP 几何探针（`adb forward` + Runtime.evaluate）＋ `adb exec-out screencap -p` 设备级原件。状态集至少覆盖：收起 / 弹起 / 压缩态滚动读历史 / 回底 / 多行加重压缩 / 收起回落，改版前后各一组。
3. **黄金公式与同量纲判据**：IME 内容顶(phys) = `frame.top + contentInsets`（本例 128+1389=**1517**）；输入栏底(phys) = CSS×dpr（578.29×2.625=**1518.0**）→ **Δ=1.0px**。dumpsys 的 phys 数与 CDP 的 CSS 数必须乘 dpr 对齐后再判，阈值（≤8px）同量纲比较。
4. **review 层独立性手法**：不复用上游 CDP forward 端口（本块上游 9333 → review 自建 9334）、亲手 `input tap`/`keyevent` 重演、像素 RMS 抽查旁证前后组同场景（B1↔A1=1.65）、装机包 `adb pull` md5 对账。
5. **失误帧存档不删**：首采 `input swipe` 起点落在键盘上滑成打字"Ty"（重采覆盖，原帧存档）、guard-proof v1 时序错误记录（§3）——全部保留并披露。证据链可信度优先于「好看」。

## §3 「条件触发的护栏」活性证明：前置态必须先于触发事件

guard-proof v1 教训（错误记录保留于上游 `code/evidence/guard_proof.json` 第 1 行）：**先把容器拨到 -80 再发 resize**——此刻用户本来就不贴底，护栏按设计不动作，记录显示 `atBottomRestored:false`，看似「护栏坏了」，实则什么都没证明。正确时序（同文件第 2 行）：**先建立前置态（贴底，`atBottomWasTrue:true`）→ 触发事件（resize）→ 注入扰动（模拟钳位走样到 -80）→ 观察恢复（`after:0, restored:true`）**。写探针脚本前先自问：我要证明的那个条件，在触发事件发生的瞬间成立吗？

## §4 已知覆盖空隙（O1，非阻塞）与后续方向

「多行输入框回缩」是**独立于 visualViewport resize 的布局变化路径**：A5 态（多行打字→清空→收起）实测 `containerScrollTop=-46.86`、底消息下缘被裁约 21 CSS px（上游 review 交付 §五，`ev_A5_probe.json`；`lastRow.bottom=863.10 > msgs.bottom=842.24`）。压缩态（A1/A3/A4，验收判据范围）与纯弹收路径（review 独立重演 R2）不受影响。**修复方向**：Guard B 对「输入栏高度变化」（或监听容器 resize）也触发贴底恢复；契约测试补一条「收起回落贴底」断言。接手此域先读 review 交付 §五 再动手。

## §5 与相邻 skill 分工

- [android-ime-follow](../android-ime-follow/SKILL.md)：壳层（视口缩多少：ime() insets / interactive-widget / adjustResize；构建链三坑）。本 skill：页面层（缩了之后怎么排、怎么防回退）。
- [enter-key-strategy](../enter-key-strategy/SKILL.md)：软键盘回车键语义（IME 动作键/组字误发送）。
- [popup-clamp](../popup-clamp/SKILL.md)：CDP DOMRect 零外推量具纪律、截屏互锁手法（本块 §2 复用其思想）。
- [ui-real](../ui-real/SKILL.md)：真机 UI 验证通用流程。

## §6 来源与证据

- 交付：pipeline 区 `blocks/1789041370990-4-输入布局顶固底贴键盘改版/code/deliverable.md`（前后对照 10 态对账）与 `review/deliverable.md`（10/10 逐张目验 + 独立重演 R0-R2）。
- 关键证据：`code/evidence/verification_table.txt`（`:13` `TOTAL: 5 states judged, FAIL=0`）、`guard_proof.json`（2 行，v1 错误记录保留）、`ev_A1_imeframe.txt`/`ev_A1_probe.json`（黄金公式原始数）、`three-seg.diff`（已跟踪 2 文件 diff 存档）。
- 代码：`src/pages/mobile/useImeThreeSegmentLayout.ts`、`src/styles/mobile/chat-view.css`、`src/pages/mobile/MobileChatView.tsx`、`tests/mobile-three-segment-ime.test.ts`。
