/**
 * scrollMessageIntoView —— 消息定位滚动（点回复引用块 / 全局搜索结果跳转共用同一条通路）
 *
 * 本文件守三件事：
 *
 * 1. **只有消息列表容器自己滚**，祖先容器纹丝不动。
 *    回归背景：定位原来用 `el.scrollIntoView({ block: 'center' })`，它会**沿祖先链冒泡**，
 *    真机表现为「整个 App 被顶上去」（左侧会话栏头像只剩半截、群聊顶栏被推出可视区）。
 *    （见 .claude/rules/common.md「element.scrollIntoView() 会沿祖先链冒泡」）
 *
 * 2. **显式断言 scrollIntoView 从未被调用** —— jsdom 里它默认是 undefined，
 *    代码若误回退到 scrollIntoView 会是静默 noop，不显式断言就防不住回退
 *    （见 .claude/rules/frontend-test.md「防回退断言：替换 scrollIntoView 后必须显式断言它未被调用」）。
 *
 * 3. **滚动是平滑过渡**（`container.scrollTo({ behavior: 'smooth' })`，作用在指定容器上、不冒泡），
 *    且系统「减弱动效」开启时降级为瞬时（直接写 scrollTop）。
 *    jsdom 未实现 `Element.prototype.scrollTo`（实测 typeof === 'undefined'），故本文件挂桩；
 *    桩会把 `top` 写进 `scrollTop`，这样「最终落点」与「走没走平滑通路」两件事都能各自断言。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scrollMessageIntoView } from '../../src/chat/shared/scrollMessageIntoView';

/** 给元素钉死一个 getBoundingClientRect（jsdom 无布局，全返回 0） */
function stubRect(el: HTMLElement, top: number, height: number) {
  el.getBoundingClientRect = () => ({
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;
}

/** 覆盖 matchMedia，模拟系统「减弱动效」开关（setup.ts 全局桩默认 matches:false） */
function setReducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList);
}

/**
 * 搭一棵与真实结构同形的 DOM：
 *   ancestor(.chat-messages 外层，可滚 —— 就是被误滚的那一层)
 *     └── container(.chat-messages-container，唯一该滚的那一层)
 *           └── bubble([data-message-uuid])
 *
 * 容器视口：top=100 height=400 → 中心 300。
 */
function mountTree(opts: { messageTop: number; messageHeight: number; insideContainer?: boolean }) {
  const ancestor = document.createElement('div');
  const container = document.createElement('div');
  container.className = 'chat-messages-container chat-messages-container--reverse';
  const bubble = document.createElement('div');
  bubble.dataset.messageUuid = 'msg-target';

  const sibling = document.createElement('div');
  sibling.dataset.messageUuid = 'msg-other';

  container.appendChild(sibling);
  (opts.insideContainer === false ? ancestor : container).appendChild(bubble);
  ancestor.appendChild(container);
  document.body.appendChild(ancestor);

  stubRect(container, 100, 400);
  stubRect(bubble, opts.messageTop, opts.messageHeight);
  stubRect(sibling, 0, 10);

  const scrollIntoViewSpy = vi.fn();
  // jsdom 未实现 scrollIntoView（默认 undefined）→ 直接赋值即可捕获误回退
  bubble.scrollIntoView = scrollIntoViewSpy;
  ancestor.scrollIntoView = scrollIntoViewSpy;
  container.scrollIntoView = scrollIntoViewSpy;

  // jsdom 同样未实现 Element.prototype.scrollTo → 挂桩；桩落实 top 到 scrollTop，
  // 便于同时断言「走了平滑通路」和「落点算对了」。挂在两层上，谁被调用一目了然。
  const scrollToSpy = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
    if (typeof options?.top === 'number') {
      this.scrollTop = options.top;
    }
  });
  container.scrollTo = scrollToSpy as unknown as HTMLElement['scrollTo'];
  ancestor.scrollTo = scrollToSpy as unknown as HTMLElement['scrollTo'];

  return { ancestor, container, bubble, scrollIntoViewSpy, scrollToSpy };
}

