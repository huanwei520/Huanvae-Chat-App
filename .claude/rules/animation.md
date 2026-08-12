# 动画防冲突规范（animation）

GSAP（`gsap` + `@gsap/react`，见 `package.json`）与 CSS / framer-motion / React 受控 style 并存时的核心约束。

> 与本规范并轨的两套机器门禁：
> - **静态门禁** [tests/animation-conflict.test.ts](../../tests/animation-conflict.test.ts)：扫 CSS 文件，断言被 JS 逐帧接管的 className 不在 CSS 里声明同属性 `transition`。
> - **运行时门禁** [e2e/animation-health.spec.ts](../../e2e/animation-health.spec.ts)（`pnpm test:animation`）：用 CDP 监听 Animation 事件 + Performance 指标，捕捉静默期残留动画 / 同节点并发动画 / 布局抖动。
>
> vitest（jsdom + `MotionGlobalConfig.skipAnimations = true`）测不出逐帧抢夺，故"声明层"靠静态门禁、"运行时"靠 e2e；两者缺一不可。GSAP 惯用法以仓内官方 skill [`.claude/skills/gsap-react`](../skills/gsap-react/SKILL.md) / [`gsap-core`](../skills/gsap-core/SKILL.md) 为准。

## 规则一：单一所有权 —— 每个属性只能有一个动画主人

**一个元素的同一个属性（尤其 `transform` / `opacity`）只能由一套系统逐帧控制：GSAP、CSS `transition`/`animation`、framer-motion 三者择一，禁止叠加。** 要交给 GSAP 动的属性，CSS 里就不能给它声明 `transition`（也不能 `transition: all`），否则浏览器会对 GSAP 写的每一帧 inline style 再启一次 CSS 过渡 → 抖动、拖尾、行为不可预测。

**为什么**：GSAP 通过 inline style 高频改 `transform`；CSS `transition: transform` 会把"瞬时跳到目标值"变成"用 CSS 缓动追"，于是同一帧两套缓动抢同一属性，肉眼是卡顿/回弹/慢半拍。这类冲突 vitest 测不出（skipAnimations），只有真实浏览器逐帧渲染才暴露。

```css
/* 反例：.hero-card 的 transform 同时被 GSAP 动 + CSS 过渡 → 抢帧 */
.hero-card {
  transition: all 0.3s ease;          /* ✗ all 覆盖 transform/opacity */
  transition: transform 0.2s ease;    /* ✗ 显式过渡 GSAP 接管的属性 */
}
```

```css
/* 正确：GSAP 接管 transform/opacity；CSS 只过渡 GSAP 不碰的属性 */
.hero-card {
  transition: box-shadow 0.2s ease, border-color 0.2s ease; /* ✓ 只列非动画化属性 */
}
```

```ts
// 正确：GSAP 全权接管 transform，CSS 里该属性无 transition
gsap.to('.hero-card', { x: 24, opacity: 1, duration: 0.4 });
```

CSS 反馈（如 `:active { transform: scale(0.98); }`）也算"另一个主人"，与 GSAP/motion 的 transform 抢帧——改用 JS 侧反馈（GSAP tween 或 motion `whileTap`）。

⚠️ **但"改用 JS 侧"不是无条件的**：谁当主人要看**哪一方能覆盖全部调用点**。共享组件（design-system 按钮之类）的 transform 往往只能由 CSS 当主人——见下面这条实例。

### 实例：认证页表单切换的同节点并发动画（2026-08-12）

**症状**：门禁 E2E `e2e/animation-health.spec.ts:185`「Animation Health — Auth Form Toggle」
同一份代码连跑 10 次 **4 FAIL / 6 PASS**，报 `Node NN: 3~8 concurrent`，节点号每次不同。
看着像 flaky，实则底下是**同一个真实的并发动画**，随机的只是"是否越过检测阈值"。

**那个 Node 是谁**（用 CDP `DOM.resolveNode` 把 `backendNodeId` 解回元素才看清，别猜）：
`button.app-btn.app-btn--primary.app-btn--lg.app-btn--block`，即注册页第一步的「下一步」提交按钮，
解析出来时它的 inline style 正是 `transform: translateY(-3px) scale(1.02)` —— framer-motion 的 hover variant。

**为什么它会被 hover**：点「注册新账号」后指针停在原地，注册表单带着 x 位移滑入，
按钮自己**移动到指针底下** → hover 触发。这一步与 bug 无关，但它是引信。

