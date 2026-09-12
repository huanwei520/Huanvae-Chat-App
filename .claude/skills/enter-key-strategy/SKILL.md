---
name: enter-key-strategy
description: 聊天输入「回车=换行/发送」跨端统一策略与设置开关持久化模式。触发场景：改动聊天输入框回车行为、新增随开关切换输入行为的设置项、移动软键盘 IME 动作键适配、IME 组字（isComposing）误发送排查、给 zustand persist 的 settingsStore 加新字段、双端（桌面 + Android WebView/模拟器）输入行为实测与取证。
---

# 聊天输入回车策略与设置开关持久化

> 锚点行号为 2026-09-10 工作树快照（上游 code 层 r5 定稿 + 本层 grep 现查互证）。行号会随在飞任务漂移，引用前一律 grep 现查。

## 触发场景（命中任一，先读本 skill）

1. 聊天输入框（`src/chat/shared/ChatInputArea.tsx`）回车行为相关改动；
2. 「回车发送消息」开关及同类「行为档位」设置项的新增/调整；
3. 移动端软键盘回车键被当成发送/换行的表现与预期不符；
4. 中文/日文 IME 组字期间回车被误判为发送；
5. settingsStore 新增需要持久化的设置字段；
6. 对该输入行为做双端实测取证。

## §1 核心事实：跨端收敛于单一 keydown（方案成立的根基）

**Android WebView 会把软键盘 IME 动作键与换行键都派发成 `key='Enter'` 的 keydown。**
因此桌面物理键盘、移动软键盘发送键（➤）、移动软键盘换行键（↵）、硬件式 Enter（`adb input keyevent 66`）
四条输入路径最终收敛于同一个 `handleKeyDown`（ChatInputArea.tsx:394 分支），由同一位开关管住——
**不需要也不应该为移动端单写一套键盘分支**。

实测依据（上游 code 层 r5，CDP keylog 仪器化，本层未复算）：软键盘 ➤ 与 keyevent 66 的事件流均为
`keydown key=Enter keyCode=13`，与桌面物理键盘同形；`enterKeyHint` 只改键盘 UI 不改事件语义。

## §2 方案七条（实码锚点）

1. **单一开关读点**：组件内一处读 store——`useSettingsStore((s) => s.chatInput.enterSendsMessage)`（ChatInputArea.tsx:136）。
2. **开关分支只改「是否发送」，不改「是否换行」**：
   - 关（默认）：`if (!enterSendsMessage) { return; }`（:396）——**不 preventDefault**，让 textarea 原生插入换行符；
   - 开：`e.preventDefault(); handleSend();`。
   - 好处：换行永远交给浏览器原生路径，无需手写 `\n` 插入与光标维护。
3. **Shift+Enter 用外层条件排除**：`if (e.key === 'Enter' && !e.shiftKey)`（:394）——两档下 Shift+Enter 都走原生换行，不在开关分支内出现。
4. **移动端键盘 UI 跟随开关**：`enterKeyHint={enterSendsMessage ? 'send' : 'enter'}`（:626）——只切换 Gboard 显示 ➤/↵，行为统一仍由 §1 的 keydown 分支保证。
5. **placeholder 随开关提示当前行为**（:613）——行为档位改变时用户界面必须同步告知，防止「行为变了用户不知道」。
6. **优先级序**：IME 组字判据（§3）＞ 斜杠命令面板（:390，面板打开时 Enter=选中命令，开关不影响）＞ 回车档位分支。新加回车语义时必须插对位置。
7. **deps 数组同步**：`handleKeyDown` 的 useCallback deps 必须含 `enterSendsMessage`（:405），否则开关切换后旧闭包仍在发消息。

## §3 IME 组字防线（三重判据，任何档位都不可省）

```ts
// ChatInputArea.tsx:384
const composing = e.nativeEvent.isComposing || e.keyCode === 229 || isComposingRef.current;
```

- `nativeEvent.isComposing`：组字期 keydown 的根因信号（Blink/Gecko/现代 WebKit 均置 true，含确认候选词那一下）；
- `keyCode === 229`：旧内核组字期上报的 "process" 键码；
- `isComposingRef`（:131，compositionstart→end 手动标志，:408-409 维护）：兜个别内核确认 keydown 上 isComposing 未置位的时序差。
- 组字中的 Enter 一律 `return`（确认候选词语义），两档开关下都绝不发送。

**实测实证（上游 r5 意外捕获，CDP keylog 原文）**：`adb input text` 注入文本会让 Gboard 残留组字态——
注入后第一次 Enter `isComposing:true` → `beforeinput insertLineBreak` 不发送；compositionend 后第二次
Enter `isComposing:false` → 才走发送。软键盘 ➤ 与 keyevent 66 两次独立场景均复现。
**给实测者的启示：adb 注入文本后第一次回车预期是「组字确认」而非发送，验证发送行为要用第二次回车。**