describe('scrollMessageIntoView', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('目标在容器下方：平滑滚消息列表容器，祖先容器不动，且不走 scrollIntoView', () => {
    // 元素中心 = 700 + 50/2 = 725；容器中心 = 100 + 400/2 = 300 → 需要 +425
    const { ancestor, container, scrollIntoViewSpy, scrollToSpy } = mountTree({
      messageTop: 700,
      messageHeight: 50,
    });

    const ok = scrollMessageIntoView('msg-target');

    expect(ok).toBe(true);
    // 平滑：作用在消息列表容器自己身上，behavior 必须是 smooth（瞬时跳会让这条翻红）
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 425, behavior: 'smooth' });
    expect(scrollToSpy.mock.instances[0]).toBe(container);
    expect(container.scrollTop).toBe(425);
    // 祖先容器纹丝不动 —— 这正是「整个 App 被顶上去」的判据
    expect(ancestor.scrollTop).toBe(0);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('目标在容器上方：目标位为负（column-reverse 合法），同样只动容器自己', () => {
    // 元素中心 = -100 + 40/2 = -80；容器中心 300 → 需要 -380
    const { ancestor, container, scrollIntoViewSpy, scrollToSpy } = mountTree({
      messageTop: -100,
      messageHeight: 40,
    });

    expect(scrollMessageIntoView('msg-target')).toBe(true);
    // column-reverse 下 scrollTop 取值区间是 [-(scrollHeight-clientHeight), 0]，
    // 负的绝对目标位是合法值（同 useScrollKeyboardControls 的 Home 键：scrollTop = -(...)）
    expect(scrollToSpy).toHaveBeenCalledWith({ top: -380, behavior: 'smooth' });
    expect(container.scrollTop).toBe(-380);
    expect(ancestor.scrollTop).toBe(0);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('目标位以当前 scrollTop 为基准换算：column-reverse 下 scrollTop 为负也成立（符号无关）', () => {
    const { container, scrollIntoViewSpy, scrollToSpy } = mountTree({ messageTop: 700, messageHeight: 50 });
    container.scrollTop = -250;

    expect(scrollMessageIntoView('msg-target')).toBe(true);
    // -250 + 425 —— 绝对目标位由「当前 scrollTop + 增量」算出，故不依赖 scrollTop 的符号约定
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 175, behavior: 'smooth' });
    expect(container.scrollTop).toBe(175);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('系统「减弱动效」开启：降级为瞬时定位，不走平滑通路', () => {
    setReducedMotion(true);
    const { ancestor, container, scrollIntoViewSpy, scrollToSpy } = mountTree({
      messageTop: 700,
      messageHeight: 50,
    });

    expect(scrollMessageIntoView('msg-target')).toBe(true);
    // 瞬时：直接写 scrollTop，绝不能发起 smooth 滚动
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(container.scrollTop).toBe(425);
    expect(ancestor.scrollTop).toBe(0);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('DOM 里没有这条消息：返回 false，谁都不滚', () => {
    const { ancestor, container, scrollIntoViewSpy, scrollToSpy } = mountTree({
      messageTop: 700,
      messageHeight: 50,
    });

    expect(scrollMessageIntoView('msg-not-rendered')).toBe(false);
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(container.scrollTop).toBe(0);
    expect(ancestor.scrollTop).toBe(0);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('消息不在消息列表容器内（结构异常）：返回 false，不去滚任何祖先', () => {
    const { ancestor, container, scrollIntoViewSpy, scrollToSpy } = mountTree({
      messageTop: 700,
      messageHeight: 50,
      insideContainer: false,
    });

    expect(scrollMessageIntoView('msg-target')).toBe(false);
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(container.scrollTop).toBe(0);
    expect(ancestor.scrollTop).toBe(0);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  // 上面的用例已用 spy 守住 helper 自身不回退到 scrollIntoView；
  // useMainPage 这条通路没有被组件测试渲染到（整棵 hook 依赖树太重），
  // 所以补一条静态守卫，防止有人把 scrollIntoView 重新内联回 hook 里。
  it('防回退静态守卫：useMainPage 不得再内联 scrollIntoView 调用', () => {
    const useMainPageSource = readFileSync(
      resolve(__dirname, '../../src/hooks/useMainPage.ts'),
      'utf-8',
    );

    expect(useMainPageSource).not.toMatch(/\.scrollIntoView\s*\(/);
    // 正对照：确认扫到的确实是目标文件、且定位走的是本模块（防止路径写错导致空串恒过）
    expect(useMainPageSource).toContain('scrollMessageIntoView(targetId)');
  });

  // 单一所有权（.claude/rules/animation.md 规则一）：平滑与否由本模块按 behavior 逐次决定，
  // CSS 不得在消息列表容器上声明 scroll-behavior —— 否则「减弱动效」那条瞬时分支
  //（直接写 scrollTop）会被 CSS 悄悄变成平滑，降级失效。
  it('单一所有权静态守卫：消息列表容器的 CSS 不得声明 scroll-behavior', () => {
    /** 取出所有「选择器里含 needle」的规则体（扁平规则，够用） */
    const ruleBodiesFor = (css: string, needle: string): string[] => {
      const bodies: string[] = [];
      const re = /([^{}]+)\{([^{}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(css)) !== null) {
        if (m[1].includes(needle)) {
          bodies.push(m[2]);
        }
      }
      return bodies;
    };

    const files = ['../../src/styles/pages/main.css', '../../src/styles/mobile/chat-view.css'];
    let scanned = 0;
    for (const rel of files) {
      const css = readFileSync(resolve(__dirname, rel), 'utf-8');
      const bodies = ruleBodiesFor(css, '.chat-messages-container');
      // 正对照：确实扫到了该容器的规则，否则「零命中恒过」是假测试
      expect(bodies.length).toBeGreaterThan(0);
      scanned += bodies.length;
      for (const body of bodies) {
        expect(body).not.toMatch(/scroll-behavior/);
      }
    }
    expect(scanned).toBeGreaterThan(1);
  });
});
