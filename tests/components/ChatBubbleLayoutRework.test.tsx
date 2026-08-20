/**
 * 聊天布局改版的结构契约（huanwei 2026-08-14 拍板的三件事）
 *
 * 1. **1:1 气泡区不再有头像** —— 双方头像移到顶栏（`ChatTargetAvatar`）
 * 2. **群聊连发合并** —— 同一人连发只在最新那条挂头像，其余留同尺寸占位孔；
 *    昵称只挂**组内最旧那条**（2026-08-14 当日按 telegram 参照图订正，见下面 ② 组内注释）
 * 3. **时间戳落进气泡内** —— `.bubble-meta` 从 `.bubble-content` 的直接子节点
 *    变成 `.bubble-text` 内部的子节点（类 Telegram）
 *
 * 🔴 每条负向断言都配了一条**同类正向断言**（同一次 render、同一种查询）：
 * 「查不到 `.bubble-avatar`」只有在「同一棵树里查得到 `.bubble-text`」时才说明问题，
 * 否则可能只是这次 render 整个失败了。
 *
 * ⚠️ 这一层守的是**结构**。像素上「时间戳会不会盖住文字 / 短消息会不会把气泡撑变形」
 * jsdom 结构性测不出（无布局引擎），只能靠真机 —— 见
 * .claude/rules/frontend-test.md「滚动 / 布局相关行为」。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Message, Friend, Group, ChatTarget } from '../../src/types/chat';
import type { GroupMessage } from '../../src/api/groupMessages';
import type { SessionInfo } from '../../src/components/common/Avatar';

// ============== Mock 重型依赖（与既有气泡测试同一套） ==============
vi.mock('../../src/chat/shared/MessageContextMenu', () => ({ MessageContextMenu: () => null }));
vi.mock('../../src/chat/shared/FileMessageContent', () => ({ FileMessageContent: () => null }));
vi.mock('../../src/chat/shared/MeetingInviteCard', () => ({ MeetingInviteCard: () => null }));
vi.mock('../../src/components/common/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));
vi.mock('../../src/chat/shared/MobileMessageFullPreview', () => ({ MobileMessageFullPreview: () => null }));
vi.mock('../../src/services/fileCache', () => ({ getCachedFilePath: vi.fn().mockResolvedValue(null) }));
vi.mock('../../src/utils/platform', () => ({ isMobile: () => false }));
vi.mock('../../src/utils/saveToGallery', () => ({ saveToGallery: vi.fn() }));
vi.mock('../../src/hooks/useFileCache', () => ({ useFileCache: () => ({ localPath: null, isLocal: false }) }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }),
}));

const mockChatState = vi.hoisted(() => ({
  friends: [] as unknown[],
  setChatTarget: vi.fn(),
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
  useProfileViewStore: (selector: (s: { open: () => void }) => unknown) => selector({ open: vi.fn() }),
}));

import { MessageBubble } from '../../src/chat/friend/MessageBubble';
import { GroupMessageBubble } from '../../src/chat/group/GroupMessageBubble';
import { ChatTargetAvatar, hasChatTargetAvatar } from '../../src/chat/shared/ChatTargetAvatar';

const session: SessionInfo & { userId: string } = {
  serverUrl: 'http://test', userId: 'me', accessToken: 't', refreshToken: 'r',
  profile: {
    user_id: 'me', user_nickname: 'Me', user_email: null, user_signature: null,
    user_avatar_url: null, admin: 'false', created_at: '', updated_at: '',
  },
  avatarPath: null,
} as never;

const friend: Friend = {
  friend_id: 'them', friend_nickname: 'Them', friend_email: null, friend_signature: null,
  friend_avatar_url: null, add_time: '2026-01-01T00:00:00Z',
} as never;

const group: Group = { group_id: 'g-1', group_name: '测试群', group_avatar_url: null } as never;

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    message_uuid: 'uuid-1', sender_id: 'them', receiver_id: 'me', message_content: 'hello',
    message_type: 'text', file_uuid: null, file_url: null, file_size: null, image_width: null, image_height: null, send_time: '2026-01-01T00:00:00Z', seq: 1,
    is_recalled: false, ...overrides,
  };
}

function makeGroupMessage(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    message_uuid: 'g-uuid-1', group_id: 'g-1', sender_id: 'user-2', sender_nickname: 'Alice',
    sender_avatar_url: '', message_content: 'hello', message_type: 'text',
    file_uuid: null, file_url: null, file_size: null, image_width: null, image_height: null, reply_to: null,
    send_time: '2026-01-01T00:00:00Z', is_recalled: false, seq: 1, ...overrides,
  };
}

beforeEach(() => {
  cleanup();
});

describe('① 1:1 气泡区不再有头像（头像移到顶栏）', () => {
  it.each([true, false])('isOwn=%s 的私聊文本气泡：无 .bubble-avatar，但气泡本身正常渲染', (isOwn) => {
    render(
      <MessageBubble message={makeMessage()} isOwn={isOwn} session={session} friend={friend} />,
    );

    // 同类正向对照：同一棵树、同一种 querySelector，气泡本体查得到 ⇒ 上面的 0 是真 0
    expect(document.querySelector('.bubble-text')).toBeInTheDocument();
    expect(document.querySelector('.bubble-avatar')).not.toBeInTheDocument();
  });

  it('顶栏头像的归属规则：friend/bot 给对方头像、group 给群头像、ai 没有', () => {
    const friendTarget: ChatTarget = { type: 'friend', data: friend };
    const botTarget: ChatTarget = { type: 'bot', data: friend };
    const groupTarget: ChatTarget = { type: 'group', data: group };
    const aiTarget: ChatTarget = { type: 'ai' };

    expect(hasChatTargetAvatar(friendTarget)).toBe(true);
    expect(hasChatTargetAvatar(botTarget)).toBe(true);
    expect(hasChatTargetAvatar(groupTarget)).toBe(true);
    expect(hasChatTargetAvatar(aiTarget)).toBe(false);

    // friend 目标 → 渲染出对方昵称首字母占位（无头像 URL 时的回退），说明确实拿的是对方
    const { container, unmount } = render(<ChatTargetAvatar chatTarget={friendTarget} />);
    expect(container.textContent).toContain('T');
    unmount();

    // group 目标 → 渲染群名首字母，说明拿的是群头像而不是好友头像
    const groupRender = render(<ChatTargetAvatar chatTarget={groupTarget} />);
    expect(groupRender.container.textContent).toContain('测');
    groupRender.unmount();

    // ai 目标 → 什么都不渲染
    const aiRender = render(<ChatTargetAvatar chatTarget={aiTarget} />);
    expect(aiRender.container.innerHTML).toBe('');
  });
});

describe('② 群聊连发合并：头像只挂组内最新那条 + 昵称只挂组内最旧那条', () => {
  it('showAvatar 默认 true（单条自成一组）：渲染真头像，不是占位孔', () => {
    render(<GroupMessageBubble message={makeGroupMessage()} isOwn={false} />);

    const avatar = document.querySelector('.bubble-avatar')!;
    expect(avatar).toBeInTheDocument();
    expect(avatar.classList.contains('bubble-avatar--hole')).toBe(false);
    // 真头像可点、可 tab 聚焦
    expect(avatar.getAttribute('role')).toBe('button');
    expect(avatar.getAttribute('tabindex')).toBe('0');
  });

  it('showAvatar=false（组内更早的一条）：留同尺寸占位孔，不可点、不进 tab 序、对读屏隐藏', () => {
    render(<GroupMessageBubble message={makeGroupMessage()} isOwn={false} showAvatar={false} />);

    const hole = document.querySelector('.bubble-avatar')!;
    // 盒子还在（留空位保持左缘对齐），只是不显示
    expect(hole).toBeInTheDocument();
    expect(hole.classList.contains('bubble-avatar--hole')).toBe(true);
    expect(hole.getAttribute('aria-hidden')).toBe('true');
    expect(hole.getAttribute('role')).toBeNull();
    expect(hole.getAttribute('tabindex')).toBeNull();
    // 占位孔里没有任何头像内容
    expect(hole.querySelector('img')).toBeNull();
  });

  /**
   * 🔴 这条原先断言的是「方案 C：任何情况下都不渲染发送者昵称」。
   * 2026-08-14 当日总管按 huanwei 亲手发来的 telegram 参照图裁决：**群聊要显示发送者昵称**
   * ——「不显昵称」只是内部编号约定，与他给的实图冲突时以实图为准 ⇒ 原断言表达的契约已作废，
   * 整条改写成新口径。旧断言查的是 `.bubble-sender`，而新节点叫 `.bubble-sender-name`
   * （class 选择器按整个 token 匹配，`.bubble-sender` 匹配不到它）⇒ 旧断言即使留着也是**恒绿**的，
   * 会变成一条「看着在守门、其实守的是已作废契约」的误导性残留，故必须改掉而不是放着。
   * 完整门控（isOwn / 折叠 / 备注 / 配色 / 长名截断）见 GroupMessageBubbleSenderName.test.tsx。
   */
  it('showName 默认 true（单条自成一组）：渲染发送者昵称', () => {
    render(<GroupMessageBubble message={makeGroupMessage()} isOwn={false} />);

    // 同类正向对照：同一棵树、同一种查询，气泡本体查得到
    expect(document.querySelector('.bubble-text')).toBeInTheDocument();
    expect(document.querySelector('.bubble-sender-name')).toBeInTheDocument();
  });

  it('showName=false（组内更晚的一条）：不重复渲染昵称，但气泡本体照常', () => {
    render(<GroupMessageBubble message={makeGroupMessage()} isOwn={false} showName={false} />);

    // 同类正向对照在先：负向断言只有在同一棵树查得到气泡时才说明问题
    expect(document.querySelector('.bubble-text')).toBeInTheDocument();
    expect(document.querySelector('.bubble-sender-name')).not.toBeInTheDocument();
  });
});

