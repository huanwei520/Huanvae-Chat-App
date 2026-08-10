/**
 * scrollMessageIntoView —— 消息定位滚动（点回复引用块 / 全局搜索结果跳转共用同一条通路）
 *
 * 回归背景：定位原来用 `el.scrollIntoView({ block: 'center' })`，它会**沿祖先链冒泡**，
 * 让每一个可滚祖先都把目标元素往自己的可视区里对齐 —— 真机表现为「整个 App 被顶上去」：
 * 左侧会话栏最上面的头像只剩半截、群聊顶栏被推出可视区。
 * （见 .claude/rules/common.md「element.scrollIntoView() 会沿祖先链冒泡」）
 *
 * 因此本文件断言两件事：
 * 1. **只有消息列表容器自己**的 scrollTop 变了，祖先容器纹丝不动；
 * 2. **显式断言 scrollIntoView 从未被调用** —— jsdom 里它默认是 undefined，
 *    代码若误回退到 scrollIntoView 会是静默 noop，不显式断言就防不住回退
 *    （见 .claude/rules/frontend-test.md「防回退断言：替换 scrollIntoView 后必须显式断言它未被调用」）。
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

  return { ancestor, container, bubble, scrollIntoViewSpy };
}

describe('scrollMessageIntoView', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('目标在容器下方：只滚消息列表容器，祖先容器不动，且不走 scrollIntoView', () => {
    // 元素中心 = 700 + 50/2 = 725；容器中心 = 100 + 400/2 = 300 → 需要 +425
    const { ancestor, container, scrollIntoViewSpy } = mountTree({ messageTop: 700, messageHeight: 50 });

    const ok = scrollMessageIntoView('msg-target');

    expect(ok).toBe(true);
    expect(container.scrollTop).toBe(425);
    // 祖先容器纹丝不动 —— 这正是「整个 App 被顶上去」的判据
    expect(ancestor.scrollTop).toBe(0);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('目标在容器上方：增量为负，同样只动容器自己', () => {
    // 元素中心 = -100 + 40/2 = -80；容器中心 300 → 需要 -380
    const { ancestor, container, scrollIntoViewSpy } = mountTree({ messageTop: -100, messageHeight: 40 });

    expect(scrollMessageIntoView('msg-target')).toBe(true);
    expect(container.scrollTop).toBe(-380);
    expect(ancestor.scrollTop).toBe(0);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('基于当前 scrollTop 做增量：column-reverse 下 scrollTop 为负也成立（符号无关）', () => {
    const { container, scrollIntoViewSpy } = mountTree({ messageTop: 700, messageHeight: 50 });
    container.scrollTop = -250;

    expect(scrollMessageIntoView('msg-target')).toBe(true);
    // -250 + 425
    expect(container.scrollTop).toBe(175);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('DOM 里没有这条消息：返回 false，谁都不滚', () => {
    const { ancestor, container, scrollIntoViewSpy } = mountTree({ messageTop: 700, messageHeight: 50 });

    expect(scrollMessageIntoView('msg-not-rendered')).toBe(false);
    expect(container.scrollTop).toBe(0);
    expect(ancestor.scrollTop).toBe(0);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('消息不在消息列表容器内（结构异常）：返回 false，不去滚任何祖先', () => {
    const { ancestor, container, scrollIntoViewSpy } = mountTree({
      messageTop: 700,
      messageHeight: 50,
      insideContainer: false,
    });

    expect(scrollMessageIntoView('msg-target')).toBe(false);
    expect(container.scrollTop).toBe(0);
    expect(ancestor.scrollTop).toBe(0);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  // 上面 5 个用例已用 spy 守住 helper 自身不回退到 scrollIntoView；
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
});
