/**
 * 新消息到达时「要不要贴回最新一条」—— 判据 + 接线契约
 *
 * 被测：src/chat/shared/useStickToBottom.ts（私聊含 bot / 群聊共用的唯一判据）
 *
 * ## 坐标约定
 * 消息列表是 `flex-direction: column-reverse`，**滚动原点在底部**：`scrollTop === 0` 就是最新一条，
 * 往更旧翻是负值。所以「贴底」= 把 scrollTop 写回 0，不是滚到 scrollHeight。
 *
 * ## 这里能守住什么、守不住什么（不许含糊）
 * 守得住：**决策契约** —— 什么来源 + 什么可见性下「该滚 / 不该滚」，以及决策**读的是哪一刻**的可见性。
 * 守不住：**可见性数值本身**。jsdom 无布局引擎（`getBoundingClientRect()` 恒 0、
 * `IntersectionObserver` 是桩），"最新那条露出了几个像素"在这里根本不存在 ——
 * 本文件用可控的假 IO 直接喂 `isIntersecting`，等于把「几何 → 布尔」那一段**假设成对的**。
 * 那一段只能真机验（见交付说明）。
 *
 * ## 为什么自带一个假 IntersectionObserver
 * tests/setup.ts 的全局桩三个方法都是空 `vi.fn()`，永远不回报可见性 —— 用它测不出任何分支。
 * 本文件 `vi.stubGlobal` 覆盖成可手动 emit 的假实现，好让「可见 / 部分可见 / 完全遮住」
 * 三种状态都能被显式喂进去（尤其是**负对照**：完全遮住必须不滚）。
 * 假 IO **不会自动 emit** —— 这正是"决策只读插入前的值"能被验到的原因。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useRef } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  useStickToBottom,
  shouldStickToBottom,
  classifyNewHead,
  newLocalSendClientId,
  markLocalSend,
  resetLocalSendMarkForTest,
  LOCAL_SEND_CLIENT_ID_PREFIX,
  REALTIME_PUSH_CLIENT_ID_PREFIX,
  type StickToBottomMessage,
} from '../../src/chat/shared/useStickToBottom';

// ============================================================
// 可控假 IntersectionObserver
// ============================================================

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  unobserve() {
    /* 被测实现只用 disconnect，这里保持接口完整即可 */
  }

  disconnect() {
    this.disconnected = true;
  }

  /** 手动回报一次可见性。ratio 只是描述性的，判据是 isIntersecting（threshold 0） */
  emit(isIntersecting: boolean, intersectionRatio = isIntersecting ? 1 : 0) {
    this.callback(
      [{ isIntersecting, intersectionRatio } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

/** 当前还活着的那个观察者（每次列表头变化会换一个新的） */
function liveObserver(): FakeIntersectionObserver {
  const live = FakeIntersectionObserver.instances.filter((o) => !o.disconnected);
  expect(live.length).toBe(1); // 正对照：观察者必须恰好一个，多了说明旧的没 disconnect
  return live[live.length - 1]!;
}

// ============================================================
// 宿主
// ============================================================

interface TestMsg extends StickToBottomMessage {
  message_uuid: string;
  clientId?: string;
}

function Harness({ messages }: { messages: TestMsg[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useStickToBottom(containerRef, messages);
  return (
    <div data-testid="container" ref={containerRef}>
      {/* 「暂无消息」占位符：真实结构里它排在气泡之前且**不带**定位锚点 ——
          放进来是为了证明 querySelector 取的确实是最新那条气泡，而不是碰巧的第一个子元素 */}
      <div data-testid="placeholder" />
      {messages.map((m) => (
        <div key={m.clientId ?? m.message_uuid} data-message-uuid={m.message_uuid} />
      ))}
    </div>
  );
}

/**
 * 推进若干帧。被测实现把滚动压到**双 rAF** 之后（等提交 + 绘制），
 * 故断言前必须真的跨过两帧；多推几帧不会有副作用（写 scrollTop=0 是幂等的）。
 */
async function advanceFrames(count = 4): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- 逐帧推进本就是串行语义
    await act(async () => {
      await new Promise<void>((r) => {
        requestAnimationFrame(() => {
          r();
        });
      });
    });
  }
}

const OTHER = (uuid: string): TestMsg => ({
  message_uuid: uuid,
  clientId: `${REALTIME_PUSH_CLIENT_ID_PREFIX}${uuid}`,
});
const OWN_SEND = (uuid: string): TestMsg => ({ message_uuid: uuid, clientId: newLocalSendClientId() });
const FROM_DB = (uuid: string): TestMsg => ({ message_uuid: uuid });

const SCROLLED_UP = -800;

describe('shouldStickToBottom —— 判据真值表（纯函数，不受 jsdom 无布局影响）', () => {
  it('本机发送：无论最新那条看不看得见，都滚', () => {
    expect(shouldStickToBottom('own-local-send', true)).toBe(true);
    expect(shouldStickToBottom('own-local-send', false)).toBe(true);
  });

  it('实时推送（别人发来 / 多端回流）：最新那条插入前看得见才滚', () => {
    expect(shouldStickToBottom('realtime-incoming', true)).toBe(true);
    // 🔴 负对照：被完全遮住就**不**滚。没有这一条，实现退化成无条件滚底也照样"全绿"
    expect(shouldStickToBottom('realtime-incoming', false)).toBe(false);
  });

  it('非实时（loadMore / loadNewer / jumpToLatest / 首次加载）：一律不滚', () => {
    expect(shouldStickToBottom('not-realtime', true)).toBe(false);
    expect(shouldStickToBottom('not-realtime', false)).toBe(false);
  });
});

describe('classifyNewHead —— 「本机发送」与「多端回流」靠 clientId 的产生方区分', () => {
  it('本机乐观插入产生的 clientId → own-local-send', () => {
    expect(classifyNewHead(newLocalSendClientId())).toBe('own-local-send');
    expect(newLocalSendClientId().startsWith(LOCAL_SEND_CLIENT_ID_PREFIX)).toBe(true);
  });

  it('WS 推送产生的 clientId → realtime-incoming（多端回流的自己消息走的正是这条）', () => {
    expect(classifyNewHead(`${REALTIME_PUSH_CLIENT_ID_PREFIX}uuid-x`)).toBe('realtime-incoming');
  });

  it('无 clientId（DB 读出来的）→ not-realtime', () => {
    expect(classifyNewHead(undefined)).toBe('not-realtime');
  });

  it('两个前缀互不包含（否则分类会互相吃掉）', () => {
    expect(LOCAL_SEND_CLIENT_ID_PREFIX.startsWith(REALTIME_PUSH_CLIENT_ID_PREFIX)).toBe(false);
    expect(REALTIME_PUSH_CLIENT_ID_PREFIX.startsWith(LOCAL_SEND_CLIENT_ID_PREFIX)).toBe(false);
  });
});

describe('useStickToBottom —— 新消息到达时的实际滚动行为', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    resetLocalSendMarkForTest();
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetLocalSendMarkForTest();
  });

  /**
   * 布好现场：列表里已有一条，用户已上滑到离底 800px，并把「最新那条的可见性」喂进去。
   * 返回 rerender + 容器，供用例继续追加消息。
   */
  function setup(latestVisible: boolean, intersectionRatio?: number) {
    const first = OTHER('m1');
    const view = render(<Harness messages={[first]} />);
    const container = screen.getByTestId('container');

    container.scrollTop = SCROLLED_UP;
    liveObserver().emit(latestVisible, intersectionRatio);

    const push = (msg: TestMsg, rest: TestMsg[] = [first]) => {
      view.rerender(<Harness messages={[msg, ...rest]} />);
    };
    return { container, push, view };
  }

  it('A. 最新那条完整可见 + 对方消息 → 滚回底部', async () => {
    const { container, push } = setup(true, 1);

    push(OTHER('m2'));
    await advanceFrames();

    expect(container.scrollTop).toBe(0);
  });

  it('B. 最新那条只露出一部分 + 对方消息 → 照样滚（露一点也算「看得见」）', async () => {
    // threshold 0：只要 isIntersecting 就算可见，ratio 只是描述。这一条钉的正是这个边界口径。
    const { container, push } = setup(true, 0.12);

    push(OTHER('m2'));
    await advanceFrames();

    expect(container.scrollTop).toBe(0);
  });

  it('C. 最新那条完全被遮住 + 对方消息 → 不滚（负对照：防退化成恒真）', async () => {
    const { container, push } = setup(false);

    push(OTHER('m2'));
    await advanceFrames();

    // 用户停在原处，读历史不被拽走 —— 这是本来就正确、绝不能被本次改动弄坏的行为
    expect(container.scrollTop).toBe(SCROLLED_UP);
  });

  it('D. 上滑很远（最新那条完全被遮住）+ 自己发送 → 无条件滚回底部', async () => {
    const { container, push } = setup(false);

    push(OWN_SEND('m2'));
    await advanceFrames();

    expect(container.scrollTop).toBe(0);
  });

  it('E. 多端回流的自己消息按「对方发来」处理：被遮住时不滚', async () => {
    // 在别的设备发的消息推回本机时 sender_id 同样是我，但没有「我刚按了发送」这个意图信号。
    // 它走 WS 分支 ⇒ clientId 前缀是 ws_ ⇒ 与对方消息同一条通路。
    const { container, push } = setup(false);

    push(OTHER('m2-from-my-phone'));
    await advanceFrames();

    expect(container.scrollTop).toBe(SCROLLED_UP);
  });

  it('F. 非实时重灌（无 clientId：loadNewer / jumpToLatest）→ 不滚，哪怕最新那条可见', async () => {
    // 定位窗口态下往更新方向续加载要的是「保持视位」，贴底会把用户从窗口里弹走
    const { container, push } = setup(true);

    push(FROM_DB('m2'));
    await advanceFrames();

    expect(container.scrollTop).toBe(SCROLLED_UP);
  });

  it('G. 连续两条对方消息：第二条用的是【第一条到达前】的可见性，不会退化成恒真', async () => {
    const first = OTHER('m1');
    const view = render(<Harness messages={[first]} />);
    const container = screen.getByTestId('container');
    container.scrollTop = SCROLLED_UP;
    liveObserver().emit(false); // 最新那条被完全遮住

    const second = OTHER('m2');
    view.rerender(<Harness messages={[second, first]} />);
    await advanceFrames();
    expect(container.scrollTop).toBe(SCROLLED_UP);

    // 第二条到达。若实现在"插入后现算可见性"，新消息一进 DOM 就贴在视觉底部、必然可见
    // ⇒ 判据恒真 ⇒ 这里会被滚到 0。断言它没滚，就是在钉「读的是插入前的值」。
    view.rerender(<Harness messages={[OTHER('m3'), second, first]} />);
    await advanceFrames();
    expect(container.scrollTop).toBe(SCROLLED_UP);
  });

  it('H. IO 在插入之后才回报「新的最新那条可见」，不得把已作出的「不滚」翻过来', async () => {
    const { container, push } = setup(false);

    push(OTHER('m2'));
    await advanceFrames();
    expect(container.scrollTop).toBe(SCROLLED_UP);

    // 观察者已换到新头上，此刻回报「可见」—— 这是给**下一条**消息用的，不能回溯生效
    liveObserver().emit(true);
    await advanceFrames();
    expect(container.scrollTop).toBe(SCROLLED_UP);
  });

  it('I. 文件上传路径：重灌回来的消息不带 clientId，靠 markLocalSend 认领 → 滚', async () => {
    const { container, push } = setup(false);

    markLocalSend();
    push(FROM_DB('m2')); // loadFriendMessages() 重新读 DB 灌回来的形态
    await advanceFrames();

    expect(container.scrollTop).toBe(0);
  });

  it('J. markLocalSend 是一次性的：消费掉之后，下一条对方消息回到可见性判据', async () => {
    const { container, view } = setup(false);
    const first = OTHER('m1');

    markLocalSend();
    view.rerender(<Harness messages={[FROM_DB('m2'), first]} />);
    await advanceFrames();
    expect(container.scrollTop).toBe(0);

    // 重新上滑，标记应已被上一条消费光
    container.scrollTop = SCROLLED_UP;
    view.rerender(<Harness messages={[OTHER('m3'), FROM_DB('m2'), first]} />);
    await advanceFrames();
    expect(container.scrollTop).toBe(SCROLLED_UP);
  });

  it('N. 自己发送的滚动不会被「紧随其后的一条别人消息」取消（间歇性复发的成因）', async () => {
    // 现场：我正在读历史（最新那条被遮住），我按下发送 —— 必须滚底。
    // 紧接着 32ms 内群里来了一条别人的消息 —— 按判据它不该滚。
    // 若把双 rAF 的取消函数当 effect cleanup 用，后者会把前者**还没落地**的滚动取消掉，
    // 于是"我按了发送却没滚下去"的现网缺陷间歇性复发（且只在高频群聊里偶发，最难查）。
    const { container, view } = setup(false);
    const first = OTHER('m1');
    const mine = OWN_SEND('m2');

    view.rerender(<Harness messages={[mine, first]} />);
    // 刻意**不推进帧**：让自己发送的那次滚动仍然挂在 rAF 队列里
    view.rerender(<Harness messages={[OTHER('m3'), mine, first]} />);
    await advanceFrames();

    expect(container.scrollTop).toBe(0);
  });

  it('K. 首帧（会话刚打开）不滚 —— column-reverse 本就贴底，这里插一脚只会白改 scrollTop', async () => {
    render(<Harness messages={[OTHER('m1')]} />);
    const container = screen.getByTestId('container');
    container.scrollTop = SCROLLED_UP; // 假装外部（如定位）刚把它滚走
    await advanceFrames();

    expect(container.scrollTop).toBe(SCROLLED_UP);
  });

  it('L. 列表头没换（发送 ack 回填 uuid / loadMore 追加旧消息）→ 不滚', async () => {
    const own = OWN_SEND('temp-uuid');
    const view = render(<Harness messages={[own]} />);
    const container = screen.getByTestId('container');
    container.scrollTop = SCROLLED_UP;

    // ack 回填：message_uuid 换成服务端的，clientId 不变 ⇒ 头 key 不变
    view.rerender(<Harness messages={[{ ...own, message_uuid: 'server-uuid' }]} />);
    await advanceFrames();
    expect(container.scrollTop).toBe(SCROLLED_UP);

    // loadMore：旧消息追加到列表末尾，头不变
    view.rerender(
      <Harness messages={[{ ...own, message_uuid: 'server-uuid' }, FROM_DB('older-1')]} />,
    );
    await advanceFrames();
    expect(container.scrollTop).toBe(SCROLLED_UP);
  });

  it('M. 观察的是最新那条气泡（不是占位符）：占位符没有定位锚点', () => {
    setup(true);
    const observed = liveObserver().observed[0] as HTMLElement;
    expect(observed).toBeDefined();
    expect(observed.dataset.messageUuid).toBe('m1');
    expect(screen.getByTestId('placeholder').hasAttribute('data-message-uuid')).toBe(false);
  });
});

