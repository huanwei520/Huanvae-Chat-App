---
name: animation-perf-zero-visual
description: 动画性能「实现层浪费」排查与零视觉变更实测——高开销 CSS 甲/乙分类法、消息列表逐实例 vs 共享调度取舍、CDP 动画检测机器测量纪律、帧率/长任务采样与像素对比零视觉协议。Use when auditing animation performance waste, planning pixel-identical perf refactors, or proving zero-visual-change with before/after builds.
license: MIT
---

# 动画性能实现层排查与零视觉变更实测

来源：块 `1790415840689-0qrspjig-1-查改动画实现层浪费零视觉变更`（2026-09-26/27，基线 c6666aed）。该块结论：**5 排查面中唯一可像素级等价优化的浪费在 React 渲染层（5 文件 memo/useCallback/useMemo）；288 处 backdrop-filter 甲类候选 0；检测机器无频率放大**。本 skill 固化其方法与协议。

**正典关系（先读再动手）**：改动画先读 [.claude/rules/animation.md](../../rules/animation.md)（单一所有权 + :203 门禁登记三步）；治理资产/高发点地图见 [.claude/skills/readonly-audit-evidence](../readonly-audit-evidence/SKILL.md) §7；仓内 Playwright pixelmatch 阈值失明层见 [.claude/rules/frontend-test.md](../../rules/frontend-test.md)（与本文 §6 互补：那边讲仓内视觉回归门禁为何看不见低对比变化，这边讲跨构建零视觉证明怎么做）；GSAP 侧性能见 gsap-performance。

## 1. 排查五面在本仓的载体（速查）

| 面 | 载体 | 本块结论 |
|---|---|---|
| ①检测器/rAF | 全仓 rAF 仅 11 行（grep 逐行定性）；唯一循环型 scrollMessageIntoView.ts:207/209 带 900ms deadline+用户接管 stop+单实例取消 | 无轮询/重复绑定/重复实例化 |
| ②检测频率 | e2e/animation-health.spec.ts：setInterval 0 命中、client.on 3 处单注册、每用例固定 settle3000+quiet2000+排空1200 | 无产品侧放大；测试不进产品构建 |
| ③逐条动画 | src/constants/listAnimations.ts 逐卡挂 framer-motion | 见 §3，不改共享调度 |
| ④高开销 CSS | backdrop-filter 288 处/53 文件 | 见 §2 甲/乙分类 |
| ⑤React 重渲染 | 动画组件树缺 memo | 唯一可等价优化面，见 §3 |

**先验证排查对象存在性**：任务卡点名的 hook/monitor 未必存在——`grep -rn "<符号>" src/ tests/ e2e/`（前端 879 个 ts/tsx 文件）+ 后端仓同 grep（678 个 .rs/.ts/.tsx/.js），双端 EXIT=1 才可下「不存在」结论，并附 CMD+OUT 原文与逐目录文件计数。

## 2. 高开销 CSS：甲/乙分类法（先分类，再动手）

| 类 | 判据 | 处置 |
|---|---|---|
| **甲**（实现浪费，可像素级等价替换） | 高开销属性在 @keyframes 体内（逐帧重算 blur/shadow）；多层伪元素背景堆叠；常驻 will-change 挂静态元素 | 换 transform/opacity 合成动画/合并图层/收敛 will-change |
| **乙**（视觉本体，动=违红线） | 静态 backdrop-filter 毛玻璃=设计语言本身；pulse/breathe 类 box-shadow keyframes | 任何替换都改渲染像素，禁改 |

本仓实测：keyframes 内 backdrop-filter=0（甲候选 0）、box-shadow 恰 4 处全乙（reply-quote.css:237 / meeting-floating.css:65 / meeting/styles.css:568 / HuanvaeGuardPage.css:187）、151 个 backdrop-filter 规则块伪元素载体 0/多层背景 0（无可合并对象）、will-change 仅 3 处全挂动画元素（已最优）。**毛玻璃设计语言的仓库里，grep 命中大概率是乙类——先扫描后动手，别见 blur 就优化。**

扫描方法（机器生成，禁手抄表）：`grep -rno "backdrop-filter" src/ | wc -l` + 分文件表转录；keyframes 体内属性用配对大括号的 python 脚本逐块扫（参考 evidence/anim-before-after/css-keyframes-scan.py）。

## 3. 消息列表动画：逐实例 vs 共享调度

**结论：保留逐卡 framer-motion 实例，收益从 React 渲染层拿。** 三条依据：①共享 timeline 重排入场时序=可见差异，撞零视觉红线（时序即外观）；②冲突规避语义依赖逐卡 layoutProps（`.conversation-item` 在 tests/animation-conflict.test.ts:82 在册的 layout="position"+layoutDependency 结构）；③历史消息本来不产生入场实例（MessageBubble `initial={playEnter?'initial':false}` + shouldPlayEnter 挂载快照），逐实例成本被夸大。

