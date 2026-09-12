---
name: popup-clamp
description: 弹层/浮层（长按·右键上下文菜单、popover）可视区+安全区钳制通用做法与真机实测清单 — 双道钳制（首帧估算占位 + useLayoutEffect offsetWidth/Height 实测二次校正 paint 前）、四向边界=max(padding, env(safe-area-inset-*)) 探针 + --sai-* 兜底、区间防倒挂、上→下翻转 + 空间大侧回钳、触点合成矩形兜底；量具纪律=CDP getBoundingClientRect 直读设备 WebView 为零外推验收量（截图像素外推只能当旁证：墨迹+部分 padding 欠估 58.3 vs 真值 62.02css）；边缘场景实测清单（左/右/底缘、翻转+safe-area 同场景、窄屏宽溢出退化、关闭复核、桌面零回归正对照、logcat 兜底）；量具与判据坑五条（offset 取整/模拟器横向 inset 物理为 0 需单测参数化/近白渐变击穿白度判据改色差分离/jsdom 无布局引擎测不出几何/存量同族未迁移清单含文件名外同族）。要给浮层菜单实现或整改钳制、验弹层完整不溢出（含刘海/手势条安全区）、或给弹层验收选量具时，先读本 skill。
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Write
---

# 弹层钳制：可视区 + 安全区通用做法与真机实测清单

> 来源：块 `1789015782517-4-长按菜单三缘限位实测`（2026-09-10，code 4 轮 + review 2 轮收敛后 update 层沉淀）。
> 实码基准：`src/chat/shared/menuPlacement.ts`（154 行）+ `src/chat/shared/MessageContextMenu.tsx`（mobile 分支）。
> 🔴 行号锚 = 2026-09-10 工作树 grep 现查值；源码会漂移，引用时以 grep 现查为准（禁抄行号）。
> 上游实测证据：`test-artifacts/menu-edge-clamp-r5-20260910T0846Z/`（14 文件，SHA256SUMS 可 `sha256sum -c` 复算）。

## 触发场景（命中任一，先读本 skill）

- 给浮层/菜单（长按、右键、上下文菜单、popover）实现或整改「不溢出可视区」钳制；
- 验收声称「菜单完整在可视区**含安全区内**」（刘海/手势条/系统栏）；
- 给弹层类验收**选量具**（截图？DOM？像素？谁能当验收量、谁只能当旁证）；
- 排查实机 bug：菜单画进状态栏/被屏幕边裁切/压住输入栏/贴边把 x 推成负值。

## §1 通用做法七条（实码锚点）

1. **双道钳制**：首帧用静态估算只做「占位」（防闪跳），`useLayoutEffect` 渲染后用
   `offsetWidth/offsetHeight` 实测重跑**同一个**钳制纯函数，paint 前完成校正。
   锚：`MessageContextMenu.tsx:216`（useLayoutEffect）、`:228`（重钳调用）、`:286`（首帧估算）、`:213`/`:265`（设计注释）。
   为什么静态估算不可信：base 版「每项 52 + padding」估宽 328、固定高 44，而 6 项菜单设备真值
   **291.52×62.02 css**（CDP DOMRect 直读）——估算高比真值矮 18px，不翻转时菜单底边压住气泡顶边 ≈10px。
2. **四向边界 = max(padding, inset)**：`boundLeft/boundRight/boundTop/boundBottom` 各取
   `Math.max(padding, env(safe-area-inset-*))`。锚：`menuPlacement.ts:125-128`。
   padding 是审美下限，inset 是物理下限，二者取大——只取 padding 菜单会画进系统栏/刘海下。
3. **safe-area 取值：探针 div 读 env() + CSS 变量兜底**：`probeSafeAreaInsets()` 建临时 div 以
   `padding:env(safe-area-inset-*,0px)` 四向读运行值，再与 `:root` 的 `--sai-top/--sai-bottom`
   兜底变量取 max（不支持 env() 的老 WebView 口径），探针用完即删。
   锚：`menuPlacement.ts:83`（函数）、`:88-89`（探针样式）、`:106/:108`（max 合成）。
   **前置契约**：`index.html` 的 viewport meta 必须带 `viewport-fit=cover`（`index.html:16-17`，
   机制注释 :6），否则 env() 恒 0——该契约有单测钉着（`tests/safe-area-viewport.test.ts`，
   见 `menuPlacement.ts:29` 注释锚）；兜底变量写点在 `src/utils/safeAreaFallback.ts`。
4. **区间防倒挂**：先算 `minX/maxX/minY/maxY` 区间，且 `maxX=Math.max(minX,…)`、
   `maxY=Math.max(minY,…)` 兜底——窄屏 + 宽菜单时「右边界−菜单宽」可为负，不兜底会把 x 推成
   负值画出左屏（base 版缺陷实例：320dp 视口 6 项 → x=−18）。锚：`menuPlacement.ts:131-134`。