**成因（两个 transform 主人）**：

| 主人 | 位置 | 原文 |
|---|---|---|
| CSS | `src/styles/components/app-button.css` `.app-btn` | `transition: transform var(--transition-bounce, …)` + `:hover { transform: translateY(-2px) scale(1.02) }` + `:active { … }` |
| framer-motion | `src/pages/Register.tsx` / `Login.tsx` | `<MotionAppButton variants={buttonVariants} whileHover="hover" whileTap="tap">`，`buttonVariants.hover = { scale: 1.02, y: -3, transition: { type: 'spring', … } }` |

spring **每帧写一次 inline transform**，浏览器就对**每一次写入各起一条 400ms 的 `transition: transform`**。
实测（`document.getAnimations()` 采样）：hover 那一瞬先是一批 7 条过渡（border-\*-color ×4 + box-shadow + transform + 扫光 left），
**随后只有 `transform` 一条属性在反复重开**——`t=2374 / 2766 / 2940 / 3022 / 3227` 各起一条新的 `CSSTransition(transform, 400ms)`。
"只有 transform 在重开、其它属性不重开"正是**判据**：它排除了 hover 反复进出（那样每条属性都会重来），
坐实了 inline 值在被逐帧改写。这串过渡一直溢到检测窗口里，落进去几条就报几条 → 40% 掷骰子。

**修法（恢复单一所有权：CSS 当主人，删掉 JS 那一层）**：

```tsx
// ✗ 两个主人：CSS 已经 transition+:hover+:active 全包了 transform，这里再写一层
<MotionAppButton variants={buttonVariants} whileHover="hover" whileTap="tap">下一步</MotionAppButton>

// ✓ 一个主人：hover 抬升 / press 按下全部由 app-button.css 提供，视觉等价
<AppButton type="submit" variant="primary" size="lg" block>下一步</AppButton>
```

**为什么这次是 CSS 当主人（与本规则一般偏好相反）**：`.app-btn` 的 hover/active/disabled 反馈写在
共享 CSS 里，全应用 40+ 个**普通** `<AppButton>` 调用点都靠它——CSS 是**唯一能覆盖所有调用点**的主人；
少数几个 `<MotionAppButton whileHover>` 才是多出来的第二个。**选主人的判据是覆盖面，不是"JS 更高级"。**

同批一并修的第二处（这个反过来，JS 当主人）：`.back-button` 原本写 `transition: all`，
而 `motion.button.back-button` 有 `whileHover scale 1.1` —— `all` 覆盖 transform，
改成只列 `border-color, box-shadow`。

**机器守门**（都做过 node 变异验证，删掉修复必翻红）：
- `tests/animation-conflict.test.ts` 注册表新增 `.back-button` / `.glass-input`；
- 同文件新增 describe「`.app-btn` 的 transform 单一所有权」：扫 `src/**/*.tsx`，
  任何 `<MotionAppButton>` 声明 `whileHover|whileTap|whileFocus|variants` 即 FAIL。

**两个可复用的教训**：

1. **先把节点解回元素，再谈成因。** 报文里只有 `Node 26`，猜"哪两套 variants 打架"会跑偏；
   `DOM.resolveNode` + `document.getAnimations()`（带 `transitionProperty`）一次就指到人。
2. 🔴 **CSS 注释里不许出现花括号。** `animation-conflict.test.ts` 抠规则块是"到第一个右花括号为止"，
   注释里的花括号会把它后面的 `transition` 挡在块外 → 那条注册项**静默空转、恒 PASS**。
   本次给 `.back-button` 写注释时就踩了（注释里带了 `whileHover={{ scale: 1.1 }}`），
   **是变异验证发现的**——只跑一次绿的注册项，不能证明它在守门。

## 规则二：所有 GSAP tween 显式 overwrite，避免同元素叠 tween

**对同一元素/同一属性可能重复触发的 tween（hover、点击、状态切换、列表项复用），必须用 `overwrite: 'auto'`；或在新建 tween 前 `gsap.killTweensOf(target)`。** 否则旧 tween 未结束就叠新 tween，两条 tween 同时写同一属性 → 数值打架、回跳。

**为什么**：GSAP 默认 `overwrite: false`，多次 `gsap.to(同一 target, {同一属性})` 会并存。`'auto'` 在 tween 首帧渲染时只杀掉其它**活跃** tween 里**重叠的那个属性**（精准、不误伤其它属性），是交互动画的安全默认。

