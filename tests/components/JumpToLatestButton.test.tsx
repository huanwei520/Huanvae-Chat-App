/**
 * 「回到最新」浮动按钮 —— 行为 + 接线契约
 *
 * 消息列表容器是 `flex-direction: column-reverse`，**滚动原点在底部**：
 * `scrollTop === 0` 就是最新一条，往更旧翻是负值。所以「回到底部」= 把 scrollTop 滚回 0，
 * 而不是滚到 scrollHeight。本文件的所有坐标都按这个约定写。
 *
 * 守四件事：
 *
 * 1. **显隐由真实滚动位置决定**：贴底不出现、翻上去才浮出、滚回来又消失。
 *    这是本功能唯一的产品语义，必须验行为而不是验某个 class 字面量。
 * 2. **点击真的滚动了容器**，且**只滚它自己**（祖先纹丝不动）。
 * 3. **绝不走 `scrollIntoView`**：它会沿祖先链冒泡把整个 App 外壳顶上去
 *    （见 .claude/rules/common.md）。jsdom 里 `scrollIntoView` 默认是 undefined，
 *    误回退是**静默 noop**、不报错 —— 只有显式断言「从未被调用」拦得住
 *    （见 .claude/rules/frontend-test.md「防回退断言」）。
 * 4. **`onJumpToLatest` 存在时先 await 它、再滚**，且滚动推迟到**两帧之后**（`await` 只等到
 *    上层 `setState` 被调用、React 尚未提交 ⇒ 提前滚就是滚旧 DOM，真机实测踩过）。
 *    「回调之后到底滚不滚」这一条是**真机实测证伪过一次的**：早期实现只调回调不滚，
 *    结果数据换成了最新一段、容器还停在原处。所以这里的契约是「必滚，只是要晚两帧」。
 *
 * jsdom 未实现 `Element.prototype.scrollTo` → 本文件挂桩（桩把 top 落到 scrollTop），
 * 这样「走没走平滑通路」与「最终落点」两件事能各自断言。手法同
 * tests/unit/scrollMessageIntoView.test.ts。
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  JumpToLatestButton,
  JUMP_TO_LATEST_THRESHOLD_PX,
} from '../../src/chat/shared/JumpToLatestButton';

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
 * 与真实结构同形的宿主：
 *   ancestor(.chat-messages 外层，就是会被 scrollIntoView 误滚的那一层)
 *     ├── container(.chat-messages-container，唯一该滚的那一层)
 *     └── JumpToLatestButton（容器的**兄弟**，锚到 ancestor）
 */
function Harness({ onJumpToLatest, forceVisible}: { onJumpToLatest?: () => void; forceVisible?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div data-testid="ancestor">
      <div
        data-testid="container"
        ref={containerRef}
        className="chat-messages-container chat-messages-container--reverse"
      />
      <JumpToLatestButton
        containerRef={containerRef}
        onJumpToLatest={onJumpToLatest}
        forceVisible={forceVisible}
      />
    </div>
  );
}

interface Mounted {
  ancestor: HTMLElement;
  container: HTMLElement;
  scrollToSpy: ReturnType<typeof vi.fn>;
  scrollIntoViewSpy: ReturnType<typeof vi.fn>;
}

function mountHarness(onJumpToLatest?: () => void, forceVisible = false): Mounted {
  render(<Harness onJumpToLatest={onJumpToLatest} forceVisible={forceVisible} />);
  const ancestor = screen.getByTestId('ancestor');
  const container = screen.getByTestId('container');

  // jsdom 未实现 scrollIntoView（默认 undefined）→ 直接赋值即可捕获误回退
  const scrollIntoViewSpy = vi.fn();
  container.scrollIntoView = scrollIntoViewSpy;
  ancestor.scrollIntoView = scrollIntoViewSpy;

  // jsdom 未实现 Element.prototype.scrollTo → 挂桩；桩落实 top 到 scrollTop。
  // 两层都挂，谁被调用一目了然（祖先被滚 = 冒泡回归）。
  const scrollToSpy = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
    if (typeof options?.top === 'number') {
      this.scrollTop = options.top;
    }
  });
  container.scrollTo = scrollToSpy as unknown as HTMLElement['scrollTo'];
  ancestor.scrollTo = scrollToSpy as unknown as HTMLElement['scrollTo'];

  return { ancestor, container, scrollToSpy, scrollIntoViewSpy };
}

