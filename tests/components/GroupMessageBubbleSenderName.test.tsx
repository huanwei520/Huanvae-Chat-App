/**
 * GroupMessageBubble 发送者昵称渲染测试
 *
 * 锁定 huanwei 2026-08-14 按 telegram 参照图拍板的三条口径：
 * - 群聊气泡内顶部显示发送者昵称，**带颜色**（同一人恒同色，颜色由 sender_id 决定）
 * - 连续同一人的一组里**只在最上面那条**显示（showName=false 的其余各条不重复）
 * - 自己的消息不显示（右侧蓝气泡本身就是身份）；1:1 走的是另一个组件，天然没有这行
 *
 * 断言全部打在**真组件渲染出的 DOM** 上（不是自己写死的 className 字面量），
 * 覆盖的是 GroupMessageBubble 里 shouldShowSenderName 那个三条与门 + data-sender-hue 赋值。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import type { GroupMessage } from '../../src/api/groupMessages';

// ============== Mock 重型依赖（与 GroupMessageBubbleAvatarClick 同款） ==============
vi.mock('../../src/chat/shared/MessageContextMenu', () => ({ MessageContextMenu: () => null }));
vi.mock('../../src/chat/shared/FileMessageContent', () => ({ FileMessageContent: () => null }));
vi.mock('../../src/chat/shared/MeetingInviteCard', () => ({ MeetingInviteCard: () => null }));
vi.mock('../../src/components/common/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock('../../src/chat/shared/MobileMessageFullPreview', () => ({ MobileMessageFullPreview: () => null }));
vi.mock('../../src/services/fileCache', () => ({ getCachedFilePath: vi.fn().mockResolvedValue(null) }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }),
}));
vi.mock('../../src/utils/platform', () => ({ isMobile: () => false }));
vi.mock('../../src/utils/saveToGallery', () => ({ saveToGallery: vi.fn() }));
vi.mock('../../src/hooks/useFileCache', () => ({ useFileCache: () => ({ localPath: null, isLocal: false }) }));

const mockChatState = vi.hoisted(() => ({
  friends: [] as unknown[],
  setChatTarget: () => {},
  groupMessageBlocks: {} as Record<string, string[]>,
  setGroupMemberBlocked: () => {},
  groupSpecialCares: {} as Record<string, string[]>,
  setGroupMemberSpecialCare: () => {},
  groupMemberRemarks: {} as Record<string, Record<string, string>>,
  setGroupMemberRemark: () => {},
  friendBlacklistTimes: {} as Record<string, string>,
}));
vi.mock('../../src/stores', () => ({
  useChatStore: (selector: (s: typeof mockChatState) => unknown) => selector(mockChatState),
  useProfileViewStore: (selector: (s: { open: () => void }) => unknown) => selector({ open: () => {} }),
}));

import { GroupMessageBubble } from '../../src/chat/group/GroupMessageBubble';
import { senderNameColorIndex, SENDER_NAME_COLOR_COUNT } from '../../src/chat/shared/senderNameColor';

function makeMessage(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    message_uuid: 'uuid-1', group_id: 'g-1', sender_id: 'user-2', sender_nickname: 'Alice',
    sender_avatar_url: '', message_content: 'hello', message_type: 'text',
    file_uuid: null, file_url: null, file_size: null, file_hash: null,
    image_width: null, image_height: null, reply_to: null,
    send_time: '2026-01-01T00:00:00Z', is_recalled: false, seq: 1, ...overrides,
  };
}

/** 昵称节点（不存在时返回 null，供"不显示"的断言用） */
function nameEl(): HTMLElement | null {
  return document.querySelector('.bubble-sender-name');
}