```ts
// 反例：快速 hover 进出，opacity 上叠了多条 tween，互相打架
el.addEventListener('mouseenter', () => gsap.to(el, { opacity: 1, duration: 0.3 }));
el.addEventListener('mouseleave', () => gsap.to(el, { opacity: 0.5, duration: 0.3 }));
```

```ts
// 正确：overwrite: 'auto' 让新 tween 接管，旧的同属性 tween 自动让位
el.addEventListener('mouseenter', () => gsap.to(el, { opacity: 1, duration: 0.3, overwrite: 'auto' }));
el.addEventListener('mouseleave', () => gsap.to(el, { opacity: 0.5, duration: 0.3, overwrite: 'auto' }));

// 或重建前显式杀：
gsap.killTweensOf(el);
gsap.to(el, { opacity: 1, duration: 0.3 });
```

设全局默认也可：`gsap.defaults({ overwrite: 'auto' })`（但单点 tween 仍建议显式，便于阅读）。

## 规则三：用 `useGSAP` + 单一 scope，一个节点只挂一个 useGSAP

**React 里 GSAP 一律用 `@gsap/react` 的 `useGSAP(() => {...}, { scope: containerRef })`，不用裸 `useEffect` 手搓 tween。** `useGSAP` 自动在卸载/依赖变化时 `revert()`（杀 tween + 还原 inline style）。**同一子树只能挂一个 `useGSAP`**——多个 useGSAP 各自 scope 重叠会争抢同一批节点的 tween 与 cleanup。

**为什么**：裸 `useEffect` 起的 tween 若忘了在 cleanup 里 `ctx.revert()`，卸载后 tween 仍在改已分离节点 → 内存泄漏 + React 警告。多个 useGSAP 抢同一子树时，A 的 revert 可能还原 B 正在写的 inline style，表现为"动到一半被打回"。`scope` 让选择器字符串限定在容器内，避免误选到别处同名节点。

```tsx
// 反例：裸 useEffect 无 revert + 两个 useGSAP 抢同一容器
useEffect(() => { gsap.to('.item', { x: 100 }); }, []);          // ✗ 无 cleanup，泄漏
useGSAP(() => { gsap.from('.item', { opacity: 0 }); });          // ✗ 与上面抢 .item
useGSAP(() => { gsap.to('.item', { y: 20 }); }, { scope: ref }); // ✗ 第二个 useGSAP 抢同子树
```

```tsx
// 正确：单一 useGSAP + scope，cleanup 自动
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';

gsap.registerPlugin(useGSAP); // 模块级注册一次

const containerRef = useRef<HTMLDivElement>(null);
useGSAP(() => {
  gsap.from('.item', { opacity: 0, y: 20, stagger: 0.05 });
}, { scope: containerRef }); // 选择器锁定在 containerRef 子树；卸载自动 revert
```

依赖变化要重跑并先还原：传 `{ scope: ref, dependencies: [dep], revertOnUpdate: true }`。事件处理器里建的 tween 用 hook 返回的 `contextSafe()` 包裹，否则不进 context、不会被 cleanup。

## 规则四：GSAP 正在动的属性，不能同时被 React 受控 style / className 改

**GSAP 逐帧写的 `transform` / `opacity`，不能同时被 React 的受控 `style={{ transform / opacity }}` 或切换 className（CSS 改同属性）改——会逐帧抢回去。** GSAP 写完一帧 inline style，下一次 React re-render 把受控 `style` 又盖回，二者每帧拉锯。

**为什么**：React 受控 `style` 的优先级与 GSAP 的 inline style 同级（都是 element.style），谁后写谁赢；re-render 频率与 GSAP RAF 不同步 → 抖动。切 className 改 transform 同理（且 CSS transition 还会叠规则一的问题）。让 GSAP 独占该属性：React 不在 `style` 里写它，状态变化通过**触发新 tween**表达，而不是直接 set inline style。

```tsx
// 反例：opacity 既被 GSAP 动，又被受控 style 每次 render 盖回
useGSAP(() => { gsap.to(boxRef.current, { opacity: 1, duration: 0.5 }); }, { scope: boxRef });
return <div ref={boxRef} style={{ opacity: visible ? 1 : 0 }} />; // ✗ 与 GSAP 抢 opacity
```

