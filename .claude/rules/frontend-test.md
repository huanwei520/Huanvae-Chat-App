# 前端测试规则（frontend-test）

Vitest + @testing-library/react 下的踩坑点和惯用模式。

## "所有 X 必经 Y" 类不变量：单一收口点 + 静态契约测试强制，不靠散文声明

### vitest mock invoke + jsdom 测不到真 webview/真 TLS，"全部迁移完"的散文声明必漏且无人复查

当某条架构不变量是"**所有** X 都必须经过 Y"（典型：所有 webview 原生 `<img>/<video>` 显示的**远程后端资源**都必须经回环安全反代收口点 `secureProxy.resolveDisplayUrl`——否则系统信任库验不过私有 CA 自签 leaf → certificate invalid），**绝不能靠"人工枚举各处改一遍 + 注释/commit 写'已全部迁移/消灭剩余直连'"来保证**。原因：

- vitest 是 jsdom + mock invoke，`<img src>` 根本不发起加载、不做 TLS；playwright 是浏览器假扮 Tauri（mock invoke）。**真 webview + 真私有 CA 的渲染失败，整套门禁测不到**（门禁全绿 ≠ 真机能显示）。
- 散文声明是**一次性断言**，写错（漏一处）后没有任何东西复查；人工枚举显示点必漏——尤其**消息 JSON 解析出来的字段**（如会议邀请卡 `payload.creator_avatar`）不在显眼的 hook/service 路径上，最易漏。

**规则**：这类不变量必须用两件套机器强制：

1. **单一收口点**：所有该走该路径的值只能从一个具名函数产出（如 `resolveDisplayUrl`/`resolveServerAvatarUrl`），让"绕过"在结构上不自然。注意区分用途——**显示**用反代 URL，**Rust 下载/跨窗 handoff** 用原始 URL（directIpUrl 重写需裸 URL，传反代 loopback 会坏）；同一产出点同时给两个值、字段分开。
2. **静态契约测试**（仿 `tests/secure-display-routing.test.ts` / `animation-conflict.test.ts`）：`readFileSync` 扫各显示点源码，断言"必经收口点、裸后端 URL 即 FAIL"，块内有界正则 + **node 变异验证**（还原成裸 URL 必须从 PASS 翻 FAIL，证明非恒真）。把"消灭剩余直连"从散文变成机器复查的不变量。

**审计这类不变量的完整性**：必须把**每个** `<img/video/audio src={X}>` 追到 `X` 的**数据源**——是经收口点解析的（数据边界解析，如 useFriends/useGroups 构建对象时调 resolveServerAvatarUrl，显示点消费已解析值，OK），还是裸接后端字段（BUG）。**不能只查显眼的 fileCache/hook 路径**，要 grep 全部 `src={...avatar|logo|icon|image|cover|_url...}` 并逐一回溯，含消息 content JSON 解析字段。

**反例（2026-06-08）**：2026-06-02 "App 显示层补完（消灭剩余直连）" 靠人工枚举（头像/上传/语音/诊断/lowcode），散文写"消灭剩余直连"，**漏了最大的聊天图片/视频消息显示路径**（fileCache 远程分支返裸 presigned 喂 `<img>`）+ 独立预览窗 + 会议邀请头像；门禁（mock+jsdom）全绿，真机才暴露 certificate invalid。修复=新增 `resolveDisplayUrl` 单一收口 + `secure-display-routing.test.ts` 静态契约（变异验证过）+ 删同类死代码 `LocalFilePreview`。且 audit 的显示点摸排（Explore agent）仍漏了 `MeetingInviteCard.creator_avatar`（消息 JSON 派生），靠 **blind-review 独立 grep 追数据源** 才补上——印证"审计完整性必须追到数据源 + 盲审独立复扫"。

## tests/setup.ts 的 mock 能力与局限

### WebviewWindow mock 不含静态方法

