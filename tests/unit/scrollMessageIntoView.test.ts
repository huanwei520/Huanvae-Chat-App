/**
 * scrollMessageIntoView —— 消息定位滚动（点回复引用块 / 会话内搜索 / 全局搜索共用同一条通路）
 *
 * 本文件守五件事：
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
 * 3. **定位一律瞬时到位，绝不发起平滑滚动**（不调 `container.scrollTo`）。
 *    定位这条通路必然先做「整段替换」（locate*Message 的 setMessages），
 *    `behavior:'smooth'` 的动画会被随后任何一次 scrollTop 写入打断、停在半路。
 *    jsdom 未实现 `Element.prototype.scrollTo`（实测 typeof === 'undefined'），故本文件挂桩 ——
 *    挂桩才能把「有没有走平滑通路」变成可断言的事实，而不是靠"没报错"蒙混。
 *
 * 4. **定位落定窗口**（isLocateScrollSettling）：程序化滚动自己派发的 scroll 事件不得触发
 *    列表的 auto-loadNewer（否则一次接 50 条 + prepend 保位改写 scrollTop，与刚落定的定位抢位）。
 *
 * 5. 两条静态守卫 + 两条列表侧接线（下方各 describe 自带说明）。
 *
 * ⚠️ 结构性盲区（.claude/rules/frontend-test.md「滚动 / 布局相关行为 vitest 结构性测不出」）：
 * jsdom 没有布局引擎，真实 scrollHeight / clientHeight 恒 0，这里的落点数值全靠 stubRect 喂。
 * 本文件能守住的是**调用契约**（滚谁、瞬时还是平滑、开不开落定窗口），
 * 「相册第 N 格是不是真的落在视口中心」这类**数值正确性必须真机复核**。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  scrollMessageIntoView,
  isLocateScrollSettling,
  LOCATE_SCROLL_SETTLE_MS,
} from '../../src/chat/shared/scrollMessageIntoView';

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

  // jsdom 同样未实现 Element.prototype.scrollTo → 挂桩。桩若被调用即代表走了平滑通路，
  // 而定位路要求一律瞬时（直接写 scrollTop），故所有用例都断言它 **never called**。
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

  it('目标在容器下方：瞬时滚消息列表容器，祖先容器不动，且既不走 scrollIntoView 也不走平滑滚动', () => {
    // 元素中心 = 700 + 50/2 = 725；容器中心 = 100 + 400/2 = 300 → 需要 +425
    const { ancestor, container, scrollIntoViewSpy, scrollToSpy } = mountTree({
      messageTop: 700,
      messageHeight: 50,
    });

    const ok = scrollMessageIntoView('msg-target');

    expect(ok).toBe(true);
    expect(container.scrollTop).toBe(425);
    // 瞬时：直接写 scrollTop。发起平滑滚动会让这条翻红 —— 平滑动画会被随后的 scrollTop 写入打断
    expect(scrollToSpy).not.toHaveBeenCalled();
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
    expect(container.scrollTop).toBe(-380);
    expect(ancestor.scrollTop).toBe(0);
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('目标位以当前 scrollTop 为基准换算：column-reverse 下 scrollTop 为负也成立（符号无关）', () => {
    const { container, scrollIntoViewSpy, scrollToSpy } = mountTree({ messageTop: 700, messageHeight: 50 });
    container.scrollTop = -250;

    expect(scrollMessageIntoView('msg-target')).toBe(true);
    // -250 + 425 —— 绝对目标位由「当前 scrollTop + 增量」算出，故不依赖 scrollTop 的符号约定
    expect(container.scrollTop).toBe(175);
    expect(scrollToSpy).not.toHaveBeenCalled();
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

  it('相册格子也能被定位：锚点不必是消息行（折叠后组内成员只剩格子这一个节点）', () => {
    const { container } = mountTree({ messageTop: 700, messageHeight: 50 });
    // 相册气泡：行上无锚点（AlbumMessage 把寻址交给格子），格子各自带一个
    const albumRow = document.createElement('div');
    albumRow.className = 'message-row';
    const cell = document.createElement('div');
    cell.className = 'album-cell';
    cell.dataset.messageUuid = 'album-item-3';
    stubRect(cell, 900, 90);
    albumRow.appendChild(cell);
    container.appendChild(albumRow);

    // 格子中心 = 900 + 90/2 = 945；容器中心 300 → +645
    expect(scrollMessageIntoView('album-item-3')).toBe(true);
    expect(container.scrollTop).toBe(645);
  });
});

// 落定窗口用 Date.now 判定；这里用 spy 精确控制时间，并把基准取在**远大于真实 now** 的将来，
// 以免同文件其它用例遗留的落定截止时刻（真实时钟 + 400ms）污染判定。
const SETTLE_BASE = 4_000_000_000_000;

describe('scrollMessageIntoView — 定位落定窗口（抑制 auto-loadNewer 的判据）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('定位成功才开窗口，且到期即自动关闭（不是永久开着）', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(SETTLE_BASE);
    mountTree({ messageTop: 700, messageHeight: 50 });

    expect(isLocateScrollSettling()).toBe(false);

    expect(scrollMessageIntoView('msg-target')).toBe(true);
    expect(isLocateScrollSettling()).toBe(true);

    nowSpy.mockReturnValue(SETTLE_BASE + LOCATE_SCROLL_SETTLE_MS - 1);
    expect(isLocateScrollSettling()).toBe(true);

    nowSpy.mockReturnValue(SETTLE_BASE + LOCATE_SCROLL_SETTLE_MS);
    expect(isLocateScrollSettling()).toBe(false);
  });

  it('定位失败（DOM 里没有该消息）不开窗口 —— 没滚过就没有自己派发的 scroll 事件要挡', () => {
    // 基准再往后推，屏蔽上一个用例开出的窗口
    vi.spyOn(Date, 'now').mockReturnValue(SETTLE_BASE + 1_000_000);
    mountTree({ messageTop: 700, messageHeight: 50 });

    expect(scrollMessageIntoView('msg-not-rendered')).toBe(false);
    expect(isLocateScrollSettling()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 静态守卫：下面这些通路没有被组件测试渲染到（useMainPage / 两条消息列表的依赖树太重），
// 只能扫源码钉死接线。每条都做过 node 变异验证（删掉目标 token 必须从 PASS 翻 FAIL）。
// ---------------------------------------------------------------------------

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', '..', rel), 'utf-8');
}

/** 取出 [start, end) 之间那一段源码；两个锚点都必须命中（否则是判据坏了，不是代码坏了） */
function sliceBetween(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b);
}