describe('GroupMessageBubble — 发送者昵称显示门控', () => {
  beforeEach(() => {
    mockChatState.groupMemberRemarks = {};
    mockChatState.groupMessageBlocks = {};
    mockChatState.friendBlacklistTimes = {};
  });
  afterEach(cleanup);

  /**
   * 🔴 这条原先断言的是「昵称是 `.bubble-content` 的直接子节点」——
   * huanwei 2026-08-14 12:16「群聊的昵称让其放在气泡里」把那条契约作废了：
   * `.bubble-content` 的直接子节点等于**飘在气泡外面**（气泡本体是 `.bubble-text`，
   * 底色 / 圆角 / 内边距都在它身上）。旧断言留着会恒绿地守一条已被推翻的口径。
   * 位置契约的完整版在下面「昵称落进气泡内部」那个 describe 里，正反两侧都断言。
   */
  it('别人的单条消息：显示昵称，且落在气泡本体里', () => {
    render(<GroupMessageBubble message={makeMessage({ sender_nickname: 'Alice' })} isOwn={false} />);

    const name = nameEl();
    expect(name).toBeInTheDocument();
    expect(name).toHaveTextContent('Alice');
    // 必须在气泡本体 .bubble-text 之内（不是它上面那一行）
    expect(document.querySelector('.bubble-text > .bubble-sender-name')).toBeInTheDocument();
  });

  it('showName=false（连发组里非最上面那条）→ 不显示昵称', () => {
    render(<GroupMessageBubble message={makeMessage()} isOwn={false} showName={false} />);

    expect(nameEl()).toBeNull();
    // 反向对照：气泡本身渲染出来了，不是整块没渲染
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('自己的消息 → 不显示昵称（即使 showName 取默认的 true）', () => {
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'me' })} isOwn />);

    expect(nameEl()).toBeNull();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('发送者被群内屏蔽（折叠占位）→ 不显示昵称', () => {
    mockChatState.groupMessageBlocks = { 'g-1': ['user-2'] };
    render(<GroupMessageBubble message={makeMessage()} isOwn={false} groupId="g-1" />);

    expect(screen.getByText('已屏蔽此人消息')).toBeInTheDocument();
    expect(nameEl()).toBeNull();
  });

  it('非文本消息（图片）同样显示昵称 —— 否则图片消息认不出是谁发的', () => {
    render(
      <GroupMessageBubble
        message={makeMessage({ message_type: 'image', file_uuid: 'f-1', message_content: '' })}
        isOwn={false}
      />,
    );

    expect(nameEl()).toHaveTextContent('Alice');
  });

  it('群内私有备注优先于 sender_nickname（与头像 aria-label 同一口径）', () => {
    mockChatState.groupMemberRemarks = { 'g-1': { 'user-2': '备注名' } };
    render(<GroupMessageBubble message={makeMessage({ sender_nickname: 'Alice' })} isOwn={false} groupId="g-1" />);

    expect(nameEl()).toHaveTextContent('备注名');
    expect(nameEl()).not.toHaveTextContent('Alice');
  });

  it('长昵称：整串进 DOM + title 全名，靠 CSS 截断（不在 JS 里截字符）', () => {
    const longName = '这是一个非常非常长的群昵称用来验证截断不会把气泡撑变形';
    render(<GroupMessageBubble message={makeMessage({ sender_nickname: longName })} isOwn={false} />);

    const name = nameEl()!;
    expect(name).toHaveTextContent(longName);
    // 鼠标悬停能看到全名（CSS 只截显示，不截内容）
    expect(name).toHaveAttribute('title', longName);
  });
});

/**
 * 昵称的**落点**（huanwei 2026-08-14 12:16「群聊的昵称让其放在气泡里，参考 Telegram」）。
 *
 * 落点规则与时间戳逐字同一条（17e1c5a 已拍板）：有气泡就进气泡，没气泡（文档 / 卡片这种
 * 独立白底卡片）就留在卡片外。每条都配一个**反向断言** —— 只查「新位置有」会被
 * 「新旧两处并存」蒙混过去，那正是「移进去」这件事最可能出的错。
 */
