/**
 * 股票研究窗口 — GSAP 动画公共约定
 *
 * 统一封装 useGSAP + 单一 scope + gsap.matchMedia（reduced-motion 兜底）的样板，
 * 各组件调用 useStockIntro 传入 scope ref 与构建函数即可，保证：
 *   - 单一所有权：每个组件用自己的 scope，只动自己的 selector；
 *   - reduced-motion：命中 (prefers-reduced-motion: reduce) 时 build 收到 reduce=true，
 *     组件据此把 duration 设 0（瞬时到位）；
 *   - cleanup：useGSAP 卸载/依赖变化时自动 revert（含 matchMedia 分支）。
 *
 * ## 空目标守卫（ctx.from / ctx.fromTo）
 * 面板首帧常处于 loading / 空数据态（数据行尚未挂载），此时对 `.stock-rank-card` 等选择器直接
 * `gsap.from(selector, …)` 会命中 0 个元素 → GSAP 打印 "target not found" 告警刷屏。故 build 回调
 * 一律经 ctx.from / ctx.fromTo 发 tween：它们先在 **scope 内** 解析目标（gsap.utils.toArray(target,
 * scope)，保持单一 scope 所有权——NewsPanel 与 PolicyPanel 共用 .stock-policy-item，必须各限本 scope），
 * 空目标静默跳过、非空时行为与 gsap.from/fromTo 完全一致（同一批 scope 内 DOM 顺序元素、同 vars、
 * 同 stagger）。数据挂载后 deps 变化触发 useGSAP revert + 重跑，届时目标存在，动画照常播放。
 *
 * 被 GSAP 逐帧接管的属性（transform/opacity）在对应 CSS 里禁止写 transition
 * （见 tests/animation-conflict.test.ts 登记）。可重复触发的 tween 一律 overwrite:'auto'。
 */

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';

// @gsap/react 插件模块级注册一次（启用 contextSafe / 自动 revert）
gsap.registerPlugin(useGSAP);

/** build 回调上下文 */
export interface StockIntroCtx {
  /** 是否 prefers-reduced-motion: reduce（true 时组件应把 duration 设 0） */
  reduce: boolean;
  /**
   * gsap.from 的空目标守卫版：在 scope 内把 target（选择器 / 元素 / 元素数组）解析为已存在的元素，
   * 空则静默跳过（不发 tween、不触发 GSAP "target not found" 告警），非空时等价 gsap.from(targets, vars)。
   */
  from: (target: gsap.DOMTarget, vars: gsap.TweenVars) => void;
  /** gsap.fromTo 的空目标守卫版，语义同 from（空目标跳过）。 */
  fromTo: (target: gsap.DOMTarget, fromVars: gsap.TweenVars, toVars: gsap.TweenVars) => void;
}

/**
 * 在给定 scope 内运行一段进场/变更动画，自带 matchMedia reduced-motion 分流 + 空目标守卫。
 *
 * @param scope   组件根 ref（限定 GSAP 选择器作用域）
 * @param build   构建 tween 的回调，收到 { reduce, from, fromTo }
 * @param deps    依赖数组；变化时先 revert 再重跑
 */
export function useStockIntro(
  scope: React.RefObject<HTMLElement | null>,
  build: (ctx: StockIntroCtx) => void,
  deps: unknown[] = [],
): void {
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(
        {
          reduce: '(prefers-reduced-motion: reduce)',
          normal: '(prefers-reduced-motion: no-preference)',
        },
        (context) => {
          const conditions = context.conditions as { reduce: boolean; normal: boolean };
          // scope 内解析目标（选择器/元素/数组统一走 gsap.utils.toArray，保持单一 scope 所有权）
          const resolve = (target: gsap.DOMTarget): Element[] =>
            gsap.utils.toArray<Element>(target, scope.current ?? undefined);
          build({
            reduce: conditions.reduce,
            from: (target, vars) => {
              const targets = resolve(target);
              if (targets.length > 0) { gsap.from(targets, vars); }
            },
            fromTo: (target, fromVars, toVars) => {
              const targets = resolve(target);
              if (targets.length > 0) { gsap.fromTo(targets, fromVars, toVars); }
            },
          });
        },
      );
    },
    { scope, dependencies: deps, revertOnUpdate: true },
  );
}