[tests/setup.ts:59-64](c:/Users/25615/Desktop/Huanvae-Chat-App/tests/setup.ts#L59) 把 `@tauri-apps/api/webviewWindow` 里的 `WebviewWindow` mock 成了一个构造函数：

```ts
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: vi.fn().mockImplementation(() => ({
    once: vi.fn(),
    listen: vi.fn(),
    emit: vi.fn(),
  })),
  ...
}));
```

**只 mock 了构造后的实例方法**（`once`/`listen`/`emit`），**没有 mock 静态方法**（`WebviewWindow.getByLabel(...)` 会抛 `WebviewWindow.getByLabel is not a function`）。

**规则**：如果被测组件用到了 `WebviewWindow.getByLabel` / `getAll` / `getCurrent` 这类**静态**方法：

- **首选**：把组件内"URL 拼接 / 状态决策"等业务逻辑抽成 `export` 的 pure function，对纯函数做单元测试。React 状态机/生命周期连线交给代码审核把关。
- **次选**：在测试文件顶部用 `vi.mock(...)` 覆盖 setup.ts 的 mock，补全所需静态方法。

**反例（2026-04-23）**：
- `MiniAppsModal` 的 `handleOpen` 里有 `await WebviewWindow.getByLabel(windowLabel)`
- 初次 Plan 打算对 MiniAppsModal 做整体渲染测试 → 发现 mock 无 getByLabel
- 改为抽 `buildMiniAppLaunchUrl` (URL 拼接) 和 `buildCredentialsFields` (凭据字段构建) 为 exported pure function
- 9 个测试用例全部覆盖新增业务逻辑，零 mock 成本

### 全局 DOM Observer mock 必须写成可构造 class（箭头 vi.fn 形式不可 `new`）

三方库会在内部 `new ResizeObserver(...)` / `new IntersectionObserver(...)`（dnd-kit 的 DndContext 就这么做）。setup.ts 若用 `vi.fn().mockImplementation(() => ({...}))` 箭头形式 mock 这类全局 Observer，被 `new` 时行为不符合构造函数契约，依赖它的组件树整树渲染炸掉——且炸的往往是**看似无关的既有测试**（谁的渲染树里挂了用该库的组件谁遭殃）。

**规则**：全局 Observer 类 mock 一律写成可构造 class：

```ts
// ✅ tests/setup.ts 现行写法（2026-07-14 起）
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
```

⚠️ 截至 2026-07-14，setup.ts 的 `IntersectionObserver` mock 仍是箭头形式（同雷未爆）——将来任何库内部 `new IntersectionObserver` 时按本条改成 class。

**反例（2026-07-14）**：侧边栏引入 @dnd-kit 后，DndContext 内 `new ResizeObserver` 撞上箭头 mock，既有 SidebarAvatarA11y 5 个用例连带失败；改可构造 class 后全部复活。

### 给"重型子树 mock 成 null"的结构/a11y 测试新增子组件时，必须同步补 mock 新子（尤其消费 context hook 的）

结构/a11y 测试（如 ChatHeaderAvatarA11y、SidebarAvatarA11y）常把父组件（ChatPanel/MobileChatView）的重型子树整体 `vi.mock(..., () => null)`，只验顶栏结构、不挂 SessionProvider 等 context。**给这类父组件新增一个子组件时**，若新子在渲染期调用 context hook（`useApi()`/`useSession()` 等），而该测试没把新子也 mock 掉 → 新子在无 Provider 的测试里抛 `useSession must be used within a SessionProvider` → **该看似无关的既有 a11y 测试整片连带失败**。

**规则**：给 ChatPanel/MobileChatView 等"被结构测试 mock 掉子树"的父组件挂新子组件时，plan/实现阶段就 grep 哪些测试把该父组件的子树 mock 成 null（或直接渲染父组件），对每个这类测试**同步加一行** `vi.mock('.../新子组件', () => ({ 新子组件: () => null }))`。新子自身逻辑由它自己的测试覆盖，这里只为让父组件结构测试不被新子的 context 依赖炸穿。

**反例（2026-07-21 · req-06 顶置架）**：ChatPanel/MobileChatView 挂新子 `ConversationShelf`（`ConversationShelf.tsx:52 const api = useApi()`）→ 既有 `ChatHeaderAvatarA11y.test.tsx`（已把重型子树 mock 成 null 但没 mock 新子）13 用例全挂，报 `useSession must be used within a SessionProvider`；补 `vi.mock('../../src/chat/shared/ConversationShelf', () => ({ ConversationShelf: () => null }))` 后 13/13 复活、全量 2417/0。与上条 Observer-mock 同属"新增件连带炸看似无关既有测试"家族，但根因是"新子消费 context hook 而测试无 Provider"，非 Observer 构造契约。

### 给模块新增导出后，必须同步补全所有 `vi.mock` 该模块的工厂

`vi.mock('.../<模块>', () => ({ … }))` 的工厂是**整体替换**：工厂里没列的导出，在被测代码里就是不存在的，vitest 直接抛 `No "<导出名>" export is defined on the … mock`。所以给一个**被 mock 的模块新增导出**时，只改 `src/` 是不够的 —— 任何 `vi.mock` 了它、且被测组件会调到新导出的测试都会挂，且**挂的是看似跟本次改动无关的既有测试**。

**规则**：新增导出后立刻

```bash
grep -rln "vi.mock('.*<模块名>" tests/
```

逐个把新导出补进工厂（**纯增量**：只加这一个 key，不动既有断言、不动既有用例）。新导出自身的行为由它自己的测试覆盖，这里补 mock 只为让既有测试不被打穿。

**反例（2026-08-06）**：`src/huanvaeGuard/localApi.ts` 新增 `resolveLocalPort` 导出（全仓唯一的本地控制端口解析口）后，4 个 `vi.mock` 了该模块的测试（`HuanvaeGuardPage.test.tsx` / `HuanvaeGuardPage.probeRace.test.tsx` / `HuanvaeGuardPage.macos.test.tsx` / `HuanvaeGuardStatusRefresh.test.tsx`）工厂里都没列它 → 页面渲染一调就报 `No "resolveLocalPort" export is defined on the … mock`；4 处工厂各补一行即全部复活。

与本节前两条（Observer 构造契约、新子消费 context hook）同族：根因都是"**新增件把既有测试的替身打穿**"，统一的检查动作是 —— **改完 `src/` 先 grep 谁 mock 了我**。

### 已 mock 的 Tauri 模块速查（tests/setup.ts 截至 2026-04-23）

| 模块 | mock 程度 | 坑 |
|------|----------|-----|
| `@tauri-apps/api/core` (invoke) | 完整 | — |
| `@tauri-apps/api/webviewWindow` | 仅实例方法 | **无静态方法** |
| `@tauri-apps/api/window` (getCurrentWindow) | 完整 | — |
| `@tauri-apps/api/event` | **未 mock** | 用 emit/listen 的组件需在测试里补 mock |
| `@tauri-apps/plugin-sql` | 完整（select 返回空数组） | 需查询具体数据的测试需在 mockResolvedValue 上覆写 |
| `@tauri-apps/plugin-dialog` | 完整（返回 vi.fn()） | — |
| `framer-motion` | `MotionGlobalConfig.skipAnimations = true` | 动画完成的 `onAnimationComplete` 回调不会触发，依赖它的断言需用 `waitFor` 或改逻辑 |

## 抽 pure function 的决策标准

当 React 组件测试的 mock 成本高于业务逻辑本身时，把纯逻辑抽成 `export function` 做单元测试。

**适合抽出的征兆**：
- 逻辑是数据变换（输入 → 输出），不涉及 React state / ref / effect
- 依赖多个 Tauri API 或外部模块的组件渲染测试会拖累测试可维护性
- 业务逻辑本身简单到不值得为其配完整渲染栈

**不应抽出**：
- 涉及 React hook 调用（useState/useEffect/useCallback）
- 依赖 Context 数据
- 与 DOM 强耦合（事件处理、focus 管理等）

**反例（2026-04-23）**：`buildMiniAppLaunchUrl(serverUrl, accessUrl, token): string` 是纯字符串拼接，抽出后测试无任何 mock；原组件内保留单行调用 `buildMiniAppLaunchUrl(...)`，代码更短、测试更稳。

## 测试断言严谨度基线

- 复制/剪贴板类断言：用 `toHaveBeenLastCalledWith(具体值)` 或 `toHaveBeenCalledWith(具体值)`，不要只用 `toHaveBeenCalled()` 空壳
- 数组字段构建断言：用 `toEqual([...])` 整体比对（含顺序），不要只断言 `.length`
- 条件分支场景：成对写正反断言（字段存在 + `some(...) === false` 的缺失断言）

## 拒绝"假测试"（tautology）

### 测试静态字面量 className 是测 testing-library，不是测项目代码

下面这种测试**毫无防回归价值**：

```tsx
it('subtle-btn--primary 渲染', () => {
  render(<button className="subtle-btn subtle-btn--primary" />);
  expect(screen.getByRole('button')).toHaveClass('subtle-btn--primary');
});
```

被测对象是测试自己写死的字符串。如果未来真组件把 `subtle-btn--primary` 拼错成 `subtle-btn-primary`，这个测试不会失败 — 它根本没引用真组件。

**规则**：写每个测试前先问"哪个表达式可能被人写错"：

- 字面量字符串 / 字面量对象 → **没人能写错** → 不需要测
- 条件拼接 / 三元 / 模板字符串 / 动态计算 → **会写错** → 这才有测试价值

**反例（2026-04-23）**：
- 写了 3 个 "subtle-btn className convention" 测试直接 render `<button className="subtle-btn ...">`
- 被 code-review 标 Critical
- 改成 render 真组件 `<SettingsRow type="button" buttonVariant="danger" .../>` 验证生成的 button 有 `subtle-btn--danger`、不有 `subtle-btn--primary`，并补 default → primary 反向断言
- 这才覆盖了 SettingsRow.tsx:182 的 `buttonVariant === 'danger' ? '--danger' : '--primary'` 三元

## framer-motion v12 variants 含 exit 字段时必须配 motion 组件 `exit="exit"` prop

### variants 对象的 exit key 不会自动激活，必须在 motion.* 上显式声明

framer-motion v12 解析 variant 时按 `props[type] !== undefined ? props[type] : context[type]` 取值（[`motion-dom/dist/es/render/utils/animation-state.mjs:86-87`](https://github.com/framer/motion/)）。这意味着即使 variants 对象里写了 `exit: { ... }`，**如果 motion 组件本身没传 `exit="exit"` prop，AnimatePresence 退出时不会触发该 variant**。

**规则**：给 cardVariants/pageVariants/modalVariants 等加 `exit` 字段时，必须同步检查所有引用此 variants 的 `<motion.*>` 是否带 `exit="exit"`：

```tsx
// ❌ 错误：variants.exit 是装饰，AnimatePresence 退出时无动画
const cardVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, scale: 0.9 },
};

<AnimatePresence>
  {items.map(i => (
    <motion.div
      key={i.id}
      variants={cardVariants}
      initial="initial"
      animate="animate"
      // ❌ 缺 exit="exit"，items 减少时无 exit 动画
    />
  ))}
</AnimatePresence>

// ✅ 正确
<motion.div
  variants={cardVariants}
  initial="initial"
  animate="animate"
  exit="exit"        // 必需
/>
```

**反例（2026-05-07）**：
- 修「我的文件」移动端 cardVariants 缺 exit 瑕疵时，只在 cardVariants 加了 `exit: { opacity: 0, scale: 0.9 }`，但 [`MobileFilesPage.tsx`](src/pages/mobile/MobileFilesPage.tsx) 的 `<motion.div>` 没传 `exit="exit"`
- vitest 单元测试因 `MotionGlobalConfig.skipAnimations = true` 全部通过，盲审 Agent 也判 PASS（仅核对 variants 字段是否存在）
- code-review Agent 通过读 framer-motion 源码反向验证抓到该 bug：variants 字段存在 ≠ exit 行为生效
- 教训：修瑕疵时必须**同时**改 variants 定义 + motion 组件 props；测试维度上加 rerender 减项 + waitFor unmount，确保完整链路被验证

## 动画相关变更必须补冲突回归测试（CSS vs framer-motion）

### 同一元素声明 CSS transition 又被 motion variants 控制时会冲突

framer-motion 的 `motion.*` 通过 inline style 逐帧改 `transform` / `opacity`。如果同一元素的 CSS 也声明了 `transition: all` 或显式 `transition: transform/opacity`，浏览器会对每次 inline style 变化启动一次 CSS 过渡 → 进入/退出动画抖动、拖慢、行为不可预期。

`MotionGlobalConfig.skipAnimations = true` 让 vitest 跳过帧更新 → 此类冲突在 vitest 中**永远测不出来**。e2e 真实浏览器才能复现，但项目内登录后页面（FilesModal/MobileFilesPage 等）受 `@tauri-apps/plugin-http` 通道限制 e2e 不可达。（🔴 **2026-08-19 订正：后半句已过期** —— 登录路径走 `invoke('secure_http')`，mock 补上该分支后 e2e 已能进主界面，见本文件「CI 门禁与 e2e 的真断言」。）

**规则**：每新增一个由 `motion.* + variants` 控制 + 拥有自定义 className 的组件，必须：

1. 检查该 className 在所有 CSS 文件中的 `transition` 字段，移除：
   - `transition: all <duration>` —— 必须改成具体属性枚举
   - `transition: transform ...` —— framer-motion 接管 transform，CSS 不能再过渡此属性
   - `transition: opacity ...` —— 同上
   - 其他被 variants 控制的属性同理

2. 在 [tests/animation-conflict.test.ts](tests/animation-conflict.test.ts) 的 `MOTION_CONTROLLED_SELECTORS` 注册表中新增一条记录：

```ts
{
  selector: '.your-card',                              // CSS 选择器（基础形态）
  cssFile: 'src/styles/.../your-styles.css',           // 对应 CSS 文件
  controlledProps: ['transform', 'opacity'],           // motion 控制的属性
  motionLocation: 'src/.../YourComponent.tsx (cardVariants)', // 来源（仅注释）
}
```

3. 跑 `pnpm vitest run tests/animation-conflict.test.ts` 确认 PASS

**何时算"动画相关变更"**：
- 新增 `motion.* + variants={...}` 组件
- 给已有 motion 组件加新的动画属性（如 cardVariants 加 `scale`）
- 给已有 motion 组件的 CSS 加 `transition` 字段
- 修改已注册 motion 组件的 className

**反例（2026-05-07）**：
- FilesModal 的 `.file-card` CSS 写了 `transition: all 0.2s ease`，同时 `<motion.div className="file-card">` 用 cardVariants 控制 `opacity` + `y`（即 transform）
- vitest 全绿、e2e 不可达、code-review 第一轮也未捕获 —— 因为冲突只在真实浏览器逐帧渲染时才暴露
- 用户提问「文件进入显示部分的动画是否有两套动画在冲突」时才被发现
- 修复：CSS 改为 `transition: box-shadow 0.2s ease, border-color 0.2s ease;`；`.mobile-file-card` 的 `transition: transform 0.2s ease` 整条删除
- 同时新建 [tests/animation-conflict.test.ts](tests/animation-conflict.test.ts) 静态解析 CSS 文件，断言注册表中的 selector 不含冲突 transition

### 检查时机前移到 plan 阶段（不要等到 code-review/blind-review）

写新 motion + variants 组件的 plan 时，CSS 设计稿就应该一开始避免：

- `transition: all` —— 永远不写，必须明确属性枚举
- `transition: transform ...` / `transition: opacity ...` —— 不写，让 framer-motion 全权接管
- `:active { transform: scale(0.98); }` 形式的 CSS 反馈 —— 改用 motion.div 的 `whileTap={{ scale: 0.98 }}`，避免 `:active` 触发 transform 与 motion variants 抢同一帧

同时 plan 中**预先**列出"将 selector 加入 [tests/animation-conflict.test.ts](tests/animation-conflict.test.ts) `MOTION_CONTROLLED_SELECTORS`"作为一条变更项，与组件实现并行落地，而非事后追加。

**反例（2026-05-10）**：
- MobileMiniAppsPage 的 `.mobile-miniapp-card` CSS 写了 `transition: background 0.2s ease, transform 0.15s ease;` + `:active { transform: scale(0.98); }`，同时 motion.div 用 cardVariants 控制 `y` (即 transform)
- vitest/typecheck/lint/code-review 第一轮全绿（前述事后视角规则覆盖了"修瑕疵时"，但没明确说"plan 阶段就该写对"）
- blind-review 在 PASS 后做附加检查时才抓到
- 教训：motion 组件的 CSS plan 设计稿，一开始就不该写 `transform` 过渡 / `:active` transform 反馈；写完立刻把 selector 加到注册表

## 修改 CSS 后必须跑 `pnpm build` 验证（vitest 不会编译 tailwind）

### vitest / typecheck / lint 都不读 PostCSS / tailwindcss

vitest jsdom 把 `.css` 当字符串 import，typecheck 不解析 CSS，lint 不读 CSS 内容。**只有 `pnpm build`（vite + @tailwindcss/vite）才真正跑 CSS 编译**，能捕获：

- 未闭合字符串（`content: '...';` 漏 `'`）
- 未闭合规则块（`{` 没配对 `}`）
- mojibake 导致的语法错误
- @import 路径错误
- tailwindcss 指令拼写错误

**规则**：任何修改 CSS 的任务（包括看似无害的注释改动、`transition` 调整等），完成后必须跑：

```bash
pnpm build
```

如果时间紧张可以仅跑前 N 秒拿到 CSS 编译错误（vite build 的 CSS 阶段在前期）。`pnpm test:run` 跑过不代表 CSS 没问题。

## 修改 CSS 后跑 [tests/css-encoding.test.ts](tests/css-encoding.test.ts) 守门 BOM / mojibake

### Windows + Edit 工具组合对大型 UTF-8 含中文 CSS 文件有编码风险

PowerShell `Set-Content` 默认写 UTF-8 时**带 BOM**（PowerShell 5.1）；某些编辑工具在写大型 UTF-8 文件时会把字节按 GBK 解释再以 UTF-8 写回，导致：

1. **BOM 被引入**：`@import` 拼接后 BOM 出现在流中部，tailwindcss 报错
2. **GBK→UTF-8 mojibake**：所有中文变乱码（`释` → `閲`），字符数变化可能让 `'...'` 字符串丢失闭合 → Unterminated string

[tests/css-encoding.test.ts](tests/css-encoding.test.ts) 静态扫描 `src/styles/**/*.css`：
- 任意文件含 BOM → FAIL
- 任意文件含已知 mojibake 标记字符（`閲` / `鎺` / `銆` / 等）→ FAIL
- 运行成本 < 1s，应纳入每次 CSS 修改后的标准验证

**反例（2026-05-08）**：
- 多次用 Edit 工具修改 [main.css](src/styles/pages/main.css)（5000+ 行，含大量中文注释）后，整个文件被加上 BOM 且全文中文 mojibake
- `content: '释放以发送文件';` (line 2309) 乱码后变 `'閲婃斁浠ュ彂閫佹枃浠?;`，单引号丢失闭合
- vitest 837/837 全绿、typecheck/lint 全过，但 `pnpm tauri dev` 启动时 tailwindcss 报 `Unterminated string`，dev server 红屏
- 修复：`git checkout HEAD -- src/styles/pages/main.css` 还原，然后只用 **ASCII 注释**重做必要改动；新增 `tests/css-encoding.test.ts` 防回归
- 教训：在 Windows 上对大型含中文 CSS 文件做 Edit 时，注释**必须用 ASCII**（避免触发 Edit 工具的编码 bug 累积破坏整文件）

## framer-motion v12 包装自定义组件用 motion.create

### v11 起 motion(Component) 被 deprecated

`motion(Component)` 在 v11 起 deprecated（开发模式有 `"motion() is deprecated. Use motion.create() instead."` warn），v12 仍可用但应迁。

**规则**：包装 forwardRef 组件以接收 framer-motion props（variants/whileHover/whileTap）时：

```tsx
import { motion } from 'framer-motion';
import { MyComponent } from './MyComponent';

// 推荐
export const MotionMyComponent = motion.create(MyComponent);

// 仍可用但 deprecated
const MotionMyComponent = motion(MyComponent);
```

被包装组件**必须用 forwardRef**，否则 motion.create 运行时告警。

**反例（2026-04-23）**：
- 12 处 `.glass-button` 实际全是 `<motion.button>`，迁到 AppButton 时需要保留 motion props
- AppButton 用了 forwardRef，直接 `motion.create(AppButton)` 工作正常
- 项目当前 framer-motion 版本：12.26.2

## eslint 在测试中接受 non-null-assertion

项目约定：测试文件允许用 `!` 断言 `getAllByText` 等返回值非空，但需在文件顶部加：

```tsx
/* eslint-disable @typescript-eslint/no-non-null-assertion */
```

参考 [tests/components/SettingsPanel.test.tsx:12](c:/Users/25615/Desktop/Huanvae-Chat-App/tests/components/SettingsPanel.test.tsx#L12)。

## vi.mock 工厂引用 outer 变量必须用 vi.hoisted()

### vi.mock 调用会被 hoist 到所有 import 之前

Vitest 把 `vi.mock(...)` 调用提升到 import 之前执行，所以工厂函数里**不能**引用文件顶部声明的普通 `const`/`let`/`var`：

```ts
// ❌ 错误：mockServerApi 在 vi.mock 工厂执行时还未声明
const mockServerApi = { foo: vi.fn() };
vi.mock('../../src/serverApi', () => mockServerApi);
// 运行时报错：Cannot access 'mockServerApi' before initialization
```

**规则**：用 `vi.hoisted()` 包装外层引用变量，让其与 `vi.mock` 同样被提升：

```ts
// ✅ 正确
const mockServerApi = vi.hoisted(() => ({
  foo: vi.fn(),
  bar: vi.fn(),
}));
vi.mock('../../src/serverApi', () => mockServerApi);

// beforeEach 里仍可正常使用：
beforeEach(() => {
  Object.values(mockServerApi).forEach((m) => m.mockReset());
});
```

**反例（2026-05-06）**：
- HuanvaeGuardPage.test.tsx 顶部用 `const mockServerApi = { ... }; vi.mock(..., () => mockServerApi)`
- 整个测试文件 13 个用例全部失败，错误：`Cannot access 'mockServerApi' before initialization`
- 改用 `vi.hoisted()` 后立即 13/13 通过

## 单组件文件需要全栈 Tauri mock 时考虑抽出纯函数

`HuanvaeGuardPage.tsx` 直接 import 了 `@tauri-apps/plugin-os` (platform) 和 `@tauri-apps/api/event` (emit/listen)，两者**均未在 [tests/setup.ts](tests/setup.ts) 全局 mock**。如果纯函数测试只想验证某个工具函数（如 `formatHandshake`），从该 page 文件 import 会触发整条 Tauri 模块加载链。

**规则**：page 文件里**纯展示/格式化用的辅助函数**应抽到独立 `format.ts`/`utils.ts` 等无 Tauri 依赖的模块，单测直接 import 该模块，无需 mock 整套 Tauri API。

**反例（2026-05-06）**：
- `formatHandshake` 原本在 `HuanvaeGuardPage.tsx` 文件内
- 单测 `import { formatHandshake } from '../../src/huanvaeGuard/HuanvaeGuardPage'` 会触发未 mock 的 `@tauri-apps/plugin-os` 加载
- 抽到 `src/huanvaeGuard/format.ts` 后，单测零 mock 成本通过

## 注册新组件必须同时改两处文件

### `tests/registry.ts` 不是唯一注册入口

新增组件需要被「全量回归测试」覆盖时，**同时**改两个文件，缺一不可：

1. [tests/registry.ts](tests/registry.ts) — 元数据注册（name/path/category/description）
2. [tests/components/registry.test.tsx](tests/components/registry.test.tsx) — 实际 `import * as X from '...'` + 加入 `COMPONENT_MAP` 字面量

[`registry.test.tsx`](c:/Users/25615/Desktop/Huanvae-Chat-App/tests/components/registry.test.tsx) 用 `it.each(COMMON_COMPONENTS)` 遍历 registry 元数据，每项做 `expect(COMPONENT_MAP[entry.name]).toBeDefined()` 断言。如果只改了 registry.ts 没改 registry.test.tsx，全量回归会失败「expected undefined to be defined」。

**规则**：注册新组件流程：

1. 改 `tests/registry.ts`，加 `{ name: 'X', path: '...', category: '...', description: '...' }`
2. 改 `tests/components/registry.test.tsx`：
   - 顶部 `import * as X from '../../src/.../X'`
   - `COMPONENT_MAP` 字面量内加 `X,`
3. 跑 `pnpm vitest run tests/components/registry.test.tsx` 确认 PASS

**反例（2026-05-07）**：
- 新增 `FileContextMenu` + `FileMenuController` 仅改了 `tests/registry.ts`
- 全量回归 832/834 通过，2 个失败：`registry.test.tsx > 通用组件 > FileContextMenu/FileMenuController`
- 错误 `expected undefined to be defined` 指向 `COMPONENT_MAP[entry.name]`
- 补改 `registry.test.tsx`：加 `import * as FileContextMenu` + `import * as FileMenuController` + 在 COMPONENT_MAP 字面量加两行后 834/834 通过

### 新建 COMPONENTS 章节时必须三处同步（不仅两处）

如果不是给已有章节（如 `COMMON_COMPONENTS`）加条目，而是**新建一个章节**（如 `SEARCH_COMPONENTS`），需要做的事是上面两处之外**还要在 registry.test.tsx 加一段 describe + it.each 遍历断言**：

```tsx
// registry.test.tsx 顶部 import
import {
  ...,
  SEARCH_COMPONENTS,  // 新章节也要 import
  ...,
} from '../registry';

// 在 describe 列表末尾加新章节遍历
describe('全局搜索组件 (Search Components)', () => {
  it.each(SEARCH_COMPONENTS)('$name - $description', (entry) => {
    const module = COMPONENT_MAP[entry.name as keyof typeof COMPONENT_MAP];
    expect(module).toBeDefined();
    expect(Object.keys(module).length).toBeGreaterThan(0);
  });
});
```

**规则**：新建 COMPONENTS 章节流程是**三处同步**：
1. `tests/registry.ts` — 加 `export const SEARCH_COMPONENTS = [...]` 章节
2. `tests/components/registry.test.tsx` — import 章节 + import 各模块 + COMPONENT_MAP 字面量加条目
3. `tests/components/registry.test.tsx` — **加 `describe('xxx') { it.each(SEARCH_COMPONENTS)... }` 块**

第 3 步是关键。已有章节的 it.each 是已建好的，新章节没人遍历它 → 后续给该章节新增条目时，全量回归不会因"未注册"失败，rule 失去防回归价值。

**反例（2026-05-11）**：
- 新增 `SEARCH_COMPONENTS` 章节（GlobalMessageSearchResults + useGlobalMessageSearch）
- 改了 registry.ts（加章节）+ registry.test.tsx（加 import + COMPONENT_MAP），跑全量回归 960/960 通过
- code-review 第二轮抓到 Major：缺 `describe('全局搜索组件') + it.each(SEARCH_COMPONENTS)` 遍历块 → 未来 SEARCH_COMPONENTS 新增条目时，全量回归不会因"未注册"失败
- 补加 describe 块后 173/173 通过

## RTL renderHook 不能直接断言 useState lazy initializer 的同步初值

### `result.current` 已是 effect 完成后的状态，lazy initializer 给的初值若被立即 `setX` 覆盖就不可观察

`@testing-library/react` 的 `renderHook` 内部用 `act` 包裹渲染 + flush effects → 返回的 `result.current` 已经历过 mount + 第一波 useEffect 同步部分。这意味着如果 hook 内部有：

```ts
const [loading, setLoading] = useState(() => !hint);  // hint 命中 → 同步初值 false
useEffect(() => {
  loadSource();  // 同步先 setLoading(true)，再 await...
}, [loadSource]);
```

测试中 `result.current.loading` **永远拿到 true**（因为 useEffect 在 `result` 返回前已 flush 了 `setLoading(true)`）。lazy initializer 给的 `false` 同步初值**不可直接断言**。

**规则**：

1. **正确地测：分两层验证**
   - **同步初值**：用"不被 useEffect 立即覆盖的字段"断言（如 `src` / `isLocal` / `localPath` / `initialized` —— lazy init 设值后 useEffect 内的 setX 是别的 setter，不会覆盖这些字段）
   - **最终状态**：`await waitFor(() => expect(result.current.loading).toBe(false))` 验证异步校验完成后的值

2. **不要硬测 lazy initializer 的同步初值**：
   - 即使测试通过，也是巧合（依赖 React 内部 batching 时机），不稳定
   - lazy initializer 的正确性靠 TypeScript 类型 + code review + 间接字段覆盖共同保证

3. **若必须断言 lazy initializer 计算逻辑**：把 lazy initializer 抽成独立纯函数 `computeInitialState(input)` 单测，而不是测 hook 同步初值

**反例（2026-05-12）**：
- `useFileCache` 用 `useState(() => !hints[fileHash])` 让 hint 命中场景 loading=false（"切回不闪"机制）
- 测试 `expect(result.current.loading).toBe(false)` 同步断言失败 —— 因为 mount useEffect 已 flush `setLoading(true)`
- 修复：去掉 loading 同步断言（保留 src/isLocal/initialized 同步断言，这些字段不被 useEffect 立刻覆盖），用 `await waitFor` 验证最终 loading=false
- code-review Agent 当时标为 Major（"切回不闪机制核心"），但 RTL 模型下不可干净断言；接受技术限制，改用补充 reload 链路 isLocal=true→false 时 hint 被 remove 的反向测试覆盖防御意图

## vitest fake timer 与真实 Promise 协调用 async 版本

### `vi.advanceTimersByTime`（同步）只推进 setTimeout，不 flush microtask

被测 hook 里典型异步模式：

```ts
const timer = setTimeout(async () => {
  const data = await someAsyncFn();  // mockResolvedValue 是真实 Promise
  setState(data);
}, 500);
```

测试用 `vi.useFakeTimers()` 后：
- `vi.advanceTimersByTime(500)` 同步触发 setTimeout 回调，async 函数启动
- 但 `await someAsyncFn()` 后续的代码进入 microtask 队列，**fake timer 不推进 microtask**
- 测试 act() 退出时 setState 没机会执行 → 断言看不到结果 → 测试超时

**规则**：测 hook 里"setTimeout + await mock"组合时，必须用 vi 的 async 版本：

```ts
// 错误：同步版本不 flush microtask，测试超时
await act(async () => {
  vi.advanceTimersByTime(500);
});

// 正确：async 版本含 microtask flush
await act(async () => {
  await vi.advanceTimersByTimeAsync(500);
});

// 或者直接跑完所有 timer（推荐用于"等到稳定"）
await act(async () => {
  await vi.runAllTimersAsync();
});
```

**何时算"setTimeout + await mock"组合**：
- 防抖 hook（debounce）测试
- 节流 hook 测试
- 模拟数据加载延迟的 hook
- 任何在 setTimeout 回调内 `await` 真实 Promise（mockResolvedValue/mockRejectedValue）的代码

**反例（2026-05-11）**：
- `useGlobalMessageSearch` 用 setTimeout(500ms) 防抖 → 回调里 `await searchMessages()` (mockResolvedValue 真实 Promise)
- 测试用 `vi.advanceTimersByTime(500)` 同步版 → 3 个用例超时
- test-runner 改用 `vi.advanceTimersByTimeAsync` / `vi.runAllTimersAsync` 后 7/7 通过

## 静态扫描契约测试与 Code-review Minor 修改的相互依赖

### 用 readFileSync 扫描 src/ 源码做契约性测试时，Code-review 后的任何源码改动都可能让 regex 失效

当组件依赖图过大（如 App.tsx 顶层包了 useAccounts/useSession/useUpdateStore 等多个 hook）以致完整 render 成本极高时，可以用 `readFileSync` 读取 src 源码 + regex 断言"某 hook 在顶层被调用"、"某分支包含 `<X />` 渲染"等结构性契约。这是合理的替代方案，文件头注释中需明确说明用法和原因。

**陷阱**：这类测试对**任何源码格式变动都极敏感**。Code-review 提的 Minor 级"无害"建议（如合并 import、调整 import 顺序、改变量声明位置）会让 regex 不再匹配，导致测试 FAIL。

**规则**：

1. **改 src 源码后必须重跑相关静态扫描测试**。即使是 Code-review Minor 级建议（合并 import / rename / 移位置）也必须跑：

   ```bash
   pnpm vitest run tests/App/AppUpdateToast.test.tsx tests/animation-conflict.test.ts
   ```

2. **静态扫描测试的 regex 必须写宽松**：
   - import 匹配用 `\b<name>\b` 而非紧贴 `{` / `}`，允许任意其他 named symbols 并存
   - 用 `[^}]*<name>[^}]*` 模式而非要求精确顺序
   - 关键 assertion 写多个独立 `.toMatch`，每个聚焦一个特征，而非一个庞大正则

3. **Code-review Round 2 启动前必须先重跑测试**。如果 Round 1 接受了 Minor 修改但没跑测试就送 Round 2，Round 2 一定会发现这种 regex 失配（视为 P0），增加来回成本。

**反例（2026-05-13）**：
- 启动更新检测功能 Round 1 PASS（含 Minor #2「合并 import」建议）
- 我合并了 `import { UpdateToast, useStartupUpdateCheck } from './update'` + `import { useUpdateToastProps } from './update/store'` 为单行
- **未重跑测试**就送 Round 2
- Round 2 标 P0：`tests/App/AppUpdateToast.test.tsx` 的 import 正则 `\{\s*UpdateToast\s*,\s*useStartupUpdateCheck\s*\}` 不再匹配新的 `{UpdateToast, useStartupUpdateCheck, useUpdateToastProps}`
- 修复：放宽正则为 `\{[^}]*\bUpdateToast\b[^}]*\buseStartupUpdateCheck\b[^}]*\}`

## DOM API 陷阱

### `element.scrollIntoView()` 会沿祖先链冒泡，可能滚动到外层容器

`element.scrollIntoView({ block: 'start' })` 不是"只滚动最近的 overflow 父元素"。它会**遍历所有可滚动祖先**，让每一层都尝试把目标元素对齐到该层的视口边缘。即使祖先元素的 `overflow` 是默认值（visible），但只要内容超过 viewport，浏览器仍可能滚动 document。

**典型坑（2026-05-13）**：内嵌组件用 `scrollIntoView` 恢复滚动位置时，**整个 ChatPanel / 外层 wrapper / document body 也被推上**，目标容器外的内容失踪、底部出现空白。

**规则**：在需要"仅滚动当前容器自己"的场景，不要用 `scrollIntoView`。改用**手动算 scrollTop 差值并直接赋值**：

```ts
// ✓ 推荐：精确控制容器自身 scrollTop，零冒泡
const containerRect = container.getBoundingClientRect();
const elRect = el.getBoundingClientRect();
container.scrollTop += elRect.top - containerRect.top;

// ✗ 错误：会让 container 的所有可滚动祖先也滚动
el.scrollIntoView({ block: 'start' });
```

`scrollIntoView` 仍可用于"全文档跳转到某锚点"（如导航 ToC 跳转），那种场景**就是**希望整页面滚动。

### 防回退断言：替换 scrollIntoView 后必须显式断言它未被调用

scrollIntoView 在 jsdom 中**默认是 undefined**（jsdom 不实现），所以：

- 代码即使误回退到 `el.scrollIntoView()` 也会静默 noop（不抛错），单测不会失败
- 用 scrollTop 主路径断言不足以防止未来误回退

**规则**：在测试"手动 scrollTop"主路径时，**必须同时显式断言 scrollIntoView 未被调用**：

```ts
const spy = vi.fn();
el.scrollIntoView = spy;  // 在 jsdom 中赋值即可，因为原本是 undefined
// ... 触发 hook ...
expect(container.scrollTop).toBe(50);
expect(spy).not.toHaveBeenCalled();  // ← 防回退关键断言
```

否则未来某个 contributor "顺手" 把代码改回 scrollIntoView 时，测试静默通过，bug 重现。

**反例（2026-05-13）**：useScrollAnchorRestore 改用手动 scrollTop 后，初版测试只断言 `expect(container.scrollTop).toBe(50)`。code-review 第二轮指出"jsdom 中 scrollIntoView 是 undefined，误回退 noop 不报错"——补加 `expect(scrollIntoViewSpy).not.toHaveBeenCalled()` 后才形成完整防护。

## 门禁 ESLint 只覆盖 `src/`；`tests/` 不被 lint

`package.json` 的 `lint` / `lint:strict` / `lint:fix` 都是 `eslint src --ext .ts,.tsx [...]`，**只 lint `src/`**；`scripts/test-all.ps1` 第 4 步跑的也是 `pnpm lint`（src）。因此：

- **测试文件（`tests/`）不在门禁 lint 范围**。test 文件里用 `__dirname`、宽松断言等不会触发门禁 ESLint（既有 `tests/App/*.test.tsx` 用 `__dirname` 读源码正因如此）。
- **别被 `npx eslint tests/xxx` 的报错误导**：那是手搓了门禁不会跑的命令，其 `no-undef`（如 `__dirname`）等告警**不等于门禁失败**。判断"lint 过不过"以 `pnpm lint:strict`（src）为准。

## 静态扫描测试读源码：vitest 下用 `__dirname`，不要用 `import.meta.url`

vitest 里 `import.meta.url` **不是标准 `file://` scheme**，`fileURLToPath(new URL('...', import.meta.url))` 会抛 `TypeError: The URL must be of scheme file` → 整个测试文件加载失败（0 用例）。读源码做静态扫描契约测试，统一用 CommonJS 风格（与 `AppUpdateToast.test.tsx` 一致）：

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const SOURCE = readFileSync(resolve(__dirname, '../../src/Xxx.tsx'), 'utf-8');
```

`__dirname` 在 vitest Node 运行时可用；且 `tests/` 不被门禁 lint，no-undef 不影响门禁。

## 静态扫描断言要"块内有界"：`[\s\S]*?` 跨段惰性匹配会被下游同名 token 误满足

静态扫描断言"某 catch / 分支块内部存在 `return;` / `setX(...)`"时，**禁止用 `[\s\S]*?return;` 这种跨整段、无边界的惰性匹配** —— 它会一路吞到文件里**任意一个**下游 `return;`（如 `if (!config) { ...; return; }`），导致即使把目标块自己的 `return;` 删了，断言仍被下游无关 `return;` 满足 → **恒 PASS，防不住它声称要防的回归（假测试）**。

**规则**：断言"某块内部"时，用 `[^}]` 把匹配**限制在块边界内**（`[^}]` 不跨过 `}`），并锚定到该块**专属**的标识（如专属错误文案），而非泛匹配：

```ts
// ❌ 无边界：[\s\S]*?return; 会 latch 到下游任意 return，删掉本块 return 仍 PASS
expect(SRC).toMatch(/invoke\('biometric_authenticate'[\s\S]*?catch[\s\S]*?return;/);

// ✅ 块内有界：[^}] 不跨出 catch 块；锚定专属文案；删掉本块 return → 块内无 return → FAIL
expect(SRC).toMatch(/catch\s*\{[^}]*setError\('需要 Touch ID 验证才能打开 VPN'\)[^}]*return;[^}]*\}/);
```

**写完必做变异验证**（确认断言真能 FAIL）：用 node 把目标 token 删掉跑一次正则，必须从 true 变 false：

```bash
node -e "const s=require('fs').readFileSync('src/.../X.tsx','utf-8');
const re=/.../; console.log('原:',re.test(s),'删后:',re.test(s.replace(/...return;/,'')));"
# 期望：原 true、删后 false
```

**CRLF 源文件的变异要按行删除**：被扫描的目标文件可能是 CRLF 行尾（如 `src-tauri/src/lib.rs`），用 `s.replace('...token...\n', '')` 这类含 `\n` 的字符串替换会因行尾实为 `\r\n` 而静默不命中 → 变异"没删掉"却误判断言恒真/恒假。对 CRLF 文件做变异时改为按行操作：`s.split(/\r?\n/).filter(l => !l.includes('token')).join('\n')` 删掉目标行再跑正则；断言正则本身也应容忍 `\r`（用 `\s` 而非字面 `\n`）。（2026-07-14 审核层对 logout-closes-child-windows.test.ts 做独立变异验证时发现）

### 不变量口径写"禁裸写死"，不是"禁出现该数字"；且要在【剥掉注释的代码】上判

给"日志 / URL 不得写死端口（真值在 Rust 侧解析）"这类不变量写静态契约测试时，把断言写成"文件内不得出现 `1919x`"是**错的口径** —— 它会把**带限定语的准确注释**（如 `default 19198, resolved from the Rust side`）一并判违规，逼着后来的人**删掉正确的文档**才能过门禁。

**正确口径**：`端口字面量只允许带限定语出现（裸写死即违规）`。禁的是"把数字当真值用"，不是数字本身。

两个配套细节，缺一就是假 FAIL / 假 PASS：

1. **计数与块内断言必须在剥掉注释的代码上做**。注释里正当地写出 `invoke('hg_local_control_port')`（在解释兜底何时生效）会被算进调用点计数 → 1 变 2 → 明明只有一个调用点却 FAIL。收紧成"必须带 `invoke(` 前缀"也救不了：注释里那句连 `invoke(` 一起写全了。
2. **剥注释别用朴素 `//.*$`**。模板串 `` `http://127.0.0.1:${port}` `` 里的 `//` 会被当成行注释起点，把 `${port}` 和右括号一起吃掉，反而制造假 FAIL。要逐行判断 `//` 是否在字符串外，并用 `inBlock` 标志跟踪 `/* … */` 跨行块。

现成参考实现：[tests/huanvaeguard-port-resolution.test.ts](../../tests/huanvaeguard-port-resolution.test.ts)（`stripComments` + 端口字面量形状 + 限定语白名单，文件头注释逐条写了"这条断言为什么必须这么写"）。它也如实标注了残余缺口：**行内限定语判定拦不住"裸写字面量 + 行尾补个限定语注释"的绕法** —— 静态契约测试要写清自己防不住什么，别让读者以为它是全覆盖。

仍按本节前述规则做 **node 变异验证**：把某处限定语删成裸字面量，断言必须从 PASS 翻 FAIL。

**反例（2026-06-06）**：HuanvaeGuardConnectBiometric.test.tsx 初版用 `invoke('biometric_authenticate')[\s\S]*?catch[\s\S]*?return;` 断言"门禁失败即 return 中止"。code-review + 盲审都抓到：第二段 `[\s\S]*?return;` 会吞到下游 `if(!config.private_key){...return;}` 的 return，删掉 biometric catch 自己的 return 后仍 PASS → 对它唯一宣称要防的"catch 不 return"零防御。改成 `catch\s*\{[^}]*setError('专属文案')[^}]*return;[^}]*\}`（块内有界）后做 node 变异验证：原 true、删 return 后 false，确认有效。

**反例（2026-06-04）**：给 App.tsx 写静态扫描测试时，子 Agent 谎称 `__dirname` 触发 lint:strict no-undef、擅自改成 `import.meta.url` → vitest 加载即抛错、3 用例全挂；另一 Agent 跑 `npx eslint tests/...`（门禁不跑的命令）报 FAIL 误导。核实 `lint:strict`=`eslint src`（不碰 tests/）+ 既有测试用 `__dirname` 后改回，test 3/3 + 门禁双过。教训：① 门禁 lint 范围 = `src/`；② vitest 静态扫描读文件用 `__dirname` 不用 `import.meta.url`；③ Agent 报 lint 错先核实是不是门禁命令（见 common.md「Agent 改动必须做反向验证」）。

## mock context hook 的返回值必须引用稳定（每次 render 返回新对象会虚假触发依赖 effect）

### `useXxx: () => ({ ... })` 形式的 mock 每次调用都造新对象/新 vi.fn()，下游依赖数组必然抖动

典型错误：`vi.mock('.../SessionContext', () => ({ useSession: () => ({ session: {...}, clearSession: vi.fn() }) }))` —— 每次 render `useSession()` 返回新字面量、`clearSession` 是新 vi.fn()。被测组件里任何把该返回值（或其字段/回调）放进 useEffect/useCallback 依赖数组的逻辑，每次 render 都会重跑——真实 Context 的 value 是引用稳定的，mock 却不稳定 = 测的不是真实行为。表现为**与被测目标无关的 effect 被虚假触发**，用例"莫名失败"，或更糟——"碰巧通过"（假绿）。

**规则**：mock hook 的返回值用 `vi.hoisted` 稳定单例，对齐真实 Context 的引用稳定性：

```ts
const sessionMock = vi.hoisted(() => ({
  session: { accessToken: 't', userId: 1 },
  clearSession: vi.fn(),
}));
vi.mock('.../SessionContext', () => ({ useSession: () => sessionMock }));
```

**反例（2026-07-16）**：tests/unit/wsLivenessWatchdog.test.ts 首版 useSession mock 每次 render 返回新对象 → WebSocketContext 的 token 热切换 effect（依赖 session 引用）被虚假触发 → isSwappingRef 卡 true 吞 onclose、多建假 WS 实例，6 用例中 2 失败、另 2 "碰巧通过"；改 vi.hoisted 稳定单例后 6/6 过且全部走真实路径。⚠️ 既有 tests/unit/webSocketMarkReadChain.test.ts 等仍沿用"每 render 新对象"模式（同雷未爆），后续触雷按本条修。
> 注（2026-07-22 WS 闪断修复）：例中的「token 热切换 effect / isSwappingRef」已随 make-before-break 热切换一并**删除**（见 WebSocketContext.tsx，token 刷新不再重建主连）——该具体自毁 effect 不复存在，但本条通用规则（mock hook 返回值必须引用稳定，否则虚假触发**任何**依赖 session 引用的 effect）依旧成立，稳定单例仍是正解。

## AnimatePresence 内组件的"消失"断言必须入 waitFor（退场卸载异步，同步断言在全量高负载下抢跑翻红）

### `await waitFor(() => 另一元素出现)` 之后**同步**断言"表单已消失"，是竞态假红

framer-motion `<AnimatePresence>` 的退场卸载是**异步**完成的——即便 `MotionGlobalConfig.skipAnimations = true` 让动画瞬时，被 `exit` 包裹的子树卸载仍走 React 的异步流程（下一 microtask/帧）。因此交互后"另一个元素出现"（如 SUT 成功后 `setSecretInfo(...)` 渲染 SecretDisplay）**不保证**同批 `setShowCreate(false)` 触发的 AnimatePresence 子树已卸载完毕。

单文件 / 低负载下 CPU 空闲，卸载几乎立即完成，断言碰巧过；**全量 `pnpm test:run` 高并发负载下**卸载滞后于断言 → `expect(queryByText(...)).not.toBeInTheDocument()` 抢跑翻红。表现为"单文件跑绿、全量偶红"的 flaky，且会持续拖垮共享工作树上所有并行 worker 的门禁。

**规则**：凡断言"某元素在交互后消失/卸载"，且该元素在 `<AnimatePresence>`（或任何异步卸载路径）内，**消失断言必须放进 `waitFor` 回调**，不能在 `await waitFor(出现)` 之后同步断言消失：

```tsx
// ❌ 竞态：waitFor 只等"出现"，消失是同步断言 → 高负载抢跑
await waitFor(() => expect(screen.getByText('客户端凭据')).toBeInTheDocument());
expect(screen.queryByText('创建 OAuth 客户端')).not.toBeInTheDocument(); // 抢跑翻红

// ✅ 消失断言入 waitFor（可与出现断言并入同一回调）
await waitFor(() => {
  expect(screen.getByText('客户端凭据')).toBeInTheDocument();
  expect(screen.queryByText('创建 OAuth 客户端')).not.toBeInTheDocument();
});
```

修复后**全量至少连跑 2 次**确认稳定（flaky 是概率性，单次全绿不足以证明修好）。

**反例（2026-07-17）**：`tests/components/OAuthClientsPanel.test.tsx:189` 用例"创建成功：关闭表单并以 SecretDisplay 展示 client_secret"，在 `await waitFor(SecretDisplay 出现)` 后同步断言 `queryByText('创建 OAuth 客户端').not.toBeInTheDocument()`。SUT `src/components/oauth/OAuthClientsPanel.tsx:389-397` 创建表单包在 `<AnimatePresence>` 内，`handleCreate` 成功（:307-313）同批 `setShowCreate(false)`+`setSecretInfo(result)`——SecretDisplay 出现不保证表单已卸载。全量 `pnpm test:run` 3 跑 2 红（run1/run3 同一用例，报错 `found <h3 class="oauth-create-title">创建 OAuth 客户端</h3>`），单文件跑绿。非产品 bug（`setShowCreate(false)` 确已调用），是测试竞态；修复=:189 断言移入 waitFor。（③补测前端批3 review 打回 V-1，org-review-1784277277 实测 2026-07-17）

## 滚动 / 布局相关行为：vitest **结构性**测不出，必须真机验

### jsdom 没有布局引擎 ⇒ `scrollHeight` / `clientHeight` / `getBoundingClientRect()` 恒 0

这跟「动画冲突 vitest 测不出（`MotionGlobalConfig.skipAnimations = true`）」是**同族**的结构性盲区，
但更隐蔽：动画那条至少还有 [tests/animation-conflict.test.ts](../../tests/animation-conflict.test.ts)
这种静态扫描能兜底，而**滚动补偿类逻辑在单测里根本没有可观测行为** ——
所有基于「内容高度变化了多少」的判断在 jsdom 里恒等于 0，代码怎么写测试都绿。

**判断口径（任一命中即属"滚动/布局类"，vitest 绿不算数）**：

- 读 `scrollHeight` / `clientHeight` / `scrollTop` / `offsetHeight` 做**算术**（差值、比例、补偿量）
- `getBoundingClientRect()` 参与判断（位置对齐、可视性、是否贴边）
- 依赖 `column-reverse` / `overflow-anchor` 等**由浏览器决定**的滚动锚定行为
- 在 DOM 变更**前后**比较尺寸来决定滚到哪（prepend 保位、跳版补偿）
- 依赖「React 提交 + 浏览器绘制」时序的滚动（`await setState` 之后立刻滚 = 滚在旧 DOM 上）

**这类改动的验证要求**：

1. 单测只能守住**触发时机**与**调用契约**（"该调的调了、不该调的没调"），
   例如「离底超阈值才浮出按钮」「绝不调用 `scrollIntoView`」——这些不依赖真实布局，仍要写。
2. **数值正确性必须真机复核**：走远程 Android 构建宿主 + KVM 模拟器 + `adb` 取图那条路径
   （连接信息见工作区内部记录，不写在本仓）。交付里要写明「哪一半靠单测、哪一半靠真机」。
3. 代码注释里**显式写下这条盲区**，免得后人看到全绿以为覆盖到了。

### 反例（2026-08-11，一次任务里连炸两个，全部单测/lint/两个 subagent 门禁均未拦住）

「查找→定位窗口化 + 一键回到最底部」这单，vitest **2930 全过**、`eslint --max-warnings 0` rc=0、
两个 subagent 各自门禁全绿、连我自己给护栏做的**变异验证**也全绿 —— 真机一拍立刻炸两个：

1. **点「回到最新」只重载数据不滚容器** —— 画面从第 241 条停在第 351 条，最新是第 400 条。
   成因：组件设计成「传了 `onJumpToLatest` 就只调回调、自己不滚」，而该回调是**异步重载**。
2. **窗口态下同一动作停在半路**（第 375–382 条）。⚠️ 这个还**归因错了一轮** ——
   先判定是 prepend 保位 `useLayoutEffect` 把整段替换误判成"底部长出内容"，改完重建 APK 复验
   **症状一模一样**；真因是时序：`await` 只等到 `setState` 被调用、React 尚未提交，滚的是**旧 DOM**，
   且 `behavior:'smooth'` 的动画会被紧随其后的内容替换**打断**。
   改法 = 有重载时等两帧（双 rAF）再滚，且该路径用**瞬时**滚。

两个 bug 的共同点：**它们的失败形态在 jsdom 里没有任何可观测量**。

## 真后端 e2e（real-e2e，L2.5-web）—— `pnpm check` 之外的跨实例门

`pnpm check`（= `pnpm typecheck && pnpm lint && pnpm test:run`）是 **L1/L2 快门**：vitest 是 jsdom + mock invoke，测不到真 HTTP/WS 帧与跨实例广播（真 webview/真 TLS 更测不到，见本文件顶部"所有 X 必经 Y"节）。**这一层保持不变**。涉及跨实例语义的改动，另过真后端 e2e 门。

### 门 = `pnpm e2e:real`（需本地 e2e 集群在位）

`pnpm e2e:real`（= `playwright test --config playwright.real-e2e.config.ts`）跑 `real-e2e` project：两个 browser context 各指向钉不同后端实例的 vite origin（`http://127.0.0.1:18801` / `18802`，config 自起双 vite dev），驱动真 React 逻辑 → 真 HTTP/WS 帧 → 真双实例后端（经前置 nginx）。集群（双后端实例 A/B + nginx + PG/Redis/MinIO）由**后端侧 e2e 集群脚本**起，App 的 `e2e:real` 是其**前端腿**。

**产出层级 = e2e(L2.5-web)**：真前端 + 真跨实例后端；**无 Tauri 壳、无 secure_net TLS 面、本地 sqlite = 内存桩**。交付层级只能写 `e2e(L2.5-web)`，**禁写"L3 真机通过"**（完整 Tauri 壳 + 生产 TLS 属独立真机终验层，不在本门）。

运行需注入 `E2E_PG_URL`（flow10/stocks 经它种子后端 PG）。**PUBLIC 仓红线**：库连接串 / e2e 账号一律运行时 env 注入，**绝不硬编码进 spec / config / 任何提交物**。

### 触发面：改这些必跑 `pnpm e2e:real`（或声明豁免）

| 触发面 | 为何单实例 mock 测不到 |
|--------|----------------------|
| `src/api/**` | 后端契约消费端；字段 / 端点漂移需真帧验（jsdom mock invoke 测不到） |
| `src/services/secureFetch.ts` | HTTP 出口（e2e 桥的原生 fetch 分支在此） |
| `src/services/rustWebSocket.ts` | WS 出口（e2e 桥的原生 WebSocket 分支在此） |
| `src/services/syncService.ts` | 消息同步（read_sync / 会话快照的跨实例语义） |
| `src/services/discovery.ts` | serverUrl / 直连解析（`resolveForSecureHttp` 的 e2e 短路在此） |
| `src/contexts/**` | WebSocketContext / SessionContext 真链路 provider（WS 连接、token 广播） |

改动触及任一 → 交付前跑 `pnpm e2e:real` 并标注结果（层级 + 通过数 / fail_list），或声明豁免（**仅监督者/huanwei 可批**）。

**集群不可用 = 失败非 skip**：`e2e:real` 探测不到集群（18801/18802 不通）视为失败，绝不"环境缺失所以跳过"。真实的外部依赖缺失走**显式可见**的 ENV-FAIL 上报 + 监督者豁免，禁 PASS 形态静默跳过（假测试红线；对齐后端 gate 的 `verdict` 语义）。

### 与存量 GitHub CI 的隔离（红线，勿破坏）

存量 `.github/workflows/test.yml` 的 `e2e-tests` job 裸跑 `pnpm test:e2e`（= `playwright test`，主 config），公开仓 CI runner **无本地集群**（18801 不可达）。real-e2e **必须与它物理隔离**：走独立 `playwright.real-e2e.config.ts`（`testDir ./e2e-real`）；主 `playwright.config.ts` 的 projects **只含 `chromium` + `animation-health`**，不含 `real-e2e`。
- **别**把 `real-e2e` project 加进主 `playwright.config.ts`（会被存量 CI 裸跑 → 18801 不可达 → 公开仓 CI 必红）。
- **别**改 `test:e2e` 脚本使其扫到 `e2e-real/`；`e2e:real` 与 `test:e2e` 是两条不相交的路径。
- 改 playwright 配置后自检：`playwright test --list`（主 config）grep `real|e2e-real` 必须 NONE。

### 运行产物 gitignore（2026-08-13 已补）

`e2e:real` 生成 `e2e-real/test-results/`、`playwright-report-real/`。`.gitignore` 已补上这两行
（此前只有 `e2e/test-results/` 与 `playwright-report/`，都不匹配它们）。
仍然用显式 `git add <file>`（非 `-A`）避免误纳运行产物。
⚠️ 补 ignore 之前已经被 track 的两个文件另需 `git rm --cached` —— 见本文件末尾同名一节。

## 🔴 `dist/` 是 minified 产物：用**标识符** grep 判「这段代码在不在包里」结构上无效

这是继「动画冲突 vitest 测不出」「滚动 / 布局 vitest 测不出」之后的**第三个结构性盲区**，
但它骗人的方式不同：前两个是**测不到**，这个是**测得到一个恒假的答案**。

**机制**：`vite build` 的 minify **只改标识符名，不改字符串字面量**。
所以 `grep -c <函数名> dist/` 对**任何**函数都恒 0 —— 与那段代码在不在包里**完全无关**。

**判决性反证（2026-08-13 本仓实测）**：`calculateDisplaySize` 是早就存在、必然被打进包的老函数，
`grep dist/` 同样 **0 命中**。⇒ 「0 命中」不构成任何结论。
（当时用的正对照是字符串字面量 `video-play-overlay` = 2，**与被测对象不同类**，
所以它验不到 minify 改名这一类失效 —— 见 [common.md](common.md)「正对照必须与被测对象**同类**」一节。）

### 有效判据只有两条

**① 标记物注入 A/B（同类 + 因果直连，最强）**

往**被测的那个源文件**里插一个**字符串字面量**标记物（minify 不改名），并且**挂在活对象上**
（挂在死代码里会被 tree-shake 掉，等于没插）：

```ts
// src/utils/mediaDimensions.ts —— 插进真正会执行的分支里
const _fwmark = 'FWMARK_2026_08_13';   // 字面量：与被测同类；挂活对象：不被 tree-shake
```

| 组 | 动作 | `dist/` 里标记物命中 |
|---|---|---|
| A | 注入标记物后 `pnpm build`（rc=0 / 82s） | **1** |
| B | 还原后重新 `pnpm build`（rc=0 / 99s） | **0** |
| 同类正对照 | 该文件之前就有的字面量 `video-play-overlay` | **2** |

⇒ **单变量 A/B**：只改被测文件里的一个字面量，`dist` 就跟着变
⇒ 坐实 `dist` 确由**当前工作树的 src** 产出。

🔴 **标记物必须零残留**：还原后 `git diff <该文件>` 必须是 **0 行**，且全仓（`src/` + `dist/`）
再 grep 标记物必须 **0 命中** —— 这两条都要实跑并落证，否则等于往仓里丢了一个隐形字符串。

**② mtime 定序（弱判据，只能当旁证）**

`dist/` 各产物的 mtime 必须**晚于**被测源文件的 mtime，且那次 build 是在当前工作树上 `rc=0`。
它证明不了"这一段"在不在包里，只能证明"这次构建吃的是当前的 src"。**别单独用它下结论。**

## 🔴 真机终验必须写清「**该看哪一帧**」—— 并排看两张静态图，结构性差异照样漏

「三条腿机器证据（typecheck / lint / vitest）都成立」**不等于**「行为同形」。
2026-08-13 本仓实测：三条腿全过的前提下，review 仍挖出**两条结构性差异**，
而它们**都不是"看一眼像素"能发现的**，是**知道该看哪一帧**的问题：

| 差异 | 位置 | 只有在这一帧可见 |
|---|---|---|
| pending 期 `return null` ⇒ 媒体区短暂空白 | `src/chat/shared/VideoThumbnail.tsx` `status === 'pending'` 分支 | **上传完成切换的那一帧** |
| 尺寸探测 fire-and-forget ⇒ 完成时跳版 | `src/stores/composerTrayStore.ts` 的在途占位补探 | **粘贴后不等缩略图就回车、再到完成的那一帧** |

⇒ **写真机终验步骤时，每一条都必须落到「用什么素材 + 在哪一帧看 + 看什么变化」**，
而不是「打开看看对不对」。上面两条对应的可执行动作是：

1. 用一段 **50 MB+ 视频**，**录屏**（不是截图）看「上传完成那一帧」有没有闪空；
2. 粘贴一张大图后**立刻回车**（**不等**缩略图出来），看完成时会不会跳版。

**并排看两张静态图，这两条都会漏掉** —— 静态图取的是稳态，而这两条差异只存在于**过渡帧**。

### 上面两条已于 2026-08-13 处理（原「已知遗留」就地改写，别再当未修项引用）

- **`VideoThumbnail` pending 空白帧** —— 已改：`status === 'pending'` 不再 `return null`，
  改为渲染一个**同尺寸空占位**（同一个 `className` + `width/height: 100%` 行内样式，
  后者是给 FilesModal / MobileFilesPage 这类**不传 className**、靠 `video` / `img`
  元素选择器定尺寸的调用点兜的）。
  ⚠️ 它保证的是**盒子**同形，**不保证像素连续** —— 这几毫秒画面仍是容器底色。
  要让画面也连续就得在 pending 期建媒体元素，而那正是该组件刻意消灭的成本
  （一屏几十个格子各拉一次元数据）。**「还闪不闪」仍然只能靠真机录屏**，三条腿覆盖不到。
- **秒传命中的极小文件** —— 已**收窄**，但**没有清零**：`utils/mediaDimensions` 现在按 `File`
  记忆结果（`WeakMap` + 在飞 promise 复用），并新增**同步**读口 `peekMediaDimensions`；
  `sendingMediaStore.enqueue` 用它在入队那一帧同步把尺寸填对。
  ⇒ 修掉的是「**已经算出来的数字被丢掉**」（待发区探测 resolve 时那一项已被 `clear` 清掉 ⇒ 回写落空）。
  ⇒ **仍存在**的窗口只剩「待发区那次探测**根本还没 resolve**，而上传已经完成」这一种。
  **两代都不是新引入的**：修复前永远不回填 → 上一版几乎总会回填 → 本版把"算出来又丢掉"也堵上，
  **窗口只缩不增**。机器口径见 `tests/unit/mediaDimensionsMemo.test.ts`（含三次变异自证）。

### 那两个被 git 跟踪的运行产物 —— 已于 2026-08-13 处理完（原「已知遗留」就地改写）

曾经**已经在 index 里**（不是"将来别提交"）的两个文件：

- `e2e-real/test-results/.last-run.json`
- `playwright-report-real/index.html`

处置是**两件事，缺一不可**（补 ignore **不会**让已跟踪的文件消失）：

1. `.gitignore` 补 `e2e-real/test-results/` 与 `playwright-report-real/` 两行；
2. 对这两个文件跑 `git rm --cached` 停止跟踪。
   **App 是 PUBLIC 仓 —— 只做「停止跟踪 + 补 ignore」，不重写历史。**

现查判据（改后）：`git ls-files | grep -cE 'e2e-real/test-results|playwright-report-real'` = **0**，
**同类正对照** `git ls-files | grep -c '^e2e-real/'` = **8**（spec / helpers / README 仍然跟踪，
证明 grep 有效、那个 0 是真 0；改前该正对照是 9，差的就是被移出的那一个）。

## 🔴 CI 门禁与 e2e 的真断言（2026-08-19 起，`release.yml` 有一道会红的门）

在此之前，`release.yml` 从 tag 推上去到 R2 分发**一步测试都没有**（21 个 `run:` 步骤里
`pnpm test` / `test:run` / `test:e2e` / `typecheck` / `vitest` / `playwright` 计数**全 0**，
同一条 grep 在 `test.yml` 上会响 ⇒ 那些 0 是真 0）。于是「登录彻底坏掉」这种事
可以一路发到用户手上：实测把 `src/pages/Login.tsx` 的 `handleSubmit` 改成
「填了账号密码反而直接 return」（点「登陆」零反应 = 谁都登不进去），
`typecheck` / `lint:strict` / `test:run` / 当时的全量 e2e **四层退出码全 0**。

### 门的形状（改 workflow 前先看清，别把它绕过）

`release.yml` 的 `gate` job（`name: Quality Gate (typecheck / lint / unit / e2e)`）四步：
`pnpm typecheck` → `pnpm lint:strict` → `pnpm test:run` →
`npx playwright test --project=chromium --grep "@gate"`。

`build` 与 `build-android` 各 `needs: [gate]`；`generate-manifest` `needs: [build, build-android]`
⇒ **经传递依赖也在门后**。GitHub Actions 在上游 job 失败时把下游**整个 job 跳过**，
连它里面 `if: always()` 的步骤都不执行 ⇒ **门红即零产物、零分发**
（真跑实测：gate `failure` ⇒ build / build-android / generate-manifest **三个全部 skipped**，
artifacts `total_count = 0`，无新 release；下游 `apt-repo.yml` 因
`if: …workflow_run.conclusion == 'success'` 也 skipped）。

三条不许破坏的性质（写在 `release.yml:48` 起的块注释里）：
① `gate` job **不许**加 `continue-on-error` / `if: always()` / `|| true`；
② 所有会**产出或分发**的 job 必须直接或传递 `needs` 到 `gate`；
③ 新增会分发的 job 时**同批**把 `needs` 接上 —— 漏接不会有任何东西报错。

### `@gate` 标记：新写的功能性 e2e 必须打，否则它不在门里

门的选择器是 `--grep "@gate"`，匹配的是 **`test.describe(...)` 的标题**。
现有三处：`e2e/login-flow.spec.ts` 两个 describe + `e2e/settings.spec.ts` 一个。

- **新增功能性 e2e ⇒ 标题里加 `@gate`**，否则它跑得再好也挡不住任何发布。
- **标记全丢不会静默放行**：实测 `--grep` 一个不存在的标签 ⇒ `Error: No tests found` / **rc=1**；
  同刻正对照真 `@gate` ⇒ rc=0 / `Total: 5 tests in 2 files`。两侧形状不同 ⇒ 空集会响亮失败。

### 🔴 e2e 必须至少有一条「读真实请求体」的断言

**判决性实测**：e2e 的假后端对 `/api/auth/login` **无论请求体长什么样一律回 200 + token**。
把 `src/api/auth.ts` 请求体里的 `user_id:` 改名成 `userid:`（一个真实的契约破坏）后：

| 用例 | 结果 |
|---|---|
| 进主界面 | **照绿** |
| 凭据错误停留在登录页 | **照绿** |
| 登录后开设置面板 | **照绿** |
| `expect(payload.user_id).toBe('e2euser')`（`e2e/login-flow.spec.ts:95`） | **红** |

⇒ **断「mock 被调用过 / 界面到了下一屏」= 假测试；断「App 真发出去的字节」= 真测试。**
一套 e2e 里必须至少留一条读真实 payload 的断言，并在注释里标明
「本套唯一的凭据正确性哨兵，删它等于删掉这一类覆盖」。

配套的第二类哨兵（同样实测有效）：把端点路径改掉（`/api/auth/login` → `/api/auth/signin`）
会红 4 条 —— 那是钝变异，只当旁证；**精准度由 payload 那条承担。**

另外**桩注入本身**要有一条断言守着：`addInitScript` 里一个语法错就会让整段静默不执行，
所有 Tauri 调用变成 `Cannot read properties of undefined (reading 'invoke')`，
而**纯截图用例照样能过**（登录页本身还渲染得出来）。`login-flow.spec.ts` 第一条就是干这个的。

### 🔴 平台基线差异：本地绿 ≠ CI 绿（同一份代码、同一条命令）

`.gitignore:64-65` 排除 `*-chromium-win32.png` 与 `*-chromium-darwin.png`
⇒ **darwin 基线不入仓，本机首跑自动生成、其后恒绿**
（实测：同码首跑 19 passed / 12 failed，12/12 报文全是 `A snapshot doesn't exist … writing actual`；
第二跑 31 passed / 0 failed）。
而 `git ls-files e2e/snapshots/` 只有 **12 个 `-chromium-linux.png`**，**入仓且已过期**
⇒ **CI 的 ubuntu runner 上当前就是红的**（真跑：22 passed / 9 failed / 2 skipped，
9/9 是 `toHaveScreenshot` 像素比对，差异比 0.04–0.09 对阈值 0.01）。

⇒ **报 e2e 结果必须标平台**（"本地 darwin 全绿" / "CI ubuntu 9 条红"）；
**拿本地绿推 CI 绿是错的**，反之亦然。要重出 linux 基线得有 linux runner 跑
`--update-snapshots`，本机 darwin 且无容器运行时的话就是做不到 —— 如实写"做不到"，
**不许删用例 / 降阈值 / 加 `continue-on-error` 让它变绿**。

### 🔴 条件跳过会把真回归伪装成"跳过"

`e2e/visual-regression.spec.ts:96` / `:114` 的
`test.skip(true, 'register toggle button not found …')` 是活标本：
**注册按钮真的消失（= 真回归）时，它 skip 而不是 fail。**
「找不到元素就跳过」这类兜底**新写测试一律禁止** —— 找不到就应该红。
（上述两处属视觉那一摊，已点名登记、未改。）

### 顺带订正：「登录后页面 e2e 不可达」这句已过期

本文件上文与 `.claude/rules/animation.md` 都写过「登录后页面受 `@tauri-apps/plugin-http`
通道限制 e2e 不可达」。**现已不成立**：数据面早就改走 `invoke('secure_http')`，
`e2e/helpers/tauri-mock.ts` 补上 `secure_http` 分支后，e2e 能真的登录进主界面并打开设置面板
（`secure_http` 在该文件命中 10，同类正对照 `plugin:http` 命中 4 ⇒ grep 会响）。
成因详见 `.claude/rules/common.md`「审计结论『e2e 撞 `plugin:http` 502』已过期」一节。

### 改了 `src/**` 或 `tests/**` ⇒ 顺手把 `release.yml` 的 `@gate` 子集跑一遍

`pnpm check`（typecheck / lint:strict / test:run）**不含**这道门的第四步。
而 `release.yml` 的 `gate` job 是 **typecheck → lint:strict → test:run → `--grep "@gate"`**，
**门红即零产物零分发** ⇒ 只跑前三步，等于把「这个 tag 发不发得出去」留到推完 tag 才知道。

```bash
npx playwright test --project=chromium --grep "@gate"
```

**判据自证**：`--grep "@gate" --list` = `Total: 5 tests in 2 files`，
不带 `--grep` 的同一 project = `20 tests in 4 files` ⇒ 两侧形状不同，跑的确实是子集
（收窄口径见 `.claude/rules/common.md`「`--grep` / `--project` / 位置过滤器 也是一种**结构性跳过**」）。
**空集会响亮失败**（`--grep` 一个不存在的标签 → `Error: No tests found` / rc=1），不会静默放行。

⚠️ 它与 `.github/workflows/test.yml` 的 `e2e-tests` job **不是一回事**：后者跑**全量** e2e、
含 9 条**存量红**的视觉基线（基线停在 2026-05-11）⇒ 推 main 会红，红的是存量。
`@gate` 子集**不含**视觉比对，实测是绿的。**别拿其中一个的结论去推另一个。**

## 🔴 「只有一处 `import`」≠「只在那一处生效」 —— 判 CSS 有没有被加载，只查 `@import` 是不完整判据

**这条推翻过一整张任务卡的核心前提**，代价是整单方向差点做反。

单入口 + 全静态 `import` 的 SPA（本仓即是）里，**任何从入口静态可达的模块**里写的
`import './X.css'`，都会被打进**同一个入口包**，于是 **X.css 在每一个窗口都生效** ——
哪怕它"看起来"只属于某一个页面、哪怕全仓只有那一处 import 它。

**实测真值链**【2026-08-20 实测，删除前的 commit `b4040d9`；下面三个路径**现已不存在**，属带日期的历史记述】：

```
src/main.tsx:26  import { LowcodePage } from './lowcode';     ← 静态，非 lazy
  → src/lowcode/index.ts:50  export { default as LowcodePage } from './LowcodePage';
    → src/lowcode/LowcodePage.tsx:69  import './LowcodePage.css';
```

配套的**关键第二问**：`main.tsx` 里 lazy / 动态 `import()` 计数 = **0**，且它是**全部路由的唯一入口**
⇒ 没有任何一条路由能绕开这条链 ⇒ 该 CSS 进单一入口包。

⇒ 正确判据（三选一，按成本从低到高）：

| 判据 | 怎么做 | 边界 |
|---|---|---|
| **入口静态可达性**（首选，纯静态、可穷举） | 从 `src/main.tsx` 出发追 `import` 链，并数一次 `lazy(` / `import(` 的出现次数（必须为 0 才能下"全都进同一个包"的结论） | 有动态 import 时结论作废，要按 chunk 分别算 |
| **运行时** `style[data-vite-dev-id]` | vite dev 下 `document.querySelectorAll('style[data-vite-dev-id]')` 数命中 | ⚠️ **只对 `.tsx` 里直接 `import './X.css'` 的文件成立**；经 `index.css` 的 `@import` 引入的文件会被 vite **内联进同一个 style 标签**、**不产生独立 id** ⇒ 对它恒 0，属**错类判据** |
| **构建产物** `dist/` 里数选择器 | 见下面「CSS 选择器可以在 `dist/` 里 grep」一节 | 需要先 `pnpm build` |

🔴 **`git grep '@import'` 单独用是错的**：它只覆盖 CSS 侧的引用链，**完全看不见 JS 侧的 `import './X.css'`**。
本工作区正是只查了 `@import` 就得出「那份 CSS 只在某个窗口加载」，进而推出「那三处组件此刻没有样式」——
**两层结论全错**，而错的那一路上没有任何输出会报警。

## 🔴 「删全局 CSS / 样式搬家」类任务的验收结构：两层，**顺序不许颠倒**

**第一层（主防线，必须可穷举、可复算）= 类名交集**
　A = 被删的那份 CSS 里**定义**的全部类名
　B = **非该模块**的文件里**用到**的 className token
　A ∩ B 为空 ⇒ 删它不产生视觉回归，**这是可复算的强结论**；
　非空 ⇒ **逐个列出，每个给处置**（随组件搬走 / 抽进公共样式 / 论证够不着）。

**第二层（抽查）= 截图**：从交集里挑最典型的几处 + 已知调用点，改前改后对比。

🔴 **为什么是这个顺序**：**类名交集可穷举，截图不可穷举。**
把不可穷举的东西放主防线，等于把「我没看到问题」当成「没有问题」。
本工作区实测：交集里真正有风险的两个类（`.form-label` / `.status-dot`）
**一个都不在最初那三张截图里** —— 若不是先算交集，这一单会以「我看过 3 张图没问题」结案。

### 配套二次判据：交集里每个类是**裸选择器**还是**复合/后代选择器**

- 裸 `.foo { }`（整条选择器就是 `.foo` + 伪类）⇒ 命中**任何**带该 class 的元素 ⇒ 删了**有全局影响**，必须处置；
- 复合 / 后代 `.mod-x .foo { }` ⇒ 要命中必须先有该模块自己的祖先 / 兄弟类，
  而那些类随目录一起删了 ⇒ **结构上作用不到模块外**。

**实测量级**【2026-08-20】：交集 **21** 个里，裸的只有 **8** 个，其余 **13** 个够不着模块外
⇒ 这一刀把要人工论证的面**砍掉六成**，值得先算。

### 三条实操坑（都实撞过，各花掉一轮）

1. **提取器 over-capture**：在 `className=` 后按固定字符窗口扫字符串字面量，会把**后面别的属性**的值也算进来
   —— `role="dialog"` 被数成了 className，凭空多出一个"真回归"。⇒ 按**花括号配平**取 `className` 自己那一个值。
2. **修 over-capture 时改过头**：只认"引号包着的字面量"会让纯 `className="foo"` 一个 token 都取不到
   （B 从 2243 掉到 162）。**发现它靠的是正对照** —— 一个 100% 已知为真的样本变成了 False ⇒ **判据坏了，不是结论变了**。
   ⇒ 提取器必须区分「字面量值」与「表达式值（模板串 / 三元）」两种形态。
3. **搬家会改变交集**：组件从被删模块里**搬出去之后**，它自己的类名才变成「非该模块用到的类」
   ⇒ **交集要在搬家之后再算一次**。两次的差值应当**恰好等于**搬走的那批类名 —— 对不上就是有未解释的差异。

**判据自证**：正对照拿一个确知在被删 CSS 里裸定义的类（本仓 `.toolbar-btn`，`bare=4`）跑同一条提取器（会响）；
负对照拿**当场现编**的类名（不许沿用任何文档里的示范串）跑同一条（`bare=0`，不恒真）⇒ 两侧形状不同。

## 🔴 判「删掉某条 CSS 会不会改变计算值」，必须找到**真正的赢家规则** —— 只比加载顺序会得出对的结论、坏的推理

**结论对 ≠ 推理对。** 推理坏掉的代价是**下一次换个类就翻车**，而这一次它不会暴露。

**实撞**【2026-08-20】：给 `.form-label` 写豁免理由时写的是
「三条规则同特异度 (0,1,0)，被删那份**先加载**所以本来就输」。**两处都不成立**：

1. **加载顺序是反的** —— 被删那份在入口里排在竞争者**之后**求值，同特异度下它本该**赢**；
2. **真正的赢家是另一条更高特异度的规则** `.form-group label` **(0,1,1)**，
   它压过全部三条 (0,1,0)，且实测计算值与它的声明**逐字对上**。

**为什么结论仍然成立**：`.form-label` 的**全部 7 个使用者**无一例外都包在 `className="form-group"` 里
⇒ 被删那份声明的每个属性都被 (0,1,1) 盖住，删它**结构上**不可能改变计算值 —— **与加载顺序无关**。
⚠️ 而按原推理，换一个 `.form-label` **不在** `.form-group` 里的调用点，同样的话就会漏掉真回归。

⇒ **判据（四步，缺一步就退化成"比顺序"）**：

1. 穷举**所有**声明该属性的竞争规则（同一个类可能在同一份 CSS 里**出现多次且声明不同** ——
   本仓那次就漏了第二处 `.toolbar-btn.danger`）；
2. **逐属性**算特异度，**特异度优先于源序**；
3. 特异度打平才看源序（此时才需要确认加载顺序，而**入口里的 `import` 行号就是求值顺序**）；
4. 核**使用者是否恒处于某个祖先/兄弟类之下** —— 这一步决定了高特异度那条是不是**总是**赢。

**解矛盾优先于动手**：按上游给的理由推下去若与实测截图冲突，**停下来解矛盾**，别顺着推也别直接推翻结论
（对齐 `.claude/rules/common.md`「上游描述与实测冲突时，以实测为准 —— 先解矛盾，再动手」）。

## 🔴 CSS **选择器**可以在 `dist/` 里 grep —— 与「`dist/` 用**标识符** grep 无效」**不同类**

本文件已有一条「`dist/` 是 minified 产物：用**标识符** grep 判『这段代码在不在包里』结构上无效」。
**别把它推广成「`dist/` 一律不能 grep」** —— 那会让人放弃唯一一条能直接证明
「新样式真的进了发货产物」的判据。

**区别只有一条**：`vite build` 的 minify **改标识符名，不改 CSS 选择器**（选择器要与 DOM 对得上，改了就坏）。

**同一次实测，两类查法一个会响一个恒 0**【2026-08-20，同一个 `dist/`】：

| 查什么 | 命令 | 命中 |
|---|---|---|
| CSS 选择器 `delete-confirm-actions .toolbar-btn` | `grep -o -F … dist/assets/*.css \| wc -l` | **9** |
| CSS 选择器 `.delete-confirm-overlay` | 同上 | **1** |
| CSS 选择器 `.form-label` | 同上 | **3** |
| **负对照**：现编选择器 `.u7q-nope-selector-3391` | 同上 | **0** |
| **TS 标识符** `calculateDisplaySize`（确知存在的老函数） | `grep -o -F … dist/assets/*.js \| wc -l` | **0** |
| **TS 标识符** `resolveDisplayUrl`（同上） | 同上 | **0** |

⇒ 同一个产物目录：选择器侧会响也会静（9/1/3 vs 0），标识符侧**对确知存在的东西也恒 0**
⇒ **两类判据形状不同，区分力明确**。

**用途（这才是它值钱的地方）**：「样式搬家 / 新建 CSS」类任务里，
`style[data-vite-dev-id]` 那条 A/B **只能证明旧源没了**，
证不了「新文件在承担」（经 `@import` 引入的文件在 dev 下被内联、探针看不见它，属错类判据）。
**`dist/` 数选择器是唯一直接的正面证据** ⇒ 把它固化进这类任务的验收口径：
新选择器命中数 == 新文件里的规则条数（逐条对上），旧模块的私有类在 CSS+JS 产物里**全 0**。

## 🔴 视觉回归门禁：2026-08-21 基线重置 + 权威平台判定（本节更新上文「平台基线差异」一节的处方）

> **本节是 EOF 追加**，不改上文任何一行 —— 上文「🔴 平台基线差异：本地绿 ≠ CI 绿」那节记录的**现象**仍然成立，
> 但它给的处方（"本机 darwin 且无容器运行时就是做不到 —— 如实写做不到"）**已被本次实测推翻**：
> 远程 linux 宿主这条路是通的，见下面「三态可达性」。

### 一、写死的空白区间声明（这句不能省）

> **视觉基线于 2026-08-21 重置。此前自 2026-05-11（`7fcf340`）起、约 164 个 `src/` commit 期间的视觉回归，
> 本门禁【未覆盖且不可追溯】。**

**空白区间两向都不可推**：既不能推「那段没有回归」，也不能推「那段有回归」。
不把它写下来，空白会被默认读成「没问题」—— 而 2026-05-11 → 2026-08-21 这三个月里，
CI 那一侧的 e2e 每一次都是红的、没有人拿它当过判据。

### 二、门禁的新形状：权威平台 = linux，其余平台**显式跳过**

真值源 [e2e/helpers/visual-authority.ts](../../e2e/helpers/visual-authority.ts)：

- 判据是 **`process.platform === 'linux'`**，理由是**入仓基线只有 linux 一套**
  （`git ls-files e2e/snapshots` 列出的全是 `-chromium-linux.png`，张数不写死、由守卫现算；`.gitignore` 排除 darwin/win32）。
  用「有没有入仓基线」当判据，而不是 `process.env.CI` —— 后者与「基线到底存不存在」脱钩，换个 runner OS 就静默失真。
- 非 linux 平台上，截图断言**一律 skipped 并打印一行原因**，**不再产出绿色 pass 数字**（2026-08-21 现为 8 条；数字会随断言增删变化，以 `git grep -o toHaveScreenshot -- 'e2e/*.ts' | wc -l` 现查为准）。
  改前那个「绿」是空绿：本机首跑写一张 `-chromium-darwin.png`（该条 failed），第二跑起比对的是
  **这台机器自己刚写的那张** ⇒ 结构上不可能失败。
- 逃生阀 `E2E_VISUAL_FORCE=1` **只把结论推向「跑」，永远推不向「跳过」**（linux 分支先返回，且分支内无 `run:false` 出口）。
  它比的是本机自产基线，**结果不具权威性**，只供本地看 diff 用。
- [e2e/visual-authority.spec.ts](../../e2e/visual-authority.spec.ts) 用真值表把上一条钉死，
  另加两条覆盖面守卫：**每条 `toHaveScreenshot` 必须有对应的 linux 基线**（缺一张 ⇒ CI 那条从此恒红）、
  **不许有孤儿基线**。两条都做过变异自证（加一条无基线的断言 / 造一张孤儿 png，各自精准只红对应那一条）。

**验收形状（darwin 本机实测，`npx playwright test --project=chromium`）**：`8 skipped` + `13 passed`（2026-08-21 现跑），
两侧形状不同 ⇒ 不是整套被跳过。**报 e2e 结果必须标平台**这条纪律照旧。

### 三、三态可达性：本机 ✗ / 远程 linux 宿主 ✓ / CI ✗（push 受限）

| 态 | 结论 | 判据 |
|---|---|---|
| 本机 | **做不到** | darwin arm64；`command -v docker colima podman lima nerdctl vagrant qemu-system-x86_64 multipass utm` **8/8 无输出 rc=1** |
| 远程 linux 宿主 | **做得到（本次即由它产出）** | Ubuntu 24.04 x86_64（与 `runs-on: ubuntu-latest` 同发行版同架构）；node 22 tarball + `pnpm install` + `playwright install chromium` + `install-deps chromium`（新增 79 个 apt 包）全部 rc=0 |
| CI | 能跑但**本轮不可用** | 触发它需要 push，而子仓 push 是 huanwei 本人的红线 |

🔴 **「本机没有 X 所以做不到」下结论前必须先问远程宿主** —— 这条工作区通则在本单又验证一次：
上文那句「本机 darwin 且无容器运行时的话就是做不到」是**只问了本机**得出的。

### 四、远程 linux 宿主 ≈ GitHub runner 的**证据强度**（别写成「已证明等价」）

🔴 **2026-08-21 复核订正：原来写的「三条实测」经独立复算后剩下 1 条强的、1 条要改写、1 条作废。**
下面是订正后的版本（原三条的措辞已就地改掉，别再引用旧措辞）：

1. ✅ **【强证据·唯一一条】失败条数与差异比逐条重合**：本次在远程 linux 上拿**旧基线**跑，
   得 **9 failed / 5 passed / 0 skipped**，9 条差异比落在 **0.04 / 0.09** ——
   与上文记录的 CI 真跑（9 条红、比值 0.04–0.09）**同形**。
2. ❌ **【作废】**原第 2 条写「3 张 2026-05 由 GitHub runner 产出的基线在远程 linux 上今天仍在阈值内通过」，
   并把它当等价性证据。**复核实测那 3 张的真实差异是 1.66% / 3.80% / 10.91%**（阈值分别 0.02 / 0.15 / 0.15），
   其中 3.80% **与被判红的那 6 条同量级** ⇒ 它们"通过"是**阈值瞎**，不是渲染一致
   ⇒ **判别力 ≈ 0**，且与本文件第五节「阈值大到看不见一整个字段消失」自相矛盾。**该条不再作为支持证据。**
3. ⚠️ **【改写】重渲染：字节级【不可】复现，但在判定口径下完全一致。**
   原文写「连续两次 `--update-snapshots=all`，12 张里 11 张 md5 完全相同，仅 `auth-dark-theme` 一张不同
   （背景渐变 orb 的定格位置不同）」——**两处都不准**：
   ① 留档的两个 tarball 实际差 **4 张**，因为前者跑的是 **changed 模式**而不是 all 模式
   ⇒ 「连续两次 all」这个说法**从留存证据里复算不出来**；
   ② 那张的两次渲染差 **99.18% 的像素、最大单通道偏差 49** ——**不是"定格位置不同"，是整幅背景渐变整体偏移**。
   ⇒ 正确措辞是：**字节级不可复现，但在 Playwright 的判定口径下差异 = `0.000000`**。

⚠️ **剩下的这 1 条也只是「同形」，不是「同一台机器」** —— **最终确认仍需一次 CI 真跑**。
在那次 CI 结果出来之前，任何人不得声称「视觉门禁已经绿了」。

### 五、🔴 顺手挖出的两个**假覆盖**（本次未改，另立单）

1. **12 条断言只对应 6 张不同的【内容】**：`emulateMedia({colorScheme})` 对本 App **零效果**。
   🔴 **2026-08-21 订正：原文把「视觉相同」写成了「md5 相同」，这两件事必须分开写** ——
   - **字节层（md5）**：12 张按 md5 是 **7 组**，不是 6 组。原文说"五张 md5 完全相同"的那五张里，
     真正 md5 相同的只有 **4 张**（`auth-initial` / `visual-login-default` / `visual-login-light` /
     `visual-login-dark`）；`auth-dark-theme` **自成一组**（md5 与它们都不同）。
   - **判定层（Playwright 自己的比较器：pixelmatch, threshold 0.2）**：那 **5 张两两差异 = 0 个像素**，
     `auth-mobile` / `visual-login-mobile` / `visual-login-mobile-dark` **3 张也是 0 个像素**
     ⇒ **「6 张不同的内容」这个结论是对的**，错的只是把它说成 md5 分组。
   - ⇒ **`auth-dark-theme` 是「字节不同 ≠ 视觉不同」的现成反例**：它与 `auth-initial` 有真实的
     逐像素差异（背景渐变整体偏移），但每一个差异像素的 YIQ 加权差都在 `threshold 0.2` 之下 ⇒ 一个都不计数。
   ⇒ 「light/dark 主题视觉回归」这层覆盖**从来不存在**，它只是把同一张图存了几份。
   **处置见本文件后面「2026-08-21 续单」一节：那 4 条已删，并加了机器守卫防复发。**
2. **`visual-login-wide` 的阈值大到看不见一整个表单字段消失**：1920×1080 = 2,073,600 px，
   `maxDiffPixelRatio: 0.02` ⇒ 允许 41,472 px 不同。实测：登录页去掉「服务器地址」整行
   （`6a61f58` 的真实改动，卡片矮约 98px 并重新居中）**照样通过**。
   `visual-register-*` 用 **0.15** 更松。⇒ 这 3 条在旧基线上「通过」，**不是因为 UI 没变，是因为它看不见**。
   本次已把这 3 张一并重置（否则会把「因为瞎所以绿」当成绿收下）。
   **阈值该不该收紧另立单。** 🔴 **2026-08-21 订正**：原文写「收得太紧会被上面第三条那张 orb 抖动
   打成 flaky，**需要先量噪声**」——**噪声已经被量了**：同机重渲染在 Playwright 判定口径下 = **`0.000000`**
   （连那张字节不同的 `auth-dark-theme` 也是 0）⇒ **当前底噪为零**，"怕 flaky"的顾虑
   **至少在那台远程 linux 上不成立**。这条同时是阈值另立单的现成输入。

### 六、动手前必看的两条形态坑

- **`e2e/` 既不被 `pnpm typecheck` 也不被 `pnpm lint:strict` 覆盖**
  （`tsconfig.json` 的 `include` 只有 `["src", "tests"]`；lint 脚本是 `eslint src`）
  ⇒ e2e 侧的类型/语法错**只有真跑 playwright 才会暴露**。
- **`package.json` 是 `"type": "module"`** ⇒ e2e spec 里**没有 `__dirname`**。
  要拿路径用 `test.info().file` / `test.info().project.snapshotDir`，
  别照抄本文件上文那条给 **vitest** 的「用 `__dirname`」——两套 runner 的模块形态不同。
- **macOS 打包/拷贝会产出 AppleDouble `._xxx.png` 影子文件**，它同样以 `-chromium-linux.png` 结尾
  ⇒ 扫基线目录的守卫必须先跳过点开头的文件（实测在 linux 侧误报 9 个「孤儿基线」）。

## 🔴 视觉门禁续单（2026-08-21，R16b）：判别力声明 · 假覆盖处置 · e2e 纳入 typecheck/lint

> **本节同样是 EOF 追加**，不改上一节以外的任何一行。上一节（「2026-08-21 基线重置 + 权威平台判定」）
> 里被本轮复核推翻的 4 处读数**已就地订正**（各处带「2026-08-21 订正」字样），本节不重复它们。
>
> 🔴 **一句话终态：基线已在权威 linux 侧重置；CI 真跑未做，门禁状态未确认。**
> 全文不写「已修复 / 已绿 / 视觉这块齐了」——**修好基线 ≠ 这个门禁有判别力了，两层要分别验。**

### 一、🔴 判别力声明：每条截图断言「目前能看见多大的变化」

第一层失明是**面积**。Playwright 的 pass 条件是 `count <= expected.width * expected.height * maxDiffPixelRatio`
（真值源：`playwright-core@1.60.0/lib/coreBundle.js` 的 `compareImages`）。
下表的 `w×h` 取的是**基线 PNG 的 IHDR 实测值**，不是 spec 里写的视口 —— `fullPage: true` 时两者可能不同。

| spec | 截图 | 基线 w×h | 整幅像素 | 生效 ratio | **可容忍像素数** | ≈ 同面积正方形边长 | ratio 来源 |
|---|---|---|---|---|---|---|---|
| auth.spec.ts | `auth-initial.png` | 1280×720 | 921,600 | 0.01 | **9,216** | 96 px | per-call |
| auth.spec.ts | `auth-mobile.png` | 375×812 | 304,500 | 0.01 | **3,045** | 55 px | per-call |
| visual-regression.spec.ts | `visual-login-default.png` | 1280×720 | 921,600 | 0.02 | **18,432** | 136 px | `SCREENSHOT_OPTS` |
| visual-regression.spec.ts | `visual-login-mobile.png` | 375×812 | 304,500 | 0.02 | **6,090** | 78 px | `SCREENSHOT_OPTS` |
| visual-regression.spec.ts | `visual-login-tablet.png` | 768×1024 | 786,432 | 0.02 | **15,728** | 125 px | `SCREENSHOT_OPTS` |
| visual-regression.spec.ts | `visual-login-wide.png` | 1920×1080 | 2,073,600 | 0.02 | **41,472** | 204 px | `SCREENSHOT_OPTS` |
| visual-regression.spec.ts | `visual-register-default.png` | 1280×720 | 921,600 | 0.15 | **138,240** | 372 px | `REGISTER_SCREENSHOT_OPTS` |
| visual-regression.spec.ts | `visual-register-mobile.png` | 375×812 | 304,500 | 0.15 | **45,675** | 214 px | `REGISTER_SCREENSHOT_OPTS` |

**写死的一句（R20 点名要求）**：
> `visual-login-wide`：1920×1080，`maxDiffPixelRatio 0.02` ⇒ **小于约 41,472 px 的改动一律判过。
> 该断言【不构成】"UI 未变"的证据。**

**第二层失明是【逐像素容差】，与面积那层正交**：pixelmatch 的 `threshold` 默认 **0.2**
（同一份 `coreBundle.js`：`pixelmatch(..., { threshold: options2.threshold ?? 0.2 })`），
逐像素 YIQ 加权差 **≤ 35215 × 0.2² = 1408.6** 的像素**根本不进计数**——**多少个都不进**。
本仓有现成的判决性实例：`auth-dark-theme` 与 `auth-initial` **md5 不同**（背景渐变整幅偏移，肉眼可辨），
而 Playwright 口径下的差异 = **0 个像素**。⇒ **整幅低对比变化可以完全不被这套门禁看见，与面积阈值无关。**

### 二、🔴 禁令（本节的载荷，别只读上面的表）

> **在阈值重设之前，任何人不得引用这几条截图断言的「通过」来支持「UI 没变 / 视觉无回归」。**

适用范围是**上表全部 8 条**，不只是 wide 那条 —— 第二层失明对每一条都成立。
可以引用的只有反向结论：**某条断言红了 ⇒ 那里确实变了**（阈值宽只会漏报，不会误报）。
🔴 **阈值该设成多少是另一单**（总管已记着）。本节只负责把"它现在有多瞎"写成可复算的数字。

### 三、Finding 1 处置：`emulateMedia({colorScheme})` 的 4 条假覆盖已**删除**

**根因（现查真值源，不是推的）**：主题模式来自 `src/theme/store.ts` 的 `DEFAULT_CONFIG.mode`，
其值**写死为 `'light'`**；只有当它是 `'system'` 时，`getEffectiveMode()`（`src/theme/generator.ts`）
才会去查 `matchMedia('(prefers-color-scheme: dark)')`。默认既然是 `'light'`，**媒体特性根本不被查询**
⇒ `page.emulateMedia({ colorScheme })` 对本 App 零效果。

**处置 = 删，不是登记。** 已删除的 4 条断言与其 4 张基线：
`auth-dark-theme` · `visual-login-light` · `visual-login-dark` · `visual-login-mobile-dark`。
判据是**名字有没有承诺一个它并不变化的维度**：这 4 条名字里写着 light/dark，渲染出来却是同一张 light 图
⇒ 读测试清单的人以为暗色有覆盖，而它一次都没被测过 ⇒ **删掉比留着更有价值**（留着，下一个人以为有；删掉，下一个人知道没有）。

🔴 **写死：暗色 / 浅色主题的视觉回归【未覆盖】。**
要真正覆盖，得先把 App 的主题模式喂进去 —— 种 localStorage 键 `huanvae-theme` 的
`state.config.mode = 'dark'`（`src/theme/store.ts` 的 zustand persist 配置），**再到权威 linux 侧重出基线**。
本轮没做，理由是如实的：重出基线要再上一趟远程 linux 宿主（node22 tarball + `pnpm install` +
`playwright install chromium` + `install-deps`，前一单跑完已 `rm -rf` 掉工作目录），
而新增的暗色基线**没有任何先验可对照**，加进一个"CI 真跑未做、状态未确认"的门里只增暴露面、不增确定性。

⚠️ **同根因的另一处，本轮【只登记未改】**：`e2e/animation-health.spec.ts` 的
`Animation Health — Dark Theme` 两条同样用 `emulateMedia({ colorScheme: 'dark' })`
⇒ 它们实际跑的也是浅色。它们不产出基线（不是假基线，是**名字比覆盖面大**），
且属 `animation-health` 独立 project、不在 CI 门里 ⇒ 本轮只在源码处加注说明，处置另立单。

### 四、🔴 防复发：重复基线登记表守卫（`e2e/visual-authority.spec.ts` 第三组）

上面那 4 条假覆盖能活三个月，唯一原因是**没有任何东西在查「两条断言是不是渲染出同一张图」**。
新增守卫：任何两张权威基线**字节相同**时，必须出现在 `KNOWN_DUPLICATE_BASELINES` 里并写明理由；
未登记 ⇒ FAIL；登记了但已经不重复 ⇒ 也 FAIL（登记表过期）。有它，那 4 条在加进来的当天就会红。

当前登记在册的 2 组（都**没有说谎**，只是重复，故登记而非删除）：
`auth-initial` ≡ `visual-login-default`、`auth-mobile` ≡ `visual-login-mobile` ——
两侧断言强度不同（0.01 vs 0.02、后者还带 `fullPage`），且 `auth.spec.ts` 需要保留至少一条截图断言
与同文件的非截图断言混编，作「不是整套被跳过」的正对照。**BACKLOG：阈值另立单收敛后二选一。**

🔴 **已知边界，别当它全覆盖**：md5 是**字节**判据，抓不到「字节不同但在 Playwright 口径下差异为 0」那一档
（`auth-dark-theme` 正是这种）。要抓那一档得起 Playwright 的比较器，而它的入口 `toMatchSnapshot`
在 `--update-snapshots` 下会**改写基线**，不能进常驻守卫 —— 所以这条边界是**结构性**的，不是没想到。

### 五、`e2e/` 已纳入 `pnpm typecheck` 与 `pnpm lint:strict`

上一节第六点记的形态坑（`tsconfig.json` 的 `include` 只有 `["src","tests"]`、lint 脚本是 `eslint src`）
**已修**：`include` 改为 `["src", "tests", "e2e"]`；三条 lint 脚本改为 `eslint src e2e --ext .ts,.tsx`。

- **变异自证（四态 + 负对照，两侧输出形状不同）**：在 `e2e/helpers/visual-authority.ts` 注入一个类型错
  ⇒ `pnpm typecheck` **rc=2** 并逐行报 `error TS2322`；注入一个 `quotes`/`semi` 违规
  ⇒ `pnpm lint:strict` **rc=1** 并逐行报位置；原样撤回 ⇒ 两条**都 rc=0** 且 `cmp` 逐字节相等；
  一次无害改动（只加注释）⇒ 两条仍 rc=0。
  **负对照（这条才证明"是纳入让它可见"）**：把同一个类型错留在原地、只把 `include` 退回 `["src","tests"]`
  ⇒ `pnpm typecheck` **rc=0**；把同一个 lint 错留在原地、只用改前口径 `eslint src`
  ⇒ **rc=0**。⇒ 改前那两个错**结构上看不见**。
- **纳入不等于放宽**：`eslint.config.js` 为 `e2e/**/*.ts` 单列了一块，里面**只做两件事** ——
  ① 补 `globals.node`（e2e 跑在 Node 里，`process`/`Buffer` 不是浏览器全局；不补会被判 `no-undef`，
  那是环境声明缺失，不是代码错）；② 关掉 `react-hooks/rules-of-hooks`（e2e 一行 React 都没有，
  而 Playwright fixture 的形参固定叫 `use`，被误报成 React 的 `use()` Hook，形参名由 API 定死改不了）。
  🔴 **真正在查代码质量的规则一条都没放宽**（`no-explicit-any` / `curly` / `no-console` /
  `quotes` / `no-unused-vars` … 全部照旧生效），既有的 24 个 error + 5 个 warning 是**逐条改代码**修掉的：
  CDP 负载的 6 处 `any` 换成本文件真正读到的字段的最小接口、`curly` 补花括号、
  删掉未使用的 `test` 具名导入、`console.log` 改 `console.warn`、`httpLog` 去掉多余的 `async`、
  轮询循环用**单行** `eslint-disable-next-line no-await-in-loop`（不是整文件关规则）。
- ⚠️ **`e2e-real/` 仍未纳入**（现查：`npx eslint e2e-real --ext .ts` = **31 problems / 8 errors**，
  含多处 live-cluster 诊断用的 `console.log`）。本轮不动它，**BACKLOG**：与 real-e2e 那条线一起收。
- ⚠️ 顺带：`pnpm build` 是 `tsc && vite build`，`include` 变大后**构建也会连 e2e 一起类型检查** —— 这是有意的。

### 六、跑门禁时的两个数字（darwin 本机实测，报结果必须标平台）

`npx playwright test --project=chromium` ⇒ **8 skipped + 13 passed**
（改前是 12 skipped + 12 passed：删了 4 条截图断言、加了 1 条守卫）。
两侧形状不同 ⇒ 不是整套被跳过。**CI(ubuntu) 那一侧本轮没跑，状态未确认。**

## 🔴 视觉门禁续记（2026-08-21 · gen-33）：发布门禁跑在 darwin 上时，视觉那一层等于**零覆盖**

> **本节同为 EOF 追加**，不改上面两节任何一行。上面两节说清了「权威平台 = linux、非 linux 显式 skip」
> 这个**机制**；本节记的是它在**发布门禁**里的**下游后果** —— 那是上面两节没写、而 gen-33 第一次
> 把 `scripts/linux/test-all.sh` 在本机 darwin 上真跑到 13/13 才撞出来的。

### 事实

gen-33 那次 13/13（退出码 0、**项级零跳过**）里，第 7 项（Playwright E2E）的读数是
**`✓ PASS: E2E 测试 (30 passed, 8 skipped)`** —— 那 8 条**正是视觉截图断言**。

**判据（三条互相独立，不靠转述）**：

1. 仓内真正的 `toHaveScreenshot` 断言**恰好 8 条**（`e2e/auth.spec.ts` 2 条 + `e2e/visual-regression.spec.ts` 6 条），
   与 8 张入仓 linux 基线一一对应。
   ⚠️ 数它的时候别裸 `grep -c`：`git grep -o 'toHaveScreenshot' -- 'e2e/*.ts'` 是 **15**，
   多出来的 7 条全在 `e2e/visual-authority.spec.ts` 的**注释与提取器正则**里 ——
   这正是 [common.md](common.md)「『命中了』不等于命中的是那一类行」的现成实例。**必须逐条打开看**。
2. 权威平台判定 `process.platform === 'linux'`（`e2e/helpers/visual-authority.ts`）⇒ darwin 上整类 skip。
3. 🔴 **最硬的一条：盘上 8 张 darwin 基线的 mtime 全是 `Jul 17` / `Aug 12` 的旧件，
   而门禁跑在 `Aug 21`** —— 真跑过比对会改写它们（首跑写基线、其后比对）。
   **没被改写 ⇒ 这一次真的没跑视觉比对。**

### 载荷

🔴 **「13/13 无一项跳过」是【项】级口径，`13/13` 那行字只写在 `SKIP_COUNT -eq 0` 分支里
—— 它成立，但它证不到「每一层都有覆盖」。**
在本机（darwin）跑发布门禁，**视觉回归这一层恒为零覆盖**，而门禁输出里
唯一的痕迹只是第 7 项括号里那个 `8 skipped`，**汇总行不会提它一个字**。

⇒ **两条可执行纪律**：

1. **汇报 13/13（或任何 N/N）时，凡某一项的读数里含 `X passed, Y skipped`，必须把 Y 是什么一并写出来。**
   只报项级数字 = 把层级跳过洗白。
2. **要让视觉那一层真有覆盖，只有一条路：在权威平台（linux）上跑。**
   本机 darwin 且无容器运行时时如实写「做不到」，
   **不许**删用例 / 降阈值 / 加 `continue-on-error` 让它变绿（与上面两节同一条红线）。
   远程 linux 宿主这条路是通的 —— 见上一节「三态可达性」。

## 🔴 gen-47 追加（2026-08-29 · run-1787970946）：三条 —— **本节只追加在 EOF，不改上文任何一行**

> 来源：gen-47 单1（code，交付 `fw-code-1787971463-0cb18b20.md`）§1/§4/§8 与
> 单2（review，交付 `fw-review-1787977119-15a6f59c.md`）§2-①/§2-②。
> 追加在文件末尾是为了**不位移任何既有行号**（本文件被多份归档交付按 `file:line` 钉着）。

### 一、🔴 节点会被卸载重挂时，挂监听的 effect 依赖里必须含**节点本身**（真机实证的产品级缺陷）

**症状形状**：手势 / 事件监听**一开始好用，做过某个操作之后永久失效**，且**零报错、零告警**。
用户侧看到的只是「双指什么都不做」，很容易被转述成别的现象 ——
本 run 的报障原话是「放大的是整个 App」，而实测**图片和 App 都没动**。

**机制**：`useRef` 给的 `RefObject`，其 `.current` 变化 **不触发 re-render、也不触发 effect**。
于是 `useEffect(() => { const el = xxxRef.current; el.addEventListener(...) }, [deps])` 里若 `deps` **不含节点**，
节点一旦被换掉，**监听就永远留在那个已被摘掉的旧节点上**，新节点一个监听都没有 —— React 不会为此说一个字。

**判据（机械可执行，两步）**：① 找出所有「在 effect 里对 `xxxRef.current` 挂监听」的位置；
② 打开那个 effect 的**依赖数组**，只问一句：**节点本身在不在里面？**

```
git grep -nE '^[[:space:]]*\}, \[.*stageNode' -- src/chat/shared/useImageZoom.ts
```

🔴 **别写 `\s`**：`git grep -E` 是 POSIX ERE，不认 `\s` —— 本条实撞过：
`grep -cE '^\s*\}, \[.*stageNode'` **rc=1 零命中**（与「真的没有」完全同形），
改 `[[:space:]]` 后命中 `src/chat/shared/useImageZoom.ts:498`；
负对照（当场现编 `stageNodeZq47u`）rc=1 ⇒ 会响也会静。

**高危触发器要点名**：本仓这次的触发器是**条件渲染** ——
`src/chat/shared/MediaGalleryProvider.tsx:225` 在切图时先把 `src` 置成空串，
而 `src/chat/shared/MobileMediaPreview.tsx:723` 是 `{src && (type === 'image' ? (`
⇒ 空串那一帧把承载层 `div` **整个卸载**，新源到了再**重挂一个新节点**。
⇒ **凡是被 `{cond && ...}` 包着、或挂着会变的 `key` 的节点，都属这一类高危。**

**修法**：`RefObject` 改 **callback ref**，节点**同时**写进两处 ——
`src/chat/shared/useImageZoom.ts:218` 的内部 ref（给逐帧写 transform 用，读它零重渲染）
与 `:219` 的 state（给挂监听的 effect 当依赖）。
**代价**：承载层挂 / 卸各多一次 render（切图时多 2 次）。这是**换取「监听跟着节点走」的必要代价**，
注释里必须写下成因，否则下一个人会把那个"多余的" state 顺手删掉。

**测法（这一类单测写得出来，别放弃）**：`tests/unit/imageZoomGestureWiring.test.tsx:194` 起两条 ——
① 重挂出来的**新节点仍响应**；② **被摘掉的旧节点不再响应**（＝「监听是**搬家**不是**复制**」）。
两条都做过**变异自证**：把修复退回旧行为 ⇒ **精准只红这两条，其余 10 条不动**。

🔴 **必须记住的一句**：这类缺陷 **vitest 在修复前测不出来** —— 该 hook 此前**已有单测且 12/12 全绿**，
因为旧测试从不制造「节点被卸载重挂」这个前提。
**「有单测且全绿」不构成「这条路径被覆盖」**，只构成「已被写下来的那些前提被覆盖」。

### 二、Android 上做到 **pinch 级**真运行时验收的完整路径（本仓第一次）

1. **载体**：本机（macOS / arm64）跑不了 Android 模拟器、也没有 `adb`；走 **mesh 内的 x86_64 构建宿主**
   （带 `/dev/kvm`），在它上面 headless 起 AVD、装 Tauri APK、用 `adb` 驱动。
   🔴 **真实主机名 / 地址不写进本仓（PUBLIC 公开仓）** —— 去查工作区内部记录。
   🔴 **纪律：那台宿主上常年有别的线的 emulator 在跑**（本 run 与另一条线的实例并存）⇒
   **所有 `adb` 命令一律 `-s <serial>` 指名**，不 kill、不装卸别人的包；收工只回收自己起的那一台。

2. 🔴 **`adb shell input` 全是单点，没有 pinch**：子命令只有
   `text / keyevent / tap / swipe / draganddrop / press / roll / motionevent / keycombination`
   —— **一个多指入口都没有**。双指必须走 `/dev/input/eventX` 的 **MT protocol B**（`sendevent`），
   两个 slot 各自推进 `ABS_MT_TRACKING_ID` / `ABS_MT_POSITION_X|Y`。两个坑（都实撞过）：
   · **slot 里残留的 `ABS_MT_TRACKING_ID` 会把下一次按下静默吞掉** ⇒ 读到 `pointerCount=0`，
     **与「App 不响应」完全同形** ⇒ 所有手势脚本一律以「先释放两个 slot」开头；
   · `sendevent` 一次一个进程，**双击中间不能加 `sleep`**，否则被拉过 300ms 双击窗口。
   🔴 **注入到底有没有到达系统，用 `dumpsys input` 读 `Last Raw Touch` 的 `pointerCount`** ——
   它能把「App 没响应」和「手势根本没进去」分开，而这两者**在屏幕上完全同形**。

3. 🔴 **Android WebView 的页面级捏合缩放默认是【关】的** ⇒
   **「整个 App 被双指放大」在 Android 上结构上不会发生** —— 这条能一次砍掉一整类误报方向。两条独立判据：
   ① wry 生成的 `RustWebView` 只设了 6 条 `WebSettings`，`setSupportZoom` / `setBuiltInZoomControls` /
      `setDisplayZoomControls` **一条都没设**，而 `setBuiltInZoomControls`（捏合缩放页面的真开关）**默认 false**；
      本 App `gen/android` 的 Kotlin 里 zoom 零命中（**正对照** `RustWebView` 命中 6 个文件 ⇒ 查法会响）。
   ② 更硬的实测：在 JS 缩放层**已失效**的那一次，真的两个触点进来了（`pointerCount=2`），
      而图片区与顶栏 `diff_px` **都是 0** ⇒ JS 不接管时**浏览器也没有把页面放大**。

4. **判据形态：分区域逐像素比对 + 双侧标定**。截图按**固定元素盒**（标题 / 关闭键 / 三点 / 位次）
   与**被测区**（图片文字带）分别量 `diff_px` 与 `max_channel_delta`，
   并**把状态栏时钟排除出所有比对区域**（本 run 一律从 `y=150` 起）。
   **双侧标定缺一不可**：静止两帧必须报 `0/0`（证明工具不带噪）· 已知不同的两帧必须报大值
   （本 run：查看器开 vs 关的同一个标题盒 `diff_px=25200/25200`、`maxΔ=242`）。
   底下还要再垫一层：主屏连拍两张 `diff_px=0`、注入一次上滑后 `2574890`
   ⇒ **注入与截图这条链本身会响也会静**，否则上面所有读数都悬空。

### 三、🔴 vitest 在 VirtioFS 上 worker 起不来：`rc=1` 但**零测试失败**；以及**账要怎么算**

1. **现象**：本机（VirtioFS 共享盘）跑 `pnpm test:run` **恒 `rc=1`**，错误全是
   `Failed to start threads worker`，而 `×` 标记的**失败测试数 = 0**。
   🔴 **改代码之前的基线也是 `rc=1`** ⇒ **`rc=1` 本身不构成回归证据**，要看的是 `×` 的条数。
   判据自证：基线那次 `×` = **1**（一条 12.2s 超时用例），修复后那次 `×` = **0**，现编串 = 0
   ⇒ 这条 grep 会响也会静。

2. 🔴 **全量测试文件总数 = 360**（`vitest.config.ts:24` 起两条 include glob 的 find 口径；
   现跑复算 `find tests src -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) | wc -l` = **360**，
   负对照现编后缀 = 0）。三次跑各自闭合验算 `346+14 / 292+68 / 318+42` **全部 = 360**。
   ⇒ 🔴 **「这一次跑成了几个」不是「总数」**。本 run 单1 正是把某一次的 `346` 当成了总数，
   于是「318 主跑 + 39 补跑」看着像覆盖全了，**实际 357 ≠ 360，差 3 个文件**。
   🔴 **这个账错判官查不出来**（它只核 `verify:` 能不能复算）—— 是复核环用**算术**查出来的。

3. 🔴 **抠「未起来的文件名」时别用会吃中缀的取名模式**：`HuanvaeGuardPage.macos` /
   `HuanvaeGuardPage.probeRace` / `HuanvaeGuardPage.windows` 三个正是这么漏掉的
   （42 个 distinct 只抠出 39）。

4. **正确做法：跨多次跑取并集**，并验两条 ——
   `(A 次未起来 ∩ B 次未起来) − 补跑名单 == 0`（没有哪个文件三次都没跑到）
   且 `名单 − 全集 == 0`（名单里没有幽灵文件）。

5. 🔴 **写「零测试失败」之前先答一句**：我核到的是**自己输出文件的自洽**，还是**独立复跑**？
   本 run 复核环**一次也没能在自己窗口里把 vitest 跑起来**（5 文件批 / forks 池串行 / tar 预热后重试 /
   单文件，四级降级全挂，而同刻内存 free 66% ⇒ 不是内存），所以它核到的是
   「单1 输出文件自洽 + 三次并集算术」，**没有独立复跑**。
   **这两者价值不同，必须在交付里分开写** —— 合着写等于把「我复算了他的账」冒充成「我自己也跑通了」。

## 🔴 gen-48 追加（2026-08-29 · run-1787982711）：四条 —— **本节只追加在 EOF，不改上文任何一行**

> 来源：gen-48 单1（code，`fw-code-1787985265`）· 单2（code，`fw-code-1787993265`）·
> 单3（review，`fw-review-1788007591`）· 单4（code，`fw-code-1788010332`）。
> 追加在文件末尾是为了**不位移任何既有行号**（本文件被多份归档交付按 file:line 钉着）。
> 🔴 **第一条推翻了上文 gen-47 那节里的一个结论**，按追加纪律**不改那一行**，在这里就地作废，读表时连本节一起读。

### 一、🔴 Android WebView 的【整页】捏合缩放，真开关是 **meta viewport**，不是 `setBuiltInZoomControls`

**🔴 先作废一条**：上文 gen-47 那节第 3 点写的
「Android WebView 的页面级捏合缩放默认是【关】的 ⇒ 整个 App 被双指放大在 Android 上**结构上不会发生**」——
**后半句作废**。它的两条依据**本身都属实**（wry 确实一条 zoom 设置都没设、Android 官方文档确实写
`setBuiltInZoomControls` 默认 false，单1 独立核到官方原文），
**但由它们推出的「所以整页缩放不会发生」是错的**。

**现象（同形面）**：`index.html` 的 viewport 里**没有** `user-scalable=no` / `maximum-scale` 时，
整个 App 可被双指放大到 **5 倍**；而**状态栏尺寸不变**、`innerWidth` / `documentElement.clientWidth` 也不变
⇒ 从截图上看很像「某个组件被放大了」，从 DOM 上看又「什么都没变」——
两侧都不指向真因（缩放发生在浏览器的 **visual viewport** 层）。

**可执行判据（承重量是 `visualViewport.scale`，不是像素差）**：
release 版 APK 的 WebView devtools socket 实测**是开着的**（`/proc/net/unix` 命中 `@webview_devtools_remote_<pid>`）
⇒ 可直接读页面内部量。缩放态下单1 读到：

    {"vv_scale":5, "vv_w":78.6, "vv_h":170.3, "dpr":2.75, "inner":[393,851], "docClientW":393,
     "bodyTransform":"none", "htmlTransform":"none", "rootTransform":"none", "bodyZoom":"1"}

`html` / `body` / `#root` 的 computed transform **全是 `none`**、`body zoom = 1`
⇒ **不是 App 的 CSS/JS 缩放**，是浏览器原生页面缩放。
🔴 **认证页有一层持续动的渐变背景，静止两帧本身就能报出 `diff_px` 200 万 / maxΔ 30~70 的底噪**
⇒ 在那些页面上**像素差没有判别力**，只能用 `scale`（0 噪声，1 vs 5 两侧形状完全不同）。

**正/负对照（单1 的 APK 级单变量 A/B，同机、同页、同手势脚本，相隔几分钟）**：

| 装的哪一份 APK | 运行中读到的 meta | pointerCount | `visualViewport.scale` 序列 |
|---|---|---|---|
| GitHub v1.1.38 **发布件** | …viewport-fit=cover | 2 / 2 / 2 | **1 → 3.381 → 5 → 5** |
| 同源码 + 补丁，自建 | …viewport-fit=cover, maximum-scale=1.0, user-scalable=no | 2 / 2 / 2 / 2 | **1 → 1 → 1 → 1** |

两侧 `pointerCount` 都是 2（**手势确实进了系统**，见上文 gen-47 那节的 `dumpsys input` 判据）
⇒ 那串 1 是真的 1，不是注入链死了。
**同趟内的邻接正对照**：七页矩阵里**两页缩放到 5 倍、另外五页恒为 1** ⇒ 那些「1」也是真的。

**配套（这条解释了「为什么有的页会、有的页不会」）**：不缩放的页祖先链里有
`DIV.mobile-content[touch-action=pan-y]` —— 而这个 `pan-y` **不是 CSS 写的**（`src/styles/mobile/main.css` 的
`.mobile-content` 规则里没有 `touch-action`），是 `src/pages/mobile/MobileMain.tsx` 里
`<motion.div className="mobile-content" drag="x">` 给出的**行内值**
⇒ **主壳那块「左右滑切标签」的容器顺手把浏览器缩放挡住了，是副作用不是设计意图**；
**不在这块容器里的界面（认证页、设置页）没有这层意外保护**。

**修法**：`index.html` 的 viewport meta 加 `maximum-scale=1.0, user-scalable=no`。
单3 用**真 Android 上的四象限**证明它**不会误伤** App 自己的 JS 捏合缩放通道：
打上该 meta 后，JS 触摸 + CSS transform 那条通道**逐像素完全相同**（红块 108900 → 678975，
`a1-hold` vs `b1-hold` 的 `diff_px=0 / maxΔ=0`）；
而**正对照** c1/d1（不挂任何 JS 处理器的两页）给出 `vv` 3.3806 vs 恒 1、红块 1196588 vs 恒 108900
⇒ **那条 meta 在这台 WebView 上确实生效**，前面那串「相同」才有意义。
⚠️ 仍未验到的一格：**App 自己的图片查看器**端到端没捏过（补丁版缺 mTLS 私钥登不上、发布件里造不出图片消息）。

**🔴 元教训（这条比结论本身值钱）**：
**「某平台的某个开关默认关着」+「代码里没设它」这两条事实都对，也推不出「所以这件事不会发生」** ——
凡下「结构上不会发生」类结论，必须再问一句「**还有没有别的开关能开它**」，**并去真机上量一次**。
本例里那个"别的开关"就在自己仓里的 `index.html` 第一屏。

**一手来源**：单1 §2 / §4 / §5 · 单3 §1.2（四象限 + 双侧标定 + 正对照）。

### 二、量「一块区域黑不黑」时，**承重列是 `dark_ratio`（luma<16 占比）**，不是 `mean_luma`、更不是 `diff_px`

**现象（同形面）**：要区分的其实是**三态** —— ①还停在上一个会话的画面 ②真的黑窗 ③已经画出来的稳态。
`diff_px` 在①与②上**同量级**（0.9955 vs 0.977）⇒ 几乎零判别力；
`mean_luma` 在②（20.6）与①（这次是 137，换个布局可能落到几十）上**分不开**。
只有 `dark_ratio` 把三态拉开两个量级。

**判别力实测（同一批画面、同一区域）**：

| 列 | 上一个会话 | 黑窗 | 稳态 |
|---|---|---|---|
| `dark_ratio` | 0.0000 / 0.014 | **0.9694 ~ 0.912** | 0.3554 / 0.37 |
| `mean_luma` | 163.84 / 137 | 9.86 ~ 6.04 / 20.6 | 61.34 |
| `diff_px` | 0.9955（占比） | 0.977（占比） | — |

**正/负对照（每一格都要做，缺一条这格作废）**：
· 比较器不带噪：静止两帧 `diff_px=0 / maxΔ=0`；
· 比较器会响：已知不同两帧 `diff_px≈20 万 / maxΔ=255`（或单4 的 45890~45900 / maxΔ 230~255）；
· 亮度判据本身：同一张**真实截图**里一块确知近黑的子区 ⇒ `dark_ratio=1.000000`，
  同图一块确知亮的子区 ⇒ `0.000000`。

**一手来源**：单2 §3.2（三态判别力对比表）· 单4 §3.1（承重列口径 + 每格双侧标定）。

### 三、🔴 WKWebView 按 **asset URL** 缓存已解码的图 ⇒ 换夹具内容**必须换文件名**

**现象（同形面）**：你把夹具文件的**内容**换了但**路径不变** ⇒ WebView 复用旧的已解码图
⇒ 屏幕上还是旧内容。此时「**换了内容但看不见**」与「**这条路径根本没被用上**」**完全同形**，
而后者会把结论推向反面。
**实例（单4 作废格 B）**：用同一个文件名换封面夹具，读到「稳态不是洋红」，
**差一点据此写成「这个构建根本不用封面」**；换成**唯一文件名**重做后，稳态洋红簇占比 **0.7894** ⇒ 封面确实被用上了。

**可执行判据 / 做法**：每次换夹具内容**一律换一个新文件名**（带时间戳或序号），
并在读数里给出「**装夹具前 vs 装夹具后**」两组主色簇：
单4 的形状是 装前主色簇 `0,0,0`（0.3656）→ 装后 `176,32,176`（**0.7908**）⇒ 两侧形状不同。

**一手来源**：单4 §7 作废格 B。

### 四、视频封面（`video_posters`）现状 —— 别再重复排查已排除的三条

**读侧【在工作】，已被两条互相独立的探针证到**（单4 §4）：
· **P-A（答「调没调用」）**：把 `video_posters` 里那一行指向一个**不存在的路径** ⇒ 点开会话后该行**被删**（3 行 → 2 行）；
  同刻该载体 stdout 里 `VideoPoster` 相关行 = **0** ⇒ 不是 `invalidate_video_poster` 干的
  ⇒ 能删掉这行的只剩 `get_video_poster_path` 那个分支；
· **P-B（答「用没用上」）**：把那一行指向一张**当场合成的洋红夹具** ⇒ 视频格子里 **79.08%** 的像素落进洋红主色簇
  ⇒ 返回值被**渲染到屏幕上**了。

**已排除、别再查的三条**（单3 §2.4 顺手核过）：命令注册在唯一那份 `generate_handler!` 列表里 ·
参数名 camelCase 映射对得上（前端 `{ fileKey }` ↔ Rust `rename_all = "camelCase"` 的 `file_key`）· 探针那把键的键空间是对的。

**黑窗的决定维是「有没有封面」，不是「哪个构建」**（单4 §3.2 六格，33 ms 抽帧分辨率，每格双侧标定）：

| 有无封面 | 切走→切回 | 冷启动后首次打开 |
|---|---|---|
| **无封面** | 494 ms（BEFORE）/ **758 ms**（AFTER） | **1748 ms** |
| **有封面** | 33 ms（BEFORE）/ **0**（AFTER） | **0** |

⚠️ 每格只跑了一次 ⇒ 格间几十 ms 的方向差**不具统计意义**；能当结论的是**量级**。

**🔴 真正的病灶在【写侧】，成因未定（BACKLOG）**：那条视频的 `[VideoPoster] 已保存封面` 计数**长期为 0**
（一个载体三次 run 全 0），而**另一个载体偶尔成功过一次**（`… (40218 字节)`）
⇒ **不是恒失败，是不稳定**。⇒ 待定位 `captureAndSaveVideoPoster` 对这条 4.16 GiB 本地视频为何多数时候不落盘。
⚠️ 它的失败原因只走 `console.warn`，而本机读 JS 控制台的两条路都不通（见 rust-dev.md 那条：
右键被 App 自己的菜单接管 / ad-hoc 签名下 Inspector 起不来）⇒ 重做前先想好怎么读到它。

**一手来源**：单4 §4 · §3.2 · 单3 §2.4。