## §4 设置开关持久化模式（settingsStore 接入配方）

settingsStore 为 zustand + `persist`（`name: 'huanvae-settings'`，:135；**无 partialize，整 state 持久化**）。
新增一个持久化开关只需四步（以 `chatInput.enterSendsMessage` 为例）：

1. 定义分组接口：`export interface ChatInputSettings { enterSendsMessage: boolean; }`（:37-41）；
2. 主 state 加分组字段（:50）+ setter 声明（:61）；
3. **默认值写在 state 初值里**（:81 `enterSendsMessage: false`）——默认值即产品口径，改口径只动这一行（单点改口径设计）；
4. 实现 setter（:115-119，浅拷贝分组字段）。

此后 localStorage 自动出现 `huanvae-settings.state.chatInput.enterSendsMessage`，无需手写读写代码。
同仓既有分组可复制：`NotificationSettings`（:21）、`FileCacheSettings`（:31）。

**持久化验收三层（缺一不可）**：
- 单测：断言 setter 后 `localStorage` 有值、默认值为关（`tests/unit/settings.test.ts`「开关状态应持久化到 localStorage（zustand persist）」组）；
- 桌面：UI 开关 → `page.reload()` 重新登录 → 开关仍开 + localStorage 双读（上游 review 层 Playwright 实测配方）；
- 移动：UI 开关 → `am force-stop` 冷启 → CDP 读 localStorage + 设置页截图（上游 code 层 adb 实测配方）。

## §5 双端实测清单（每场景：操作→预期→量具）

**移动端（adb 模拟器）**：
| 场景 | 操作 | 预期 |
|---|---|---|
| 默认档换行 | 输入文本 → Gboard ↵ | 草稿两行、列表无新消息；CDP `hint:"enter"` |
| 默认档键盘形态 | 聚焦输入框 | Gboard 显示 ↵ 换行键 |
| 开档发送（软键盘） | 开开关 → 输入 → ➤ **两次** | 第二次发出、输入框清空；keylog 第二次 `isComposing:false` |
| 开档发送（硬件式） | `input keyevent 66` | 发出 |
| 开档 Shift+Enter | `input keycombination 59 66` | 两行草稿不发送 |
| 持久化 | `am force-stop` → 冷启 | 开关仍开；CDP localStorage true |
| 恢复默认 | 关开关 | localStorage false（实测后必须恢复默认，不留状态污染） |

量具：`adb exec-out screencap -p` 截屏原件 + CDP 经 `adb forward` 直读 WebView 的 localStorage/textarea 状态
+ CDP keylog 逐事件记录 `isComposing`（仪器化优于肉眼）。截屏分辨率须与设备形态一致（1080×2400）。

**桌面端（Playwright + Tauri e2e 桥 + 真实后端代理）**：
5 阶段 = 默认关 Enter 换行 0 发送 → 开开关 → Enter 发送 + Shift+Enter 换行 → **reload 持久化** → 恢复默认；
每阶段落 steps_log（placeholder/subtitle/checked/localStorage 四读数）+ 1440×900 截屏。
**UI 改动触两端时，桌面截图是硬指标**——只有移动端截图会被判「桌面零回归无实证」。

**桌面端量具换代（2026-09-11，9/6 owner 令后）**：Playwright 浏览器截图已被明令禁止作为 UI 实测证据。
现行合规链路 = **Xvfb（1440×900×24）+ 真 Chromium headful + xdotool 真实 X 级点击/按键 + ImageMagick
`import -window root` 帧缓冲截屏**（截屏来自 X 帧缓冲而非浏览器截图 API；CDP 仅用于导航/读态/注入 Tauri e2e 桥）。
完整驱动脚本与 9 张截屏原件：`/work/enter-key-desktop-evidence-1789098915743/`
（块 1789098915743-1，SHA256SUMS 16 项，五阶段全绿 ALL_PHASES_PASS）。
Windows VM（winserver-hg，VNC 127.0.0.1:5901）在该时点不可达：libvirtd 起域时
`Failed to bind /dev/null on to /run/libvirt/qemu/*.null: Permission denied`（CapEff 全集仍 EACCES，容器/LSM 限制），
证据：`vm-blocked-proof.txt`。vite dev(14500, watch 关) + 真实后端(18993) 复用上游环境。
注意：token 存 Tauri 桥内存不落 localStorage，**reload 后需重新登录**再验开关持久化。

## §6 已知坑（实测与证据方法论）