5. **水平**：居中后钳进 `[minX,maxX]`。锚：`:138`。
6. **垂直三段**：上方优先（`yAbove≥minY` → above）→ 放不下翻下方（`yBelow≤maxY` → below）
   → 两侧都放不下按空间大侧回钳。锚：`:141-153`（含 spaceAbove/spaceBelow 注释）。
   🔴 **翻转与 safe-area 是同一条路径**：顶部 inset 大时「上方放不下」自然触发翻下——
   本任务场景 A 实机即此（inset.top=49px > yAbove=40.71 → 翻到气泡下方），避让+翻转一场景双证。
7. **bubbleRect 缺失兜底**：列表重挂载等竞态下气泡矩形偶发拿不到，以触点合成矩形走**同一**
   钳制函数，不落入无钳制分支。锚：`MessageContextMenu.tsx:286-292` 一带（触点合成 + 同一 clamp）。

### 反例（base 版三缺陷，整改前基线版 L224-247，转述自上游 code 交付 §2.1）

- **右钳无下限**：`x = innerWidth - menuWidth - padding` 之后无 `max(padding)` 下限，
  估算宽 ≥ 视口−2×padding 即把 x 推负；
- **翻下无底检**：`y = bubbleRect.bottom + 8` 直接返回，贴底/高气泡翻下即溢出可视区；
- **零 safe-area**：base 版全文无 safe-area/inset 字样，`padding=10` 是唯一边界。

## §2 量具纪律：验收量必须「零外推」

| 量具 | 地位 | 依据 |
|---|---|---|
| **CDP `Runtime.evaluate` → `getBoundingClientRect()`**（经 `adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>`） | **验收量（渲染器真值，零外推）** | 本任务以此定分晓：设备直读菜单 DOM 盒 291.5238×62.0238 css，与单测代入 291.52×62.02 完全一致（此前一轮 58.3css 像素外推与 62.02 的「冲突」即被此量具证伪为方法性欠估） |
| `adb exec-out screencap -p` 截图 + 像素采样 | **旁证 only** | PIL「墨迹+部分 padding」外推曾欠估 58.3css（vs 真值 62.02），据此做「外推⊇真实」验收论证被整轮打回；像素采样只做「DOM 框投影内外」符合性旁证 |
| `offsetWidth/offsetHeight` | 实测但**取整** | 整数 css px，与 DOMRect 亚像素差 ≤1px；方向保守（宁过钳勿漏钳）可接受，验收数值以 DOMRect 为准 |
| jsdom 单测 | **测不出几何** | jsdom 无布局引擎，`getBoundingClientRect`/`scrollHeight` 恒 0（`rules/frontend-test.md:703-713`）——单测只测钳制**纯函数**（把 DOMRect/viewport/insets 当入参），几何验收必须真机 CDP |

像素旁证判据坑：菜单面板近白、聊天页背景有近白渐变时，「白度=min(R,G,B)≥235」会被页面渐变
击穿——**改用 B−R 色差分离**（面板白与页面底色色差方向不同）做框内/框外判定。采样坐标按
「DOM 框(css)×dpr 投影到物理像素系」计算，偏差 ≤2px 属取整噪声。

## §3 边缘场景实测清单（真机/模拟器；每场景五步闭环）

五步（每场景同一套，缺一即场景不闭环）：
① 触发：`adb shell input swipe X Y X Y 900`（同点 900ms=长按；触点=气泡中心 css×dpr）
② CDP 读菜单 DOMRect + offset + style + 项数 + 四向 `env(safe-area-inset-*)` 运行值
③ `adb exec-out screencap -p` 截屏原件（带状态栏时钟，可与命令打点对时）
④ 像素旁证（§2 判据；DOM 框投影内近面板色/外非面板色）
⑤ 点空白关菜单 → CDP 复核已关（防「菜单根本没弹出/早就关了」假阳性）

场景清单：

- **A 贴左缘**：判 x = 钳到 `max(padding, inset.left)`；**本场景同时是「翻转+safe-area」场景**
  ——顶部 inset 放不下上方即翻下（本任务实测：insets top=49px，yAbove=40.71 < 49 → 翻下）。
- **B 贴右缘**：判 `menu.right ≤ innerWidth − max(padding, inset.right)`（本任务实测 401.52 ≤ 402）。
- **C 贴底缘**：判上弹后 `menu.bottom ≤ innerHeight − max(padding, inset.bottom)`，且不压输入栏
  （DOMRect 对输入栏顶 + 目检双证）。
- **D 窄屏宽溢出退化**（菜单宽 > 视口−2×padding）：单测参数化（320dp×6 项 → 旧算法 x=−18），
  验区间防倒挂（§1-4）。
- **E safe-area 参数化**：模拟器无横向刘海/手势条 → 右/左/底向 inset 物理为 0，**单测参数化补**
  （左缘 inset 30 / 右缘 inset 20 / 底缘 inset 48 三用例；单测与生产走同一 `probeSafeAreaInsets`
  读值路径、可注入 mock insets——这是设备形态限制的合规覆盖方式，如实声明而非掩盖）。
