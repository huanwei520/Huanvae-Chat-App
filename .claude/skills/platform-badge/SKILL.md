---
name: platform-badge
description: 会议瓦片平台/设备徽章（PlatformBadge）的完整渲染链、安卓图标渲染成黑块/白块的根因机理与 SVG 小尺寸字形设计契约、组件三条渲染口径、双端实测验收配方 — 「会议里参会人瓦片左上角设备图标显示异常（黑块/不可辨）」「要新增/修改平台图标」「要动 platform-badge 尺寸或样式」类任务，先读本 skill。核心换算法：物理特征像素 = path 坐标单位 × (svg 实渲染 px / viewBox 24)，任何特征 < 1.5px 物理像素必被抗锯齿糊化成无特征色块。
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Write, Edit
---

# 会议瓦片平台徽章（PlatformBadge）：渲染链、黑块根因机理与字形契约

> 来源：块 `1789791036751-6drg5l77-1-修会议瓦片安卓图标黑块`（2026-09-19，缺陷 A；
> code/review 两层多轮过判 review PASS，update 层落典本 skill）。
> owner 报障原话：「会议模式，安卓设备图标显示有问题」（桌面端会议，安卓参会人瓦片
> 左上角图标 = 一个黑色小方块，内容不可辨）。
> 本文 file:line 为 2026-09-19 工作区实测（修复以工作区 diff +6/-2 在案，是否合入由后续流程定）。

## 触发场景（命中任一条，先读本 skill）

- 「会议瓦片上的平台/设备图标显示为黑块、白块或不可辨」类 bug；
- 要新增/修改 `PLATFORM_GLYPH` 里的平台字形、或改 `.platform-badge` 尺寸/底色；
- 要给 PlatformBadge 接新平台键（如 ios 转正）；
- 要对图标类修复做桌面 VM + 移动真机的双端截图验收。

## §1 渲染链图谱（file:line 实测，桌面/移动双端）

数据源：`participant.platform`（后端 presence 序列化；本链只消费不生产——
**上报/序列化环节的 bug 不在此链，别在这里找**）。取值域见 `src/utils/platform.ts`
（`PlatformName`，`getPlatformName` :142-166 缓存于 `_platformNameCached`）。

```
桌面（owner 报障面）
  src/meeting/MeetingPage.tsx:287
    {!isLocal && <PlatformBadge platform={participant?.platform} />}
  → src/meeting/components/PlatformBadge.tsx（2026-09-19 工作区实测，sha256 f24f584e…）
      :26-55  PLATFORM_GLYPH 表（windows/android/macos/linux 四枚；android 条目 :33-42）
      :64-67  platform 缺席 → return null（不画）；:68-72 glyph 未命中 → return null
      :81-89  <svg viewBox="0 0 24 24"><path d={glyph.path} fill="currentColor"/>
  → src/meeting/styles.css
      :1457   .platform-badge   30px 深色玻璃圆（background: rgba(15,23,42,0.45) + blur）
      :1476   .platform-badge svg   width/height: 15px   ← 关键尺寸锚点

移动
  src/pages/mobile/MobileMeetingPage.tsx:228（工作区 2026-09-19 实测；HEAD=:227——兄弟块
    缺陷B WIP 在 :49 加 import 把后文推移 1 行，行号漂移的活例，见 §4 已知坑）
    {!isLocal && <PlatformBadge … className="platform-badge--mobile" />}
  → src/styles/mobile/meeting-page.css
      :900   .platform-badge--mobile      26px 圆
      :907   .platform-badge--mobile svg  13px   ← 比桌面更小、更贴近糊化下限
```

**图谱要点**：`!isLocal` 门在调用方（两处各自写死）；徽章只存在于远端瓦片，
本端瓦片永远不渲染（口径见 §3）。

## §2 黑块根因机理：viewBox 换算 + 抗锯齿糊化（可泛化判定法）

**本次根因（实证链完整）**：旧 android 字形是「无特征圆角矩形 + 双眼 r=1」。
桌面 svg 实渲染 15px、viewBox 24 → **0.625px/unit**，双眼物理直径仅 ≈1.25px，
被抗锯齿完全糊化；外轮廓又是无特征纯填充矩形 → 深色徽章底上只剩一团无特征块，
即 owner 眼中的「黑色小方块」。修复前后 winserver-hg VM 内实拍对照 +
playwright 按真实尺寸离屏渲染新旧 glyph 对照，均证实旧字形 15px 下退化为块。

**通用判定法（改任何小尺寸图标前先算一遍）**：

```
物理特征尺寸 = path 坐标单位 × (svg 实渲染 px ÷ viewBox 边长)
```

- 桌面：unit × 15/24 = **×0.625**；移动：unit × 13/24 = **×0.5417**；
- **任何特征（眼、点、缝隙）换算后 < ≈1.5 物理像素 → 必糊**，图形退化为无特征色块；
- 「在图标编辑器里看着很清楚」≠「15px 下可辨」——判定只认换算结果或真机放大截图；
- 深色半透明徽章底会进一步吃掉低对比细节，糊化后视觉呈「黑块」（白 glyph 糊在深底上）。