/** 把容器滚到离底 distance 像素（column-reverse：往更旧翻是负值），并触发 scroll 事件 */
function scrollAwayFromBottom(container: HTMLElement, distance: number) {
  container.scrollTop = -distance;
  fireEvent.scroll(container);
}

/**
 * 排空微任务队列，但**不推进定时器**。
 *
 * jsdom（vitest 默认 `pretendToBeVisual: true`）的 `requestAnimationFrame` 由定时器驱动，
 * 而微任务队列恒在任何定时器之前排空 —— 所以「排空微任务之后 rAF 尚未触发」在这里是
 * **确定性**的，不是竞态：整条 await 链全是微任务，中途不会把控制权交回事件循环。
 * 用它把「回调 await 完的那一刻」与「两帧之后」这两个时点分开断言。
 *
 * 轮数只需盖过被测实现的 await 深度（handleClick 那条链是 1–2 轮），取 5 留余量；
 * 多转几轮也不会误推进帧 —— 微任务转不到定时器上去。
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

const BUTTON_NAME = '回到最新消息';

describe('JumpToLatestButton —— 显隐由滚动位置决定', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('贴底（scrollTop = 0）时不出现', () => {
    mountHarness();
    expect(screen.queryByRole('button', { name: BUTTON_NAME })).not.toBeInTheDocument();
  });

  it('离底超过阈值 → 浮出；再滚回贴底 → 消失', async () => {
    const { container } = mountHarness();

    scrollAwayFromBottom(container, JUMP_TO_LATEST_THRESHOLD_PX + 240);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: BUTTON_NAME })).toBeInTheDocument();
    });

    // 滚回底部（scrollTop = 0）→ 退场。AnimatePresence 卸载是异步的，消失断言必须入 waitFor
    // （见 .claude/rules/frontend-test.md「AnimatePresence 内组件的『消失』断言必须入 waitFor」）
    container.scrollTop = 0;
    fireEvent.scroll(container);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: BUTTON_NAME })).not.toBeInTheDocument();
    });
  });

  it('刚好等于阈值时不出现（严格大于才浮出，避免贴底附近抖动）', () => {
    const { container } = mountHarness();

    scrollAwayFromBottom(container, JUMP_TO_LATEST_THRESHOLD_PX);
    expect(screen.queryByRole('button', { name: BUTTON_NAME })).not.toBeInTheDocument();

    scrollAwayFromBottom(container, JUMP_TO_LATEST_THRESHOLD_PX + 1);
    expect(screen.getByRole('button', { name: BUTTON_NAME })).toBeInTheDocument();
  });

  it('scrollTop 为正号的引擎同样判定为「离底」（Math.abs，符号无关）', () => {
    const { container } = mountHarness();

    container.scrollTop = JUMP_TO_LATEST_THRESHOLD_PX + 240;
    fireEvent.scroll(container);

    expect(screen.getByRole('button', { name: BUTTON_NAME })).toBeInTheDocument();
  });
});

describe('JumpToLatestButton —— 点击滚动（无 onJumpToLatest 时的默认通路）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('点击后容器 scrollTop 真的回到 0，且只动容器自己、不走 scrollIntoView', async () => {
    const { ancestor, container, scrollToSpy, scrollIntoViewSpy } = mountHarness();

    scrollAwayFromBottom(container, 800);
    expect(container.scrollTop).toBe(-800);

    fireEvent.click(await screen.findByRole('button', { name: BUTTON_NAME }));

    // handleClick 是 async（要 await 上层可能的重载回调），滚动落在微任务里 ⇒ 断言必须等
    await waitFor(() => expect(scrollToSpy).toHaveBeenCalledTimes(1));

    // 平滑通路：作用在消息列表容器自己身上，behavior 必须是 smooth
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(scrollToSpy.mock.instances[0]).toBe(container);
    // 落点：column-reverse 下 scrollTop = 0 就是最新一条
    expect(container.scrollTop).toBe(0);
    // 祖先纹丝不动 —— 这正是「整个 App 被顶上去」的判据
    expect(ancestor.scrollTop).toBe(0);
    // 防回退：jsdom 里 scrollIntoView 是静默 noop，只有这条断言拦得住误回退
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('系统「减弱动效」开启：直接写 scrollTop 瞬时到位，不发起平滑滚动', async () => {
    setReducedMotion(true);
    const { ancestor, container, scrollToSpy, scrollIntoViewSpy } = mountHarness();

    scrollAwayFromBottom(container, 800);
    fireEvent.click(await screen.findByRole('button', { name: BUTTON_NAME }));

    expect(scrollToSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(container.scrollTop).toBe(0));
    expect(ancestor.scrollTop).toBe(0);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });
});

describe('JumpToLatestButton —— onJumpToLatest 接管', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * 钉的是**滚动的时点**：必须推迟到「两帧之后」，不许在回调 await 完的那个微任务里就滚。
   *
   * 真机实测过的失败形态：`await onJumpToLatest()` 只等到上层 `setState` **被调用**，
   * React 尚未提交渲染 —— 此刻滚的是**旧 DOM**，等新列表渲染出来位置又不对了
   * （画面停在半路）。实现用双 rAF 把滚动压到「提交 + 绘制」之后（JumpToLatestButton.tsx:128-134）。
   *
   * 本文件下方 describe「接管回调之后仍必须滚回底部（真机实测回归）」守「**确实**滚到了
   * scrollTop=0」这一半；这里守的是它守不到的另一半 —— **不许提前滚**。
   * （变异实测：只去掉双 rAF、保留 `scrollTop = 0`，那个 describe 的两条**照样全绿**，
   *   只有本条翻红。两条合起来才是完整契约。）
   */
  it('传了 onJumpToLatest：先 await 回调，且滚动推迟到两帧之后（不在微任务里抢跑滚旧 DOM）', async () => {
    const onJumpToLatest = vi.fn();
    const { container, scrollToSpy, scrollIntoViewSpy } = mountHarness(onJumpToLatest);

    scrollAwayFromBottom(container, 800);
    fireEvent.click(await screen.findByRole('button', { name: BUTTON_NAME }));

    // 微任务排空 = 回调已 await 完、rAF 已挂上，但帧还没到 ⇒ 此刻**绝不许**已经滚了。
    // 把实现里的双 rAF 去掉（await 完直接滚）→ 这条立刻翻红。
    await flushMicrotasks();
    expect(onJumpToLatest).toHaveBeenCalledTimes(1);
    expect(container.scrollTop).toBe(-800);

    // 两帧到齐后才落地。这一路是**瞬时**滚：不走平滑通路（smooth 会被随后的内容替换打断），
    // 更不碰会沿祖先链冒泡的 scrollIntoView。
    await waitFor(() => expect(container.scrollTop).toBe(0));
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });
});

