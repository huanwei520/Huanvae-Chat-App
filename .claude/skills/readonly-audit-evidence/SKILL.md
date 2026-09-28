---
name: readonly-audit-evidence
description: 只读查验（research）类交付的取证形态 — 负面结论穷举四件套、统计口径与数字绑定、锚点全路径防同名文件、运行时定量三态分级、既有机制盘点先查 rules/、集合声称全枚举分组闭合、动画性能查验资产地图。适用于性能/卡顿/覆盖面类「只读查验+出方案」任务与任何报告体穷举/统计声称。
allowed-tools: Read, Grep, Glob, Bash
---

# 只读查验（research）类交付的取证形态

来源：块 `1790367135156-2mnf7rct-1-查动画渲染性能卡顿根因出方案`（2026-09-26/27 实战：code 层首轮 REJECT 后二补过审、review 层约 45 处锚点全复验 PASS、update 层沉淀）。近亲正典（先读再引用，勿重复）：CLAUDE.md「同一集合多计数口径必须算术对账到零差」（:599③）、common.md「裸行号会漂移，引用一律配 grep 符号锚」（:567）、common.md「穷举 workflow 不能只 find .github」（:1968）与「grep -r 与 git grep 不等价」（:2059）、skill-evolve「沉淀层交付纪律」6/7/8。本 skill 收的是报告体查验的特殊形态，与上述正典互补不重复。

## §1 负面结论（「全仓零 X」）取证四件套

「零虚拟滚动」「未接某推送通道」类负面结论，单一 grep 不能定案，四件套缺一不可：

1. **模式面**：≥4 个变体模式（如 `react-window|react-virtual|virtualized|windowing|overscan|virtual`），并给分类计数（本块 38 命中拆成 33 VPN virtual_ip + 1 VirtualDisplay + 3 SQLite FTS5 + 1 注释 = 38 连加闭合，滚动相关 0）；
2. **目录面**：源码全树 + 全部构建/测试配置 + tests/ + e2e/，并**显式声明排除面**（worktrees/dist/node_modules 不属源码面）；
3. **依赖清单**：package.json 与 lockfile 各 grep 一次并给退出码（`echo pkg_exit=$?` → `pkg_exit=1` 才是零命中证据，光给 `0` 不够）；
4. **键名人工复核**：dependencies/devDependencies 全量键名打印逐个过目，防「grep 词表没覆盖的库名」。

构建产物目录（如 src-tauri/gen）只 grep 源码后缀文件并加 `--binary-files=without-match`，且不冒充源码面。

## §2 统计口径与数字绑定（数字必须当场由命令产生）

同一模式在不同 include 范围/前缀口径下数字不同，三个实案：`filter: blur` 81（凭印象）vs 82（实跑）；`box-shadow` 237（CSS-only）vs 240（含 tsx/ts）；`--glass-backdrop` 消费「12 处」（两口径都不符）vs 实为 9 个声明对（18 行含 -webkit- 前缀行）。铁律：

- 报告里每个统计数字旁**绑定口径**（include 范围、是否含前缀行、是否排除定义处）；
- 计数命令逐字落盘可复跑，交叉复核用第二种算法（如 `grep -rh … | wc -l` 与 `grep -rc … | awk 求和` 双轨同值）；
- 「间接引用」计数注明是否排除定义处（本块 `useStockIntro` stocks/ 命中 10 文件 = 9 使用方 + 1 定义处，并集去重 12 须写明口径）。

## §3 file:line 锚点写全路径 + 同名文件显式声明

本项目仓库同时存在 `src/styles/pages/main.css` 与 `src/styles/mobile/main.css`，而 `src/styles/main.css` **不存在**——首轮报告写短路径被判「路径笔误+歧义风险」。锚点纪律：全路径起笔；报告涉及同名文件时显式声明「本报告所指为哪个」；写完后用 `sed -n 'Np'` 抽验行号内容与结论一致。与 common.md :567 符号锚互补：符号锚防行漂移，全路径防文件歧义，两者都要。