**真正等价的优化=memo 化**：卡片抽 `React.memo` 组件+回调 `useCallback`+派生对象提 `useMemo`——跳过的只是「输出必然相同」的重渲染，DOM 逐字节一致。
**不变量（memo 化 framer-motion 卡片必守）**：`layoutEnabled`/`layoutDependency` 必须是 memo 组件的 props——顺序变化时 layoutKey 必变 → props 必变 → memo 必不命中 → framer 测量照常发生；tab 守卫窗口同理。破了这条，排序滑动动画会静默丢失。

## 4. CDP 动画检测机器：测量纪律与调优结论

- **CDP `Animation.animationStarted` 投递延迟 2~529ms（p50≈100ms）**——「事件到达 Node」≠「动画开始」。三件套：handler 在 `Animation.enable` 后立刻注册全程收集；判窗一律用动画自身 `startTime`（与 performance.now() 同源）；窗口关闭后排空 1200ms（实测最大延迟 ~2x）再断言。违反=双向假阳/假阴（2026-08-12 Auth Form Toggle 6/10 抖动根因）。
- **断言语义防顺手放松**：`duration===0` 的 truthy 与 `!== undefined` 判定结论相反，后者会悄悄放宽门（曾有 lint 修复夹带，已回退立碑）——lint 修复禁改断言语义。
- **调优结论**：本仓检测机器无频率放大（无 setInterval、单次注册、固定节奏）；产品 rAF 11 行全有界。检测机器的调优空间在测量纪律，不在频率。

## 5. 帧率/长任务采样协议（evidence/perf/perf-sample.mjs 为模板）

1. 被测物=vite build+preview 产物（非 dev server）。
2. 注入=e2e 同款 tauri-mock 模板本体提取重 eval + 种子数据包装器。**坑**：兄弟块新增 tauri 命令 mock 不认识会主线程死循环——包装器里 stub 假返回值。
3. 场景动作全在页面内 evaluate 驱动；每场景静置 3s 排空再采样 8s；场景与任务卡口径做映射表。
4. **交替采样**（base-r1→opt-r1→…）对冲共享构建机负载漂移；高负载下 fps 被 vsync 封顶持平失真——**主线程工作量指标（CDP Performance.getMetrics 的 Task/Script/Layout/Recalc 增量）才是可分辨项**。
5. 基线树=工作树拷贝+`git show <base>:<file>` 覆写被改文件+逐字节校验；双侧打 APK 以 md5 绑定「构建件=采集件」。
6. 汇报口径：收益用区间完全分离（优化侧全好于基线侧极值）；单轮离群降级；对照场景持平如实写。

## 6. 像素对比零视觉协议（evidence/visual/ 为原件库）

1. 采集：真机 `adb exec-out screencap -p` 1080×2400 / 桌面 chromium DPR=2；每轮 reinstall→launch→交互→截屏，rc 流水账落盘。
2. **无限动画先冻结再截屏**（`getAnimations` currentTime=0+pause），否则任意两时刻必不同、不可比。
3. 判读：pngjs 逐像素**绝对零容差 d≥1**，应用区判定；掩码只豁免测试态外部产物（状态栏时钟/角标），绝不豁免应用渲染。
4. **底噪对照**：同构建双采建立采集非确定性底噪；升级=交替多轮协议（B1→A1→B2→A2→B3→A3 ×每场景连拍），跨构建/同构建同轮/同构建跨轮三口径全零才闭合「单对运气」质疑。轮间漂移归因关键=同构建跨轮差异与跨构建同量级 ⇒ 漂移与构建无关，再逐项消除（caret 闪烁→截屏前 blur；probe 污染→去掉；横幅时机→DOM 关+断言）。
5. 工具链边界（如实披露，别硬凑）：rAF 相位噪声底 6~18px，固定小容差对动效轨迹 fail-open；framer layout 无 WAAPI 可定格、CDP 虚拟时间不驱动 rAF 合成帧 → 逐帧绝对比对不可达。**可行替代=落定态+起点态+离散端点集合的绝对零差异**，轨迹分析降级为超纲披露不作 PASS 依据。
6. 证据纪律：承重结论带可复跑 CMD；计数机器生成+独立复核命令双口径自洽；改动文件给三方 blob（worktree/HEAD/base）；禁改文件双口径核查（commit 面+工作树面+归因链）；门禁日志头带 UTC 时间戳尾带 EXIT=。