describe('③ 时间戳落进气泡内（类 Telegram）', () => {
  it('私聊文本：.bubble-meta 在 .bubble-text 内部，而不是 .bubble-content 的直接子节点', () => {
    render(<MessageBubble message={makeMessage()} isOwn={false} session={session} friend={friend} />);

    const bubbleText = document.querySelector('.bubble-text')!;
    const meta = document.querySelector('.bubble-meta')!;

    expect(meta).toBeInTheDocument();
    expect(bubbleText.contains(meta)).toBe(true);
    // 反向断言（防「两处并存」蒙混）：气泡外那一行已经没有了
    expect(document.querySelector('.bubble-content > .bubble-meta')).toBeNull();
    // 时间戳与正文是并列的兄弟节点，不是叠在正文上 ⇒ 不可能盖住文字
    expect(bubbleText.querySelector('.bubble-metafoot-body')).toBeInTheDocument();
    expect(meta.parentElement).toBe(bubbleText);
  });

  it('群聊文本：同一套落点（.bubble-meta 在 .bubble-text 内）', () => {
    render(<GroupMessageBubble message={makeGroupMessage()} isOwn={false} />);

    const bubbleText = document.querySelector('.bubble-text')!;
    const meta = document.querySelector('.bubble-meta')!;

    expect(bubbleText.contains(meta)).toBe(true);
    expect(document.querySelector('.bubble-content > .bubble-meta')).toBeNull();
  });

  it('长文本 / 短文本走的是同一条 DOM 结构（换行位置归 CSS，不由 JS 分支决定）', () => {
    const short = render(
      <MessageBubble message={makeMessage({ message_content: '好' })} isOwn session={session} friend={friend} />,
    );
    const shortShape = short.container.querySelector('.bubble-text')!.className;
    short.unmount();

    const long = render(
      <MessageBubble
        message={makeMessage({ message_content: '好'.repeat(400) })}
        isOwn
        session={session}
        friend={friend}
      />,
    );
    const longShape = long.container.querySelector('.bubble-text')!.className;

    // 两种长度拿到的是**同一个** className（都带 bubble-metafoot）⇒ 不存在「长文本走另一条分支」
    expect(shortShape).toBe(longShape);
    expect(longShape).toContain('bubble-metafoot');
    expect(long.container.querySelector('.bubble-text > .bubble-meta')).toBeInTheDocument();
  });

  it('文档消息（不是气泡、是白底卡片）：时间戳仍留在卡片下方，即 .bubble-content 的直接子节点', () => {
    render(
      <MessageBubble
        message={makeMessage({ message_type: 'file', file_uuid: 'f-1', message_content: 'a.pdf' })}
        isOwn={false}
        session={session}
        friend={friend}
      />,
    );

    // 这一路**不该**被收进气泡内 —— 它没有气泡可进
    expect(document.querySelector('.bubble-content > .bubble-meta')).toBeInTheDocument();
    expect(document.querySelector('.bubble-metafoot')).toBeNull();
  });
});