## §4 运行时定量三态分级（只读红线下的诚实声明）

| 分级 | 含义 | 证据形态 |
|---|---|---|
| 【已坐实·代码层】 | 代码里确实如此 | file:line + grep 复核命令 |
| 【待验证·运行时】 | 掉帧占比/重排幅度/字节量等需真机 profile | 只读红线下禁跑，**列为实施前置项**而非含糊带过 |
| 【已排除】 | 假设不成立 | 否定式 grep **空输出 + exit 码**（如登录三页零位图：`grep -n "<img" Login.tsx Register.tsx AccountSelector.tsx` → 空） |

禁止为报告好看把【待验证】写成已验证；「待验证」必须给出验证路径（真机 + 可运行构建 + Profetto/Chrome tracing）。

## §5 盘点「既有同类机制」前先查 rules/（形式族陷阱）

盘点 reduced-motion 既有分支时，`grep "useReducedMotion"` 字面量只命中 1 文件（ChatMenuPanel.tsx），而 `.claude/rules/animation.md:172` 规则五早已规定兜底标准形式是 **`gsap.matchMedia()`**——GSAP 组件的 reduce 分支全走该形式，字面量 grep 全漏 → 首轮「仅 3 组件」被 review 补全为「3 组件 + 其他 hook/注释 + 4 处 CSS `@media (prefers-reduced-motion)` 块」。铁律：任何「全仓有哪些 X 机制」盘点，动笔前先 grep `.claude/rules/` 相应规范，把规范已定义的**全部实现形式**纳入检索模式再数数。

## §6 集合声称全枚举 + 分组闭合校验

报告体「全仓共 N 处」类集合声称不可抽样：逐行落盘全枚举 + 分组求和闭合（本块 CSS infinite 47 处 = 8+7+9+3+3+3+2+3+2+7，分组命令与各组成员原文全部入证据）。与 skill-evolve 纪律 6（连加闭合）同族，但这里是**集合成员**的枚举校验，不只计数。

## §7 本项目动画/渲染性能查验资产地图（2026-09-26 快照，改造前先对图）

- **正式报告**：pipeline 块 `.../2mnf7rct-1-查动画渲染性能卡顿根因出方案/code/deliverable/01-性能卡顿查验.md`（H1~H13 高发点带 file:line、P1~P6 方案带三要素）+ `code/evidence/01-性能/` 5 件 CMD+OUT；总报告以汇总块 cross-evidence 收录件为准。
- **动画治理资产（改动画前必读）**：`.claude/rules/animation.md`（五规则 + :203 门禁登记三步）、`tests/animation-conflict.test.ts`（752 行静态门禁）、`e2e/animation-health.spec.ts`、`package.json` script `test:animation`。
- **结构事实**：两个 main.css（`src/styles/pages/` 与 `src/styles/mobile/`）；全局毛玻璃令牌 `src/styles/variables.css:354` `--glass-backdrop: blur(20px) saturate(180%)`。
- **高发点速查**（详见报告）：登录 8~11 层常驻 infinite（`src/App.tsx:625-632` 五光球 + `src/styles/base.css` blur(30~45px)）+ 玻璃卡 blur(24px)（`glass-card.css:24`）+ 账号选择器 filter:blur 逐帧插值（`CardSlot.tsx:108-113`）；主界面 blur(80px) 背景球（`Main.tsx:137-138`）；消息列表零虚拟滚动全量渲染（`ChatMessages.tsx:404-406`）+ 分页只增不减（`useLocalFriendMessages.ts:255,435`）+ 气泡非 memo（`MessageBubble.tsx:128`）+ presence 整表订阅（`MobileChatList.tsx:89` / `chatStore.ts:466-468`）。
- **改造前置**：真机 profile 定量后再决定 P5 虚拟化是否触发；GSAP/framer-motion 改动按 animation.md :203 判断口径登记双门禁；背景球停用/降级属视觉决策须 owner 拍板。