/**
 * 接线契约（静态）：两个消息列表**都**必须调这个 hook，且**不许**各自另判一套贴底。
 *
 * 为什么只能静态验：渲染整棵 ChatMessages / GroupChatMessages 要拖起 store + Tauri invoke 全链，
 * mock 成本远高于它能防住的回归；而这里要防的恰恰是"复制粘贴出第二份判据"这种结构性回归。
 * 手法同 tests/components/JumpToLatestButton.test.tsx 末尾那组接线契约。
 *
 * 会话覆盖面：好友与 bot 共用 ChatMessages（chatTarget.ts 的 isFriendLikeTarget =
 * type==='friend' || type==='bot'），群聊用 GroupChatMessages ⇒ 这两个文件即覆盖三种会话。
 * AIChatMessages 是 AI 助手，不在此列，故意不登记。
 */
describe('useStickToBottom —— 两个消息列表的接线契约（好友 + bot + 群聊共三种会话）', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, '../../', rel), 'utf-8');

  /**
   * 剥掉注释再判「代码里有没有某个东西」。
   *
   * 这两个文件的文件头**正当地**用中文解释 column-reverse 约定（「打开会话：scrollTop=0 即底部」），
   * 直接在原文上 grep 会把这些准确的说明判成违规 —— 逼后来的人删掉正确文档才能过门禁。
   * 判据必须落在**代码**上。手法与 tests/huanvaeguard-port-resolution.test.ts 同源
   * （见 .claude/rules/frontend-test.md「要在【剥掉注释的代码】上判」）。
   */
  const stripComments = (src: string): string => {
    const kept: string[] = [];
    let inBlock = false;
    for (const line of src.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (inBlock) {
        if (trimmed.includes('*/')) { inBlock = false; }
        continue;
      }
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) { inBlock = true; }
        continue;
      }
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) { continue; }
      kept.push(line);
    }
    return kept.join('\n');
  };

  const LISTS: [string, string][] = [
    ['私聊/bot ChatMessages', 'src/chat/friend/ChatMessages.tsx'],
    ['群聊 GroupChatMessages', 'src/chat/group/GroupChatMessages.tsx'],
  ];

  it.each(LISTS)('%s 调用 useStickToBottom，并把容器 ref + 已排序列表交给它', (_name, file) => {
    const src = read(file);
    expect(src).toMatch(
      /import\s*\{[^}]*\buseStickToBottom\b[^}]*\}\s*from\s*'\.\.\/shared\/useStickToBottom'/,
    );
    expect(src).toMatch(/useStickToBottom\(\s*containerRef\s*,\s*sortedMessages\s*\)/);
  });

  it.each(LISTS)('%s 内部不再自己判贴底（没有第二份判据）', (_name, file) => {
    const code = stripComments(read(file));
    // 正对照：剥完注释仍有实质代码、且确实含 scrollTop 相关代码（prepend 保位），
    // 否则下面几条 not.toMatch 会在空字符串上恒真变成假测试
    expect(code.length).toBeGreaterThan(1000);
    expect(code).toMatch(/container\.scrollTop/);

    // 贴底只能由 hook 写 scrollTop = 0；列表自己只准做 prepend 保位的 `+=`
    expect(code).not.toMatch(/scrollTop\s*=\s*0\b/);
    // 也不许留下任何"离底比例"式的旧判据（比例方案已作废，不得并存）
    expect(code).not.toMatch(/NEAR_BOTTOM|isNearBottom/);
  });

  it('AIChatMessages 不接入（AI 助手不在本次三种会话内，避免顺手误改）', () => {
    expect(read('src/chat/ai/AIChatMessages.tsx')).not.toMatch(/useStickToBottom/);
  });

  it('四个乐观插入点都用共享生成器产 clientId（前缀散着写会让判据静默失效）', () => {
    for (const file of [
      'src/chat/friend/useLocalFriendMessages.ts',
      'src/chat/group/useLocalGroupMessages.ts',
    ]) {
      const src = read(file);
      // 每个文件两处（文本 + 媒体）
      expect(src.match(/newLocalSendClientId\(\)/g)?.length).toBe(2);
      // 不许再有人手拼 client_ 前缀
      expect(src).not.toMatch(/`client_\$\{/);
    }
  });
});