/**
 * ④ 连发气泡收窄下边距，**1:1 侧**（huanwei 2026-08-14 12:16「相连的气泡中间间隙将其缩小」）。
 *
 * 🔴 他那句话的上下文说的是群聊，实现却同时给 1:1 也挂了 `tightBelow`
 * （src/chat/friend/ChatMessages.tsx 用同一个 senderRunGate.runTightKeys 分组，
 *   在 1:1 里「同一人连发」= 连着几条都是我 / 连着几条都是对方）。
 * 保留它是为了两侧同一条视觉规则，但**这一路此前一个测试都没有** ——
 * 群聊侧有三条（GroupMessageBubbleSenderName.test.tsx），1:1 侧是空的。
 * 三条补齐：开、默认关、撤回态不套用。
 */
describe('④ 相连气泡收窄下边距（1:1 侧的 tightBelow）', () => {
  it('tightBelow=true → 行上带 message-row--tight', () => {
    render(
      <MessageBubble message={makeMessage()} isOwn={false} session={session} friend={friend} tightBelow />,
    );

    expect(document.querySelector('.message-row.message-row--tight')).toBeInTheDocument();
  });

  it('默认（单条自成一组）→ 不带该修饰符，维持组间常规间距', () => {
    render(<MessageBubble message={makeMessage()} isOwn={false} session={session} friend={friend} />);

    // 同类正对照在先：行本身渲染出来了，不是整块没渲染
    expect(document.querySelector('.message-row')).toBeInTheDocument();
    expect(document.querySelector('.message-row--tight')).toBeNull();
  });

  it('撤回态渲染的是居中系统行，不套用收窄（两边贴紧会让人以为它属于某一组）', () => {
    render(
      <MessageBubble
        message={makeMessage({ is_recalled: true })}
        isOwn={false}
        session={session}
        friend={friend}
        tightBelow
      />,
    );

    expect(document.querySelector('.recall-system-row')).toBeInTheDocument();
    expect(document.querySelector('.message-row--tight')).toBeNull();
  });
});
