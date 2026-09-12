# 远控页设计 token 对照表（remote-control 域 UI 纪律）

> 来源：block `1788964672726-2-统一远控UI并修信令断开` 沉淀（code/review 判官双 PASS，2026-09-09；任务①「远控页 UI 收敛到设计 token」交付）。
> 适用范围：`src/remote-control/` 全部样式（remote-control.css 及后续新增）；同域新页面/新组件直接套用本表，**禁止另起散装样式**。
> 行号口径：定义行号为 2026-09-09 工作树 `src/styles/variables.css` grep 实测（42/42 恰命中，见 §5）；用量计数为上游双层（code R2 / review R3）实测转述，本层未复跑。
> update 层第 4 次执行重跑同名 grep 仍恰 42 行且行号逐一相符，并修正头注释引用行号 3 处（纪律节 :10-17／豁免 :14-17／深色语义节 :19-24）与状态点绿 css 行号 1 处（:59）；第 5 次执行（2026-09-09）第三次全量复核零漂移（42 定义行恰 42 行逐一相符、var(--) 恰 95 行、css 关键行 :34/:96/:59-61/:264 全中），完整原始输出见本块 update/deliverable.md 与 update/evidence/（落点双镜像同目录在档）。

## 1. 收敛纪律（硬规则）

1. **四范畴禁止散装硬编码**：颜色 / 间距 / 字号 / 圆角一律引用设计 token——`src/styles/variables.css` 静态 token + `src/theme/ThemeProvider.tsx` 运行时注入的语义 token（亮暗双档）。纪律原文写在 remote-control.css 文件头注释（纪律节 :10-17、豁免两条 :14-17）。
2. **深色视频舞台取色语义**（:19-24）：控制窗/舞台是恒深底（被控端画面为主体）——文字用恒白 `--text-on-color`、弱化文字用静态 `--white-alpha-*`、状态点用语义 `--status-*`；**禁用** `--bg-*` / 语义 `--text-*`（亮底文字色）/ `--color-neutral-*` 等随主题翻转的 token——深色主题下会把舞台翻成浅色底（视频面语义不容翻面）。
3. **控件收口**：动作按钮一律用设计系统组件 `<AppButton variant="secondary"/"primary" block>`（先例：ControlAuthPopup.tsx，旧自绘 `.rc-auth-btn` 硬编码渐变已删）；CSS 只管排布（`.rc-auth-card__actions`）。
4. **禁止暗道**：不得把硬编码值藏进本文件局部 CSS 自定义属性再引用（自查命令 §5 第 6 条）；不得写内联 `style={{…}}`（远控 TSX 现状为零）。

## 2. 42 token 对照表（全集，无第 43 个）

全集来源：remote-control.css 引用的 token 去重集合（上游枚举命令 `grep -oE 'var\(--[a-z0-9-]+…' | sort -u` 实测 42 种，转述）；本会话以同名 pattern grep variables.css 恰 42 行定义、零多零少（§5 第 2 条），并通读 remote-control.css 全文确认引用集与下表相等、无表外 token。

### 间距（--space-*，7 种）

| token | 定义行 | 值 | 用量† | 远控页主要用途 |
|---|---|---|---|---|
| --space-1 | :328 | 4px | 4 | 小按钮内距、紧凑 gap |
| --space-2 | :329 | 8px | 16 | 状态栏 gap/状态点尺寸/卡内距（最高频） |
| --space-3 | :330 | 12px | 11 | 面板边距、区块间距、hint 定位 |
| --space-4 | :331 | 16px | 3 | 状态栏水平内距、横幅内距 |
| --space-5 | :332 | 20px | 1 | 授权卡内距 |
| --space-6 | :333 | 24px | 1 | 占位区 padding |
| --space-12 | :336 | 48px | 2 | 授权卡图标位尺寸（css :161-162） |

### 字号（--text-*，11 种）

| token | 定义行 | 值 | 用量† | 远控页主要用途 |
|---|---|---|---|---|
| --text-xs | :362 | 11px | 3 | dev 键钮、hint、tilemenu note |
| --text-sm | :363 | 12px | 4 | 状态栏、dev 面板、授权卡 timer |
| --text-base | :364 | 13px | 4 | 正文/横幅 |
| --text-lg | :366 | 15px | 1 | 占位标题 |
| --text-xl | :367 | 16px | 1 | 授权卡标题 |
| --text-2xl | :368 | 24px | 1 | 授权卡图标字符 |
| --text-primary | :71 | #1e3a5f | 1 | 授权卡标题色（亮底卡内语义色） |
| --text-secondary | :72 | #475569 | 1 | 授权卡副文案 |
| --text-muted | :73 | #64748b | 1 | 授权卡弱化文案 |
| --text-light | :74 | #94a3b8 | 3 | probing 状态点底、占位文字 |
| --text-on-color | :121 | #ffffff | 8 | 深色舞台恒白文字（最高频文字 token） |