1. **e2e 桥 invoke 兜底返回 null 是测试工件**：tauri-e2e-bridge 对未列命令返回 null → `list_notification_sounds`
   得 null → SoundSelector 读 `sounds.length` 崩溃整树卸载。非应用缺陷（真机后端返回真实数组）。
   规避：spec 内 `addInitScript` 给 invoke 包兜底返回**类型正确**的值；只动测试 harness、零仓库源码改动。
   **给后续桌面 e2e 的普适教训：桥的未知命令兜底返回值必须类型正确，不能是 null。**
2. **Playwright `check()` 遇父级动画「element is not stable」**：改 force click + 状态三重取证
   （isChecked + 副标题文案 + localStorage），证据强度不减。
3. **管道污染退出码**：`vitest … | grep EXIT` 之类管道会把本体退出码换成 grep 的；退出码声称必须无管道重跑一次。
4. **共享工作区计数随时点漂移**：全量测试用例数（如 4234→4240）、`git diff --stat` 文件数（79 文件中 73 个属他任务）
   都是在飞任务推进的结果——引用必附时点与「引上游某轮实测」标注；基线复现用 detached worktree 对 HEAD 原样复跑。
5. **测试计数断言升级要拆两半**：改分组数断言（如 5→7）时，先对 HEAD 复跑确认 HEAD 事实 DOM（本案 HEAD 套件本就红：
   他任务加段没改断言，`expected 6 to be 5`），断言新值 = 修正到 HEAD 事实 + 本任务增量，交付里写明拆分，避免「+1 组为何断言 +2」的自述矛盾。
6. **「已验证」的证据形态**：每条声称附完整终端输出原文（非单行摘要）+ verify 复算命令；UI 实测属时间相关实证，
   以原件 + SHA256SUMS + 截图内时钟互证构成证据链，不做「重跑即得」声称。
7. **verify 清单的预期值必须当次实测，禁止由章节枚举推导**：本域沉淀交付曾把 `grep -c '^## '` 的预期值按
   「§1–§8」推导为 8，漏算「触发场景」这个 `## ` 级标题，与同交付另一处的实测「10 锚（含 name:）」两说互斥，
   被判「至少一处系推断未实测」打回。教训：同一计数在交付内只允许一个口径，且必须来自当次实测输出；
   推导值再「合理」也不许以预期值名义出现。
8. **无 WM 的 Xvfb 上 xdotool 页坐标≠屏坐标**：Chromium 自居中出黑边（窗口 1024×758 居中于 1440×900），
   `getBoundingClientRect` 页坐标直接喂 xdotool 会点偏 ~70px。必须先把主窗口钉到 0,0 并 windowsize 到满屏
   （`xdotool search --name "Google Chrome for Testing"`——`--class chrome` 会选中同名工具窗口），
   钉完用 `window.innerWidth/innerHeight` 实测回报再点击。
9. **xdotool 组合键是一个参数**：`xdotool key shift Return` 是先放 Shift 再按 Return（=裸 Enter，开档下直接发送）；
   Shift+Enter 必须写 `xdotool key 'shift+Return'`。同类自污染：消息列表断言的检索 tag 必须 run 级唯一
   （带时间戳），否则上一次失败 run 已发送的同文消息会把「0 命中」撑成假阳性。

## §7 与其他 skill / 规则的关系

- `ui-real`：UI 实测通用纪律（截屏三证、时点锚）；本 skill 补输入行为域的场景清单与 IME 现象。
- `android-screenshare-e2e` / `meeting-exit-e2e` / `forward-echo-e2e`：各自域的实测配方；共享工作区/在飞归属纪律同源。
- `test-quality-check`：测试有效性；本 skill §6.5 的计数断言拆分是其域内实例。
- `popup-clamp`：同为输入交互域（浮层钳制）；回车语义与几何钳制互不覆盖。

## §8 存量同族候选（2026-09-10 grep 实测，迁移候选面）

`src` 内 `key === 'Enter'` 共 16 处（grep 现查）：多数为「按钮/行激活」语义（Sidebar/MobileDrawer/SettingsRow 等），
与本域「文本输入回车档位」不同族。真正的同族候选（Enter=提交单动作、如需档位化可参照 §2/§4）：
- `chat/shared/AlbumComposer.tsx:88`（Ctrl/Cmd+Enter 发送）
- `chat/group/GroupRemarkInputModal.tsx:83`（Enter 保存备注）
- `chat/shared/OtherProfilePanel.tsx:356`（Enter 保存备注）
- `pages/mobile/MobileChatView.tsx`（其输入区若复用 ChatInputArea 则自动继承本策略，无需迁移）。