describe('GroupMessageBubble — 昵称落进气泡内部（不再飘在气泡外）', () => {
  beforeEach(() => {
    mockChatState.groupMemberRemarks = {};
    mockChatState.groupMessageBlocks = {};
    mockChatState.friendBlacklistTimes = {};
  });
  afterEach(cleanup);

  it('文本气泡：昵称在 .bubble-text 内，且不再是 .bubble-content 的直接子节点', () => {
    render(<GroupMessageBubble message={makeMessage()} isOwn={false} />);

    const bubbleText = document.querySelector('.bubble-text')!;
    const name = nameEl()!;

    expect(bubbleText.contains(name)).toBe(true);
    expect(name.parentElement).toBe(bubbleText);
    // 反向断言：气泡外面那一行已经没有了（防「两处并存」）
    expect(document.querySelector('.bubble-content > .bubble-sender-name')).toBeNull();
  });

  it('文本气泡：昵称与「正文+时间戳」那一行是兄弟，不是同一条 flex 行里的项', () => {
    render(<GroupMessageBubble message={makeMessage()} isOwn={false} />);

    const name = nameEl()!;
    const metafoot = document.querySelector('.bubble-metafoot')!;

    // .bubble-metafoot 是 justify-content:flex-end 的换行 flex 行；昵称若成为它的项
    // 会被推到右边跟时间戳挤在一起 ⇒ 必须在它外面、在它上面
    expect(metafoot.contains(name)).toBe(false);
    expect(name.nextElementSibling).toBe(metafoot);
    // 同类正对照：时间戳确实还在那一行里（证明查的是同一棵活的树）
    expect(metafoot.querySelector('.bubble-meta')).toBeInTheDocument();
  });

  it('带配文的图片：昵称在大气泡 .media-bubble 内、且排在媒体之前', () => {
    render(
      <GroupMessageBubble
        message={makeMessage({ message_type: 'image', file_uuid: 'f-1', message_content: '看这个' })}
        isOwn={false}
      />,
    );

    const mediaBubble = document.querySelector('.media-bubble')!;
    const name = nameEl()!;

    expect(mediaBubble.contains(name)).toBe(true);
    expect(mediaBubble.firstElementChild).toBe(name);
    expect(document.querySelector('.bubble-content > .bubble-sender-name')).toBeNull();
  });

  it('无配文的纯图片：昵称落进定位壳 .media-bubble-bare（左上角药丸）', () => {
    render(
      <GroupMessageBubble
        message={makeMessage({ message_type: 'image', file_uuid: 'f-1', message_content: '[图片] a.jpg' })}
        isOwn={false}
      />,
    );

    const bare = document.querySelector('.media-bubble-bare')!;
    expect(bare.contains(nameEl()!)).toBe(true);
    expect(document.querySelector('.bubble-content > .bubble-sender-name')).toBeNull();
  });

  it('文档（白底卡片，没有气泡可进）：昵称仍留在卡片外，与时间戳留在卡片下方对称', () => {
    render(
      <GroupMessageBubble
        message={makeMessage({ message_type: 'file', file_uuid: 'f-1', message_content: '[文件] a.pdf' })}
        isOwn={false}
      />,
    );

    // 这一路**不该**被收进任何气泡 —— 它没有气泡
    expect(document.querySelector('.bubble-content > .bubble-sender-name')).toBeInTheDocument();
    // 反向对照：文档确实没有产生媒体气泡壳（否则上面那条就不是「没气泡」而是「漏进去了」）
    expect(document.querySelector('.media-bubble')).toBeNull();
    expect(document.querySelector('.media-bubble-bare')).toBeNull();
  });
});

describe('GroupMessageBubble — 相连气泡收窄下边距（tightBelow）', () => {
  afterEach(cleanup);

  it('tightBelow=true → 行上带 message-row--tight', () => {
    render(<GroupMessageBubble message={makeMessage()} isOwn={false} tightBelow />);

    expect(document.querySelector('.message-row.message-row--tight')).toBeInTheDocument();
  });

  it('默认（单条自成一组）→ 不带该修饰符，维持组间常规间距', () => {
    render(<GroupMessageBubble message={makeMessage()} isOwn={false} />);

    // 同类正对照在先：行本身渲染出来了，不是整块没渲染
    expect(document.querySelector('.message-row')).toBeInTheDocument();
    expect(document.querySelector('.message-row--tight')).toBeNull();
  });

  it('撤回态渲染的是居中系统行，不套用收窄（两边贴紧会让人以为它属于某一组）', () => {
    render(<GroupMessageBubble message={makeMessage({ is_recalled: true })} isOwn={false} tightBelow />);

    expect(document.querySelector('.recall-system-row')).toBeInTheDocument();
    expect(document.querySelector('.message-row--tight')).toBeNull();
  });
});

describe('GroupMessageBubble — 昵称配色（data-sender-hue）', () => {
  afterEach(cleanup);

  it('hue 取值来自 sender_id，且落在合法区间内', () => {
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'user-2' })} isOwn={false} />);

    const hue = nameEl()!.getAttribute('data-sender-hue');
    expect(hue).toBe(String(senderNameColorIndex('user-2')));
    expect(Number(hue)).toBeGreaterThanOrEqual(0);
    expect(Number(hue)).toBeLessThan(SENDER_NAME_COLOR_COUNT);
  });

  it('同一 sender_id 两次渲染同色；换 id 后颜色确实会变（判据有区分力）', () => {
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'user-2' })} isOwn={false} />);
    const first = nameEl()!.getAttribute('data-sender-hue');
    cleanup();

    render(<GroupMessageBubble message={makeMessage({ sender_id: 'user-2' })} isOwn={false} />);
    expect(nameEl()!.getAttribute('data-sender-hue')).toBe(first);
    cleanup();

    // 负对照：挑一个已知不同色的 id，证明 hue 不是恒定常量
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'user-3' })} isOwn={false} />);
    expect(nameEl()!.getAttribute('data-sender-hue')).not.toBe(first);
  });
});