### 圆角（--radius-*，5 种）

| token | 定义行 | 值 | 用量† | 远控页主要用途 |
|---|---|---|---|---|
| --radius-sm | :317 | 8px | 5 | 键钮/hint 气泡/tilemenu 菜单项 |
| --radius-md | :318 | 12px | 1 | dev 面板 |
| --radius-lg | :319 | 14px | 1 | 授权卡图标底 |
| --radius-xl | :320 | 16px | 1 | 授权卡（meeting-modal 同款） |
| --radius-full | :323 | 50% | 1 | 状态点（正方形上=圆；**非正方形会变椭圆，胶囊不用它**） |

### 透明度色阶（静态，恒白/恒黑，9 种）

| token | 定义行 | 值 | 用量† | 远控页主要用途 |
|---|---|---|---|---|
| --white-alpha-10 | :231 | rgba(255,255,255,.1) | 2 | 状态栏底、按钮底 |
| --white-alpha-15 | :230 | rgba(255,255,255,.15) | 4 | hairline 描边、按钮/hover 底 |
| --white-alpha-25 | :228 | rgba(255,255,255,.25) | 3 | hover 底、虚线描边 |
| --white-alpha-60 | :222 | rgba(255,255,255,.6) | 1 | hint 文字 |
| --white-alpha-70 | :221 | rgba(255,255,255,.7) | 2 | 品牌字、面板 note |
| --white-alpha-75 | :220 | rgba(255,255,255,.75) | 1 | 授权卡玻璃渐变下端（css :151） |
| --white-alpha-85 | :218 | rgba(255,255,255,.85) | 1 | 授权卡玻璃渐变上端（css :151） |
| --black-alpha-50 | :236 | rgba(0,0,0,.5) | 2 | hint 气泡底、授权 overlay 遮罩 |
| --black-alpha-70 | :234 | rgba(0,0,0,.7) | 2 | dev 面板/tilemenu 深底（深色浮层唯一 sanctioned 深底） |

### 状态与边框阴影（语义，ThemeProvider 按亮暗注入，8 种）

| token | 定义行 | 静态值 | 用量† | 远控页主要用途 |
|---|---|---|---|---|
| --status-success | :85 | #22c55e | 1 | 状态点绿（connected+armed，css :59） |
| --status-warning | :90 | #f59e0b | 1 | 状态点橙（connected 未受戒，css :60） |
| --status-error | :92 | #ef4444 | 2 | 状态点红（down，css :61）+ 横幅底（css :259） |
| --status-info | :94 | #3b82f6 | 1 | dev 面板 info 文字 |
| --border-default | :79 | rgba(147,197,253,.3) | 1 | 授权卡描边（meeting-modal 同款） |
| --shadow-lg | :147 | 0 8px 32px rgba(59,130,246,.15) | 1 | 授权卡阴影 |
| --gradient-primary-subtle | :279 | linear-gradient(135deg, var(--color-primary-5), var(--primary)) | 1 | 授权卡图标底渐变 |
| --blur-sm / --blur-xl / --saturate-high | :342 / :345 / :347 | blur(10px) / blur(24px) / saturate(180%) | 1 / 2 / 2 | dev 面板 / 授权卡 backdrop（:152-153 含 -webkit- 行） |

† 用量 = 上游 code R2 §3.1 / review R3 §3.1 双层实测转述（口径：`grep -o … | sort -u` 后逐 token 计数；总次数 106、含 var 行数 95、去重种类 42——**三口径不可混称**，本层未复跑）。

## 3. 豁免与残集上界（非 token 值的完整清单，引入新例外必须先登记在此）

