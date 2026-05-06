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