describe('静态守卫 —— useMainPage 的定位 effect', () => {
  const USE_MAIN_PAGE = read('src/hooks/useMainPage.ts');
  const LOCATE_EFFECT = sliceBetween(
    USE_MAIN_PAGE,
    'if (!pendingScrollToMessageId || !chatTarget)',
    'void run();',
  );

  it('正对照：切出来的确实是定位 effect（含本模块的调用）', () => {
    expect(LOCATE_EFFECT.length).toBeGreaterThan(200);
    expect(LOCATE_EFFECT).toContain('scrollMessageIntoView(targetId)');
  });

  it('不得再内联 scrollIntoView 调用（防回退到"顶起整个 App"的老写法）', () => {
    expect(USE_MAIN_PAGE).not.toMatch(/\.scrollIntoView\s*\(/);
  });

  it('必须双 rAF 后再滚：单帧滚的可能是尚未提交的旧 DOM', () => {
    const rafCount = (LOCATE_EFFECT.match(/requestAnimationFrame\(/g) ?? []).length;
    expect(rafCount).toBe(2);
    // 且是嵌套而非并列（外层回调体里再排一帧）
    expect(LOCATE_EFFECT).toMatch(/requestAnimationFrame\(\(\) => \{[\s\S]{0,200}?requestAnimationFrame\(\(\) => \{/);
  });

  it('两条失败路必须用两句不同文案：DB 没有 vs 取到了但 DOM 里没有', () => {
    // 「本地库里没有」那一支（locate*Message 返回 false）——块内有界，不跨出 if 块
    expect(LOCATE_EFFECT).toMatch(
      /if \(!ok\) \{[^}]*setMessageJumpNotice\(MESSAGE_JUMP_NOT_FOUND_NOTICE\)[^}]*\}/,
    );
    // 「渲染层没找到节点」那一支用的是另一个常量
    expect(LOCATE_EFFECT).toMatch(/setMessageJumpNotice\(MESSAGE_JUMP_RENDER_MISS_NOTICE\)/);
    // 🔴 关键：NOT_FOUND 在全文件只允许出现两次（声明 + 上面那一处使用）。
    // 谁把它重新用到渲染层失败那一支上，这条立刻翻红。
    expect((USE_MAIN_PAGE.match(/MESSAGE_JUMP_NOT_FOUND_NOTICE/g) ?? []).length).toBe(2);
  });

  it('两句文案本身必须不同，且渲染层那句不得声称"不在本地记录"', () => {
    const notFound = /const MESSAGE_JUMP_NOT_FOUND_NOTICE = '([^']+)';/.exec(USE_MAIN_PAGE);
    const renderMiss = /const MESSAGE_JUMP_RENDER_MISS_NOTICE = '([^']+)';/.exec(USE_MAIN_PAGE);
    expect(notFound).not.toBeNull();
    expect(renderMiss).not.toBeNull();
    expect(renderMiss![1]).not.toBe(notFound![1]);
    expect(renderMiss![1]).not.toMatch(/本地记录|本地数据库/);
  });
});

describe('静态守卫 —— 两条消息列表在定位落定窗口内不触发 auto-loadNewer', () => {
  const LISTS: Array<[string, string]> = [
    ['私聊', 'src/chat/friend/ChatMessages.tsx'],
    ['群聊', 'src/chat/group/GroupChatMessages.tsx'],
  ];

  it.each(LISTS)('%s 列表 import 了落定判据', (_label, rel) => {
    expect(read(rel)).toMatch(
      /import\s*\{[^}]*\bisLocateScrollSettling\b[^}]*\}\s*from\s*'\.\.\/shared\/scrollMessageIntoView'/,
    );
  });

  it.each(LISTS)('%s 列表的 loadNewer 分支入口处就挡住落定窗口', (_label, rel) => {
    // 邻接锚定：守卫必须紧贴在 onLoadNewer() 之前，挪走 / 删掉都会翻红
    expect(read(rel)).toMatch(
      /Math\.abs\(scrollTop\)\s*<\s*threshold\)\s*\{\s*if\s*\(isLocateScrollSettling\(\)\)\s*\{\s*return;\s*\}\s*onLoadNewer\(\);/,
    );
  });
});

// 单一所有权（.claude/rules/animation.md 规则一）：定位一律瞬时（直接写 scrollTop），
// CSS 不得在消息列表容器上声明 scroll-behavior —— 否则这次直接写入会被 CSS 悄悄变成平滑动画，
// 又会被随后的 scrollTop 写入打断，「停在半路」那个真机缺陷立刻回来。
describe('静态守卫 —— 消息列表容器的 CSS 不得声明 scroll-behavior', () => {
  it('两份样式表都不含该声明', () => {
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

    const files = ['src/styles/pages/main.css', 'src/styles/mobile/chat-view.css'];
    let scanned = 0;
    for (const rel of files) {
      const bodies = ruleBodiesFor(read(rel), '.chat-messages-container');
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