| 类别 | 点位 | 先例（App 既有惯例） |
|---|---|---|
| 设计 token 范畴内声明豁免（css :14-17 头注释明载） | `#000`×2（css :34 视窗底、:96 视口底，视频舞台恒黑）；`999px`×1（css :264 胶囊圆角） | meeting/styles.css spotlight 同款 #000；bots.css/profile-hero.css 胶囊 999px；--radius-full=50% 在非正方形上变椭圆不适用 |
| 结构/布局常量（设计系统无对应 token，范畴外） | `360px` 授权卡宽、`78px` devpanel 底部避让、`160px` tilemenu 可读下限、`88vw` 卡最大宽、`100%`×2 帧自适应、z-index 9800/9600/9500/9700（授权层/面板/横幅/菜单） | meeting-modal 420px 同性质卡宽；App 高段 z-index 惯例带（voice-call 9998/9999 等） |
| 排版微常量 | `1px` hairline 描边×4、`line-height:1.9`、`letter-spacing:.4px`、`font-weight` 700/600、`opacity:.55` 禁用态、translate 居中 50%/-50% | meeting/styles `1px solid` 惯例面广；font-weight 600 惯例面广；opacity 0.55 = app-button.css 禁用态同档 |

新增例外前自问两问：①设计系统里真没有对应 token？（先 grep variables.css/ThemeProvider）②App 里有没有同性质先例？两问皆否 → 回 token，不许进残集。

## 4. 已知的假 token 化暗道（review 层实测排除项，防回潮）

- remote-control.css **零自定义属性定义**（`grep -nE '^\s*--[a-zA-Z0-9-]+\s*:'` 零命中，review R3 §3.5 实测）——不存在「局部变量藏硬编码」；
- 远控 TSX **零内联样式**（`grep "style={{"` 零命中）；hex 字面量唯一出现处是 ControlAuthPopup.tsx:66 **注释**里对旧硬编码值的文字记录（grep 时注意区分代码与注释）。

## 5. 改样式后自查命令（逐字可复跑；预期值括注）

```bash
f=src/remote-control/remote-control.css
# 1) 三口径（预期 95 / 106 / 42；三数口径不同：行数/次数/种类，行文必须写明用哪个）
grep -c 'var(--' $f
grep -oE 'var\(--[a-z0-9-]+' $f | wc -l
grep -oE 'var\(--[a-z0-9-]+' $f | sed 's/var(//' | sort -u | wc -l
# 2) 悬空引用（预期仅输出 MISSING_CHECK_DONE，零 MISSING）
for t in $(grep -oE 'var\(--[a-z0-9-]+' $f | sed 's/var(//' | sort -u); do grep -q -- "^ *$t:" src/styles/variables.css || grep -rq -- "$t:" src/theme/ThemeProvider.tsx src/styles/ 2>/dev/null || echo "MISSING: $t"; done; echo MISSING_CHECK_DONE
# 3) 四类别反向扫描（G1/G2/G3 预期零命中 rc=1；G4 唯一命中应为已豁免 999px 行 :264）
grep -nE '(padding|margin|gap):' $f | grep -vE 'var\(--space|var\(--blur'; echo G1=$?
grep -n 'font-size' $f | grep -v 'var(--text'; echo G2=$?
grep -n 'border-radius' $f | grep -vE 'var\(--radius|999px'; echo G3=$?
grep -nE '^\s*(background|color|border[^:]*):' $f | grep -vE 'var\(--|none|#000|transparent'; echo G4=$?
# 4) 暗道与内联（均预期空输出 rc=1）
grep -nE '^\s*--[a-zA-Z0-9-]+\s*:' $f; echo DARKPATH=$?
grep -n 'style={{' src/remote-control/*.tsx; echo INLINE=$?
```

第 2 条的 42 名候选全集 grep 定义校验（本会话实测恰 42 行、零多零少；pattern 即 §2 各表 token 名之并集）：

```
grep -nE '^  --(space-(1|2|3|4|5|6|12)|text-(xs|sm|base|lg|xl|2xl|primary|secondary|muted|light|on-color)|radius-(sm|md|lg|xl|full)|white-alpha-(10|15|25|60|70|75|85)|black-alpha-(50|70)|status-(success|warning|error|info)|border-default|shadow-lg|gradient-primary-subtle|blur-(sm|xl)|saturate-high):' src/styles/variables.css
```

## 6. 历史教训（本表形成过程中真实踩过的坑）

1. **计数口径坑**：`grep -c`=行数、`grep -o|wc -l`=次数、`sort -u|wc -l`=种类——上游 R1 曾把 95 行说成「95 处」被抓口径不严谨；分项统计表必须与总数对账（R2 表分项合计 98≠106、漏 3 token，R3 复核发现后本表已按全集重列）。
2. **行号漂移坑**：共享在飞树上一切行号都会漂（R2 表 4 处行号漂移，实测以本表为准）；引用行号须标注实测时点，写文档前亲手 grep。
3. **grep 退出码语义**：零命中是 rc=1；rc=2 是命令错误（路径/权限），**rc=2 的空输出不能当零命中证据**（上游 review R2 曾因此被驳）。