**SVG 小尺寸字形设计契约（本次固化，后续改 glyph 必须遵守）**：

1. **特征下限**：眼睛/孔洞半径 ≥1.5（15px 下 ≈1.9px 物理直径）；再小必然糊化；
2. **nonzero fillRule 镂空**：`<path>` 默认 nonzero，**外轮廓与孔洞必须反向环绕**
   （本次：外轮廓顺时针、双眼逆时针）——同向会被填充吞掉，孔洞消失且无报错；
3. **特征用直线与大圆弧**：触角做成纯直线三角，任意缩放不丢；小曲线、细缝隙低分辨率必丢；
4. **纯几何 path、零外部依赖**：不引图标字体/网络资源/图片 asset（无加载失败 fallback 问题）；
5. **currentColor 着色**：字形不带色相，颜色由外层 `.platform-badge` 控制（白 α.95）。

修复版 android 字形（已带注释写入 PlatformBadge.tsx :33-41，注释 :33-37 + path :41）：圆顶（`a7 7` 半圆）+
双直线触角 + 双眼镂空洞（r=1.5），三条特征在 13px（移动端最坏情况）下仍可辨。

## §3 组件契约（三条渲染口径 + 扩展规则，见 PlatformBadge.tsx 文件头）

1. **本端瓦片不画自己的徽章**——由调用方 `!isLocal` 保证；新增调用点必须带此门，
   否则本端瓦片出现自己平台图标属破契约；
2. **`platform` 字段缺席 → null**，不回退「未知平台」图标（旧服务端不序列化、
   旧客户端不上报，两种缺席都走这；画「未知」会让用户误判对端识别失败）；
3. **`ios` / `unknown` → null**（四端方案只有 windows/android/macos/linux 四枚；
   字段照发、只是没图标）。转正 ios 需 owner 立项，不是顺手加一行；
4. 扩展新平台：在 `PLATFORM_GLYPH` 加键（键名 = `PlatformName` 小写值），字形过 §2 契约，
   并在**桌面 15px 与移动 13px 两档都做放大截图验收**；
5. 徽章样式（30px/26px 圆、深玻璃底、左上角定位）在 CSS 侧，改动须重验 §2 换算——
   **缩小徽章 = 缩小所有特征的物理像素**，13px 已贴近下限，再小先算账。

## §4 验收配方：双端真页面 + 前后对照 + 放大判据

**判据**：修复后图标内容可辨（安卓=圆顶+双触角+双眼洞）、无黑块、无破版；
修复前必须先复现存照（无 before 则 after 无因果）。

桌面（winserver-hg VM，设备级原件，禁 web 降级）：
1. VM 内构建运行 App（快照树 + `corepack pnpm tauri build`），推文件后 sha256 双侧对账；
2. 双端同房间（桌面 u3 + emulator-5554 安卓端）→ 安卓参会人瓦片入镜；
3. VNC（`vncdo -s 127.0.0.1:1`）截 1280×800 全窗 + 徽章 6x~8x 放大裁剪，前后各一组。

移动（emulator-5544 系，`adb exec-out screencap -p` 设备级）：
同机双后缀包（applicationId 后缀区分）同房间对拍改前/改后包，logcat 载入的 dist 资产名
做「实跑确为新包」铁证；安卓看远端安卓瓦片是 android glyph 在移动端的唯一可见场景（!isLocal）。

门禁三件套：`npx tsc --noEmit` + `npx eslint src/meeting/components/PlatformBadge.tsx` +
`npx vitest run tests/unit/uiThreePack.test.tsx`（16/16）全 RC=0；工作区有并行块 WIP 时
在干净 worktree（HEAD+修复）跑更能代表受测修复。

**已知坑（前人实踩，照抄会浪费时间）**：
- owner 口述「黑色小方块」vs 实拍「深底白块」：现象词不可靠，以像素证据为准；
- 文档行号会漂：code 交付曾把 svg 规则写成 :1477-1481（实测 :1476-1479）、
  review 曾把文件路径写成 `src/styles.css`（实为 `src/meeting/styles.css`）；本 skill 自身
  初版也漂过（PLATFORM_GLYPH 写 :31-59 实测 :26-55）——且漂因不止笔误：**并行块 WIP
  会推移行号**（本块实例：MobileMeetingPage 挂载 HEAD :227 → 工作区 :228，兄弟块缺陷B
  在 ：49 加 import 推 1 行）。沉淀/复核前一律现场 grep 重锚，引用时注明 HEAD/工作区口径；
- VM 侧环境竞态（登录 Failed-to-fetch 自愈、explorer.exe 缺失、/tmp 凭据被清）：
  先用 node 复刻网络口径定界「App 坏 vs 环境坏」，再动代码；
- 多块并发实测共用测试账号时先看 `VM-COORDINATION.md`，避免互相驱动对方瓦片。
