/**
 * useStockIntro 空目标守卫单测（M5 修复回归）
 *
 * 背景：面板首帧常处于 loading / 空数据态，数据行尚未挂载。修复前 build 里直接
 * `gsap.from('.stock-rank-card', …)` 命中 0 元素 → GSAP 打印 "target not found" 告警刷屏。
 * 修复：build 一律经 ctx.from / ctx.fromTo 发 tween —— scope 内解析目标、空则静默跳过。
 *
 * 本测试验证：
 *   1. 目标不存在 → 不调 gsap.from / gsap.fromTo（守卫跳过，无告警）；
 *   2. 目标存在 → 照常调 gsap.from / gsap.fromTo；
 *   3. 解析严格限定在组件自身 scope 内（scope 外同名元素不被串台 —— NewsPanel 与
 *      PolicyPanel 共用 .stock-policy-item，跨 scope 解析会互相误动）。
 *
 * gsap.from / gsap.fromTo 在测试中被 spy 拦截（不跑真实 tween，符合项目「vitest 不做运行时动画测试」）；
 * gsap.utils.toArray（scope 内解析）走真实实现以验证守卫与作用域逻辑。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import gsap from 'gsap';
import { useStockIntro, type StockIntroCtx } from '../../src/stocks/animations';

/** 让 (prefers-reduced-motion: no-preference) 命中 → gsap.matchMedia 执行 build（reduce=false 分支） */
function installMatchMedia(): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('no-preference'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** 挂载一个带 scope、内含单个 .exists 元素的组件，build 由外部注入 */
function Harness({ build }: { build: (ctx: StockIntroCtx) => void }) {
  const scope = useRef<HTMLDivElement>(null);
  useStockIntro(scope, build, []);
  return (
    <div ref={scope} data-testid="scope">
      <span className="exists in-scope" />
    </div>
  );
}

describe('useStockIntro 空目标守卫', () => {
  let fromSpy: ReturnType<typeof vi.spyOn>;
  let fromToSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    installMatchMedia();
    fromSpy = vi.spyOn(gsap, 'from').mockImplementation(() => ({}) as gsap.core.Tween);
    fromToSpy = vi.spyOn(gsap, 'fromTo').mockImplementation(() => ({}) as gsap.core.Tween);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    fromSpy.mockRestore();
    fromToSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('目标不存在时 from 静默跳过（不调 gsap.from，无告警）', () => {
    render(<Harness build={({ from }) => { from('.missing', { opacity: 0 }); }} />);
    expect(fromSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('目标不存在时 fromTo 静默跳过（不调 gsap.fromTo）', () => {
    render(<Harness build={({ fromTo }) => { fromTo('.missing', { scaleX: 0 }, { scaleX: 1 }); }} />);
    expect(fromToSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('目标存在时 from 照常发 tween，且仅解析本 scope 内元素（scope 外同名不串台）', () => {
    // scope 外再放一个同名 .exists —— 验证 scope 解析不会误选到它
    const outside = document.createElement('span');
    outside.className = 'exists out-of-scope';
    document.body.appendChild(outside);

    render(<Harness build={({ from }) => { from('.exists', { opacity: 0, y: 12 }); }} />);

    expect(fromSpy).toHaveBeenCalledTimes(1);
    const [targets, vars] = fromSpy.mock.calls[0] as [Element[], gsap.TweenVars];
    expect(Array.isArray(targets)).toBe(true);
    expect(targets).toHaveLength(1);
    expect(targets[0].className).toContain('in-scope');
    expect(targets[0].className).not.toContain('out-of-scope');
    expect(vars).toMatchObject({ opacity: 0, y: 12 });

    outside.remove();
  });

  it('目标存在时 fromTo 照常发 tween（解析出本 scope 内元素）', () => {
    render(<Harness build={({ fromTo }) => {
      fromTo('.exists', { scaleX: 0 }, { scaleX: 1 });
    }} />);
    expect(fromToSpy).toHaveBeenCalledTimes(1);
    const [targets, fromVars, toVars] = fromToSpy.mock.calls[0] as [Element[], gsap.TweenVars, gsap.TweenVars];
    expect(targets).toHaveLength(1);
    expect(targets[0].className).toContain('in-scope');
    expect(fromVars).toMatchObject({ scaleX: 0 });
    expect(toVars).toMatchObject({ scaleX: 1 });
  });

  it('元素引用（非选择器）目标存在时照常发 tween（视图根 scopeRef.current 用法）', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    render(<Harness build={({ from }) => { from(el, { opacity: 0 }); }} />);
    expect(fromSpy).toHaveBeenCalledTimes(1);
    const [targets] = fromSpy.mock.calls[0] as [Element[]];
    expect(targets).toHaveLength(1);
    expect(targets[0]).toBe(el);
    el.remove();
  });
});