/**
 * 接线契约（静态）：按钮必须挂在**滚动容器之外**。
 *
 * 为什么只能静态验：`.chat-messages-container` 是 overflow:auto 的滚动容器，
 * 绝对定位浮层若锚到它，会随内容一起滚走（见 .claude/rules/common.md
 * 「CSS 绝对定位浮层不能锚定到 overflow:auto 的父级」）。jsdom 不做布局、
 * 渲染测试看不出这个差别；而渲染整棵 ChatMessages 要拖起 store / Tauri invoke 全链，
 * mock 成本远高于它能防住的回归 —— 故与 tests/album-wiring.test.ts 同款，用静态契约钉死。
 */
describe('JumpToLatestButton —— 两条消息列表的接线契约（桌面 + 移动共用这两个组件）', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, '../../', rel), 'utf-8');

  const LISTS: [string, string][] = [
    ['私聊 ChatMessages', 'src/chat/friend/ChatMessages.tsx'],
    ['群聊 GroupChatMessages', 'src/chat/group/GroupChatMessages.tsx'],
  ];

  it.each(LISTS)('%s 渲染 JumpToLatestButton 并把容器 ref 交给它', (_name, file) => {
    const src = read(file);
    expect(src).toMatch(
      /import\s*\{[^}]*\bJumpToLatestButton\b[^}]*\}\s*from\s*'\.\.\/shared\/JumpToLatestButton'/,
    );
    // 块内有界：只看这一个标签内部，不跨出去 latch 到别处的同名属性
    expect(src).toMatch(/<JumpToLatestButton[^>]*containerRef=\{containerRef\}[^>]*\/>/);
  });

  it.each(LISTS)('%s 把 onJumpToLatest 透传下去（否则上层接管通路是死的）', (_name, file) => {
    const src = read(file);
    expect(src).toMatch(/<JumpToLatestButton[^>]*onJumpToLatest=\{onJumpToLatest\}[^>]*\/>/);
    // 该 prop 必须真从组件 props 解构出来，而不是引用了某个同名局部变量
    expect(src).toMatch(/^\s{2}onJumpToLatest,$/m);
  });

  it.each(LISTS)('%s 的按钮在滚动容器【之外】（放进去会随消息内容滚走）', (_name, file) => {
    const src = read(file);
    const buttonAt = src.indexOf('<JumpToLatestButton');
    const containerCloseAt = src.lastIndexOf('</motion.div>');
    // 正对照：两个锚点都真实存在，否则 -1 的比较会恒真变成假测试
    expect(buttonAt).toBeGreaterThan(-1);
    expect(containerCloseAt).toBeGreaterThan(-1);
    expect(buttonAt).toBeGreaterThan(containerCloseAt);
  });
});