- **F 关闭复核**：即五步之⑤（每场景都做）。
- **G 桌面/无关分支零回归**：对同文件桌面分支做锚文本 awk 提取 + diff（应空）+ **双正对照**
  （同一提取器对 mobile 段/整函数提取，应非空——证明「diff 空」是判据有判别力而非测不出）；
  同族组件跑 `git status --porcelain -- <文件>` 应 CLEAN。
- **H 过程兜底**：三场景的 insets 运行值**逐场景内嵌**（不能只引一次全局探针）；
  `logcat -d -b crash` + 主缓冲窗口分析兜「实测过程本身没弄坏 App」。

## §4 存量同族清单（2026-09-10 grep 实测，迁移/整改候选面）

**已迁移**：`src/chat/shared/MessageContextMenu.tsx`（消息长按/右键菜单，本任务对象）。

**同构候选（未迁移、未实测；动它之前先按 §2 选量具实测）**：
- `src/chat/ai/AIMessageBubble.tsx:108-119`——自有 `getMenuStyle()` 带 `mobile && bubbleRect`
  分支，**与 base 版三缺陷同构**（静态估宽 68/估高 44、右钳无下限、翻下无底检、零 safe-area），
  且同样渲染 `.message-context-menu` + `mobile-horizontal`。🔴 文件名不含 "Menu"，按文件名
  枚举同族时**必漏**——语义扫（`position: 'fixed'`、`mobile &&`、菜单类名）才能抓到。
- `src/pages/mobile/MeetingFloatingWindow.tsx`（长按浮窗操作菜单）、
  `src/chat/ai/voice/VoiceCallFloating.tsx`（长按挂断菜单）——有长按菜单路径，定位逻辑待按本 skill 评估。

**触发宿主（只触发不定位，无钳制职责）**：`chat/friend/MessageBubble.tsx`、
`chat/group/GroupMessageBubble.tsx`、`pages/mobile/MobileChatList.tsx`、`components/files/FilesModal.tsx`、
`pages/mobile/MobileFilesPage.tsx`、`components/search/ConversationSearchHit.tsx`。

**无钳制需求**：`ChatMenu.tsx`/`ChatMenuPanel.tsx`/`chat/shared/menu/MainMenu.tsx`/`menu/MenuHeader.tsx`
（Portal 到 body 的侧边滑出面板，全高固定宽，非气泡锚定浮动层）；`chat/group/useChatMenu.ts`（状态 hook）。

**非本域**：全屏遮罩/模态（`position:fixed; inset:0` 类）与 `SlashCommandPanel`（底部贴边面板）、
`FileAttachButton`/`ShelfCardOverlay`（锚定附件/卡片 overlay）等。

清点纪律：枚举同族**禁只按文件名**（`*Menu*`）——先文件名粗枚举，再语义扫
（`长按|onLongPress`、`position: ?fixed`、浮层类名）补漏，两集合取并集后逐个归类。
本块实测：文件名 find 枚举 15 行（14 文件 + 1 目录），语义扫补出文件名外的 AIMessageBubble 同族分支。

## §5 与其他 skill / 规则的关系（防重复建设）

- **ui-real**：管「装机 UI 实测通道」（uiautomator dump→bounds→tap、截图双证、GAP 三件套）；
  本 skill 管浮层几何钳制与 CDP DOMRect 量具。WebView 内 DOM 几何以 CDP 为准；uiautomator
  bounds 对 WebView 是原生层近似（隐藏节点 bounds=[0,0]，见 ui-real §8）。
- **rules/frontend-test.md「jsdom 没有布局引擎」（:703-713）**：为什么几何验收必须真机、单测只测纯函数。
- **rules/common.md「CSS 绝对定位浮层不能锚定到 overflow:auto 的父级」（:368 起）与
  「三方 UI 库的浮层默认 z-index」（:761 起）**：浮层域另外两坑（锚定与层叠），与本 skill（边界钳制）互不覆盖。

## §6 本任务实测基准（回归对照锚值；引上游 code 交付 §5.3/§6，update 层未复算）

视口 412×915 css / dpr 2.625 / insets {top:49px, right/bottom/left:0px} / 菜单 6 项 291.5238×62.0238：

| 场景 | 菜单 DOMRect（css） | 判定 |
|---|---|---|
| A 左缘 | x=10, y=162.655, right=301.52（因 top inset 翻至气泡下方） | 完整在可视区含安全区 |
| B 右缘 | x=110, right=401.52 ≤ 402 | 完整在可视区 |
| C 底缘 | y=703.84, bottom=765.86 ≤ 905（高于输入栏顶 ≈75css） | 完整在可视区 |

证据：`test-artifacts/menu-edge-clamp-r5-20260910T0846Z/scenarios-run.jsonl`（3 行，SHA256SUMS 可复算）。
