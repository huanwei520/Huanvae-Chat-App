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

  it('别人的单条消息：显示昵称，且落在气泡内容区里', () => {
    render(<GroupMessageBubble message={makeMessage({ sender_nickname: 'Alice' })} isOwn={false} />);

    const name = nameEl();
    expect(name).toBeInTheDocument();
    expect(name).toHaveTextContent('Alice');
    // 必须挂在 .bubble-content 内（而不是飘在 message-row 上），否则左缘对不齐头像位
    expect(document.querySelector('.bubble-content > .bubble-sender-name')).toBeInTheDocument();
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