describe('JumpToLatestButton —— 定位窗口态恒显（forceVisible）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * 窗口态下「滚到容器底」只是滚到了**这段历史窗口**的底，最新消息根本不在列表里。
   * 若仍按位置判据隐藏按钮，用户就在"看着底部、却回不到最新"的状态下失去唯一入口。
   */
  it('贴底时也照样显示（窗口的底 ≠ 最新）', () => {
    mountHarness(undefined, true);
    expect(screen.getByRole('button', { name: BUTTON_NAME })).toBeInTheDocument();
  });

  it('forceVisible=false 时仍由滚动位置决定（不影响常规会话）', () => {
    mountHarness(undefined, false);
    expect(screen.queryByRole('button', { name: BUTTON_NAME })).not.toBeInTheDocument();
  });
});

describe('JumpToLatestButton —— 接管回调之后仍必须滚回底部（真机实测回归）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * 真机实测过的反例：只调回调、不滚容器 ⇒ 数据换成最新一段了，容器却还停在原处。
   * 用户点了按钮，画面从「第 241 条」跳到「第 351 条」，而最新是第 400 条，按钮还挂着。
   * 这条断言就是钉死「回调之后必须滚」。
   */
  it('调完 onJumpToLatest 后把容器滚回 scrollTop=0', async () => {
    setReducedMotion(false); // 固定走平滑通路，免受相邻用例的 matchMedia 桩影响
    const onJump = vi.fn();
    const { container, scrollToSpy, scrollIntoViewSpy } = mountHarness(onJump);

    scrollAwayFromBottom(container, 800);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: BUTTON_NAME })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: BUTTON_NAME }));

    await waitFor(() => {
      expect(onJump).toHaveBeenCalledTimes(1);
      expect(container.scrollTop).toBe(0);
    });
    // 有重载这一路是**瞬时**滚：旧内容整段换掉了，smooth 动画会被替换打断（真机踩过）
    expect(scrollToSpy).not.toHaveBeenCalled();
    // 且绝不用 scrollIntoView（它会沿祖先链冒泡）
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('回调返回 Promise 时，等它 resolve 之后才滚（不滚在旧内容上）', async () => {
    let resolveJump: (() => void) | null = null;
    const onJump = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveJump = resolve;
        }),
    );
    const { container } = mountHarness(onJump);

    scrollAwayFromBottom(container, 800);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: BUTTON_NAME })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: BUTTON_NAME }));
    await waitFor(() => expect(onJump).toHaveBeenCalled());
    // Promise 还没 resolve —— 此刻不许已经滚了
    expect(container.scrollTop).toBe(-800);

    resolveJump!();
    await waitFor(() => expect(container.scrollTop).toBe(0));
  });
});
