# 前端测试规则（frontend-test）

Vitest + @testing-library/react 下的踩坑点和惯用模式。

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

`MotionGlobalConfig.skipAnimations = true` 让 vitest 跳过帧更新 → 此类冲突在 vitest 中**永远测不出来**。e2e 真实浏览器才能复现，但项目内登录后页面（FilesModal/MobileFilesPage 等）受 `@tauri-apps/plugin-http` 通道限制 e2e 不可达。

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