```tsx
// 正确：opacity 只归 GSAP；状态变化用新 tween 表达，受控 style 不碰该属性
const boxRef = useRef<HTMLDivElement>(null);
useGSAP(() => {
  gsap.to(boxRef.current, { opacity: visible ? 1 : 0, duration: 0.5, overwrite: 'auto' });
}, { scope: boxRef, dependencies: [visible] });
return <div ref={boxRef} />; // 不在 style 里写 opacity/transform
```

## 规则五：reduced-motion 兜底用 `gsap.matchMedia()`

**所有非装饰性 GSAP 动画必须给 `(prefers-reduced-motion: reduce)` 提供无动 / 瞬时兜底，用 `gsap.matchMedia()` 实现。** 偏好减弱动画的用户（含前庭功能障碍者）开启该系统设置后，动画应降为瞬时到位或不播。

**为什么**：`gsap.matchMedia()`（GSAP 3.11+）只在 media query 命中时跑该分支的 setup，不再命中时**自动 revert** 该分支建的所有 tween/ScrollTrigger，是响应式 + reduced-motion 的标准做法。手写 `window.matchMedia` 监听 + 手动清理易漏 cleanup。

```ts
// 反例：无视系统偏好，强行播放长动画
gsap.to('.panel', { x: 0, opacity: 1, duration: 1.2, ease: 'power3.out' }); // ✗ reduce 用户也被晃
```

```ts
// 正确：matchMedia 按条件给瞬时 / 正常两套；reduce 时 duration: 0 瞬时到位
const mm = gsap.matchMedia();
mm.add(
  { reduceMotion: '(prefers-reduced-motion: reduce)' },
  (ctx) => {
    const { reduceMotion } = ctx.conditions as { reduceMotion: boolean };
    gsap.to('.panel', {
      x: 0,
      opacity: 1,
      duration: reduceMotion ? 0 : 1.2, // reduce → 瞬时
      ease: 'power3.out',
    });
  },
);
// React 里优先用 useGSAP 包裹（自动 revert）；裸用时组件卸载调 mm.revert()
```

React 中把 `gsap.matchMedia()` 放进 `useGSAP(() => { ... }, { scope })`，由 useGSAP 统一 revert，无需手动 `mm.revert()`。

## 与 animation-conflict.test.ts / animation-health e2e 的关系

新增/改动 GSAP 组件时，按下列并轨登记，让机器持续守门（对齐 [.claude/CLAUDE.md「动画类变更的额外门禁」](../CLAUDE.md) 与 [frontend-test.md「动画相关变更必须补冲突回归测试」](frontend-test.md)）：

1. **若该 GSAP 组件的 className 在 CSS 里仍有 `transition` 字段**（哪怕只过渡非动画化属性）：把该 selector 登记进 [tests/animation-conflict.test.ts](../../tests/animation-conflict.test.ts) 的 `MOTION_CONTROLLED_SELECTORS` 注册表（`selector` / `cssFile` / `controlledProps` / `motionLocation`），让静态门禁断言其 `transition` 不含 GSAP 接管的属性（规则一的机器复查）。该注册表对 framer-motion 与 GSAP 同等适用——任何"JS 逐帧接管 transform/opacity"的组件都登记。

2. **运行时覆盖**：新 GSAP 动画若出现在 e2e 可达页面（登录前页 / 多视口 / 多主题），在 [e2e/animation-health.spec.ts](../../e2e/animation-health.spec.ts) 增加对应场景，确保静默期无残留动画（规则二/三 cleanup 失效会被它抓到）、同节点无并发动画（规则一/四抢帧会被它抓到）。登录后页面 e2e 受 `@tauri-apps/plugin-http` 通道限制不可达，改用 vitest 组件测试 + 本规范的代码审核把关。

3. **判断口径**（任一命中即属"动画变更"，须走上面登记）：新增 `useGSAP` / `gsap.timeline` / `gsap.to/from` 组件；给已有 GSAP 组件加新动画属性；给已有 GSAP 组件的 CSS 加/改 `transition`；改已注册组件的 className。

> 静态门禁防"声明层"冲突（CSS 与 JS 抢同属性），e2e 防"运行时"冲突（cleanup 泄漏 / 并发动画 / 抖动），本规范五条是两者要强制的设计约束。三者配套，缺一则该类回归无人复查。
