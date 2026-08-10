/**
 * 会话卡片预览的「发送者昵称前缀」两端一致性测试（L2：jsdom + mock db/session）
 *
 * 契约（src/hooks/useLocalConversations.ts groupSenderPrefix）：
 * - **群聊**卡片预览 = `发送者昵称: 内容`；自己发的是 `我: 内容`
 * - **单聊 / bot** 卡片预览 = 纯内容，**不加任何前缀**（1:1 会话里发送者无歧义）
 * - 系统消息（content_type=system）不加前缀；发送者不可辨（sender_name=null 且非本人）不加前缀
 * - 文件类消息前缀作用在占位文本上：`昵称: [图片]`
 *
 * 本测试**不 mock useLocalConversations**，而是喂真实 SQLite 行形态
 * （ConversationWithPreview）走真 hook → 真组件 → 断言渲染出的 DOM 文本，
 * 因此覆盖的是「DB 行 → 屏幕文本」整条链路，而非测试自己写死的字符串。
 * 桌面 UnifiedList 与移动 MobileChatList 用**同一批行**跑同一组断言，
 * 两端呈现不一致会直接翻红。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import type { Friend, Group } from '../../src/types/chat';
import type { ConversationWithPreview } from '../../src/db';
import { getFriendConversationId } from '../../src/utils/conversationId';

const ME = 'me';

const mocks = vi.hoisted(() => ({
  getConversationPreviews: vi.fn(),
  setConversationPinned: vi.fn(),
}));

// 两个列表组件都从 src/db import setConversationPinned（置顶菜单），
// 工厂里缺一个导出就会让整棵树渲染报 "No export is defined on the mock"
vi.mock('../../src/db', () => ({
  getConversationPreviews: mocks.getConversationPreviews,
  setConversationPinned: mocks.setConversationPinned,
}));
vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => ({ session: { userId: ME } }),
  useApi: () => ({}),
}));
vi.mock('../../src/update/components/MobileDownloadCard', () => ({ MobileDownloadCard: () => null }));
vi.mock('../../src/components/search/GlobalMessageSearchResults', () => ({ GlobalMessageSearchResults: () => null }));

import { UnifiedList } from '../../src/components/unified/UnifiedList';
import { MobileChatList } from '../../src/pages/mobile/MobileChatList';

// ---------------------------------------------------------------- 数据夹具

function row(
  id: string,
  type: 'friend' | 'group',
  msg: {
    content: string;
    contentType?: string;
    senderId?: string | null;
    senderName?: string | null;
  },
): ConversationWithPreview {
  return {
    id,
    type,
    name: id,
    avatar_url: null,
    last_seq: 1,
    unread_count: 0,
    is_muted: false,
    is_pinned: false,
    updated_at: '2026-01-01T00:00:00Z',
    msg_content: msg.content,
    msg_content_type: msg.contentType ?? 'text',
    msg_send_time: '2026-01-01T00:00:00Z',
    msg_sender_id: msg.senderId ?? 'other',
    msg_sender_name: msg.senderName ?? null,
  };
}

/** 群：他人发的文本 → 应带昵称前缀 */
const G_OTHER = 'g-other';
/** 群：自己发的文本 → 应带「我」前缀 */
const G_SELF = 'g-self';
/** 群：他人发的图片 → 前缀 + 占位文本 */
const G_IMAGE = 'g-image';
/** 群：系统消息 → 不加前缀 */
const G_SYSTEM = 'g-system';
/** 群：发送者昵称缺失且非本人 → 不加前缀（不退化成裸用户 ID） */
const G_ANON = 'g-anon';

const FRIEND_ID = 'fa';
const BOT_ID = 'bot_helper';

const PREVIEW_ROWS: ConversationWithPreview[] = [
  row(G_OTHER, 'group', { content: '今晚吃什么', senderName: '张三' }),
  row(G_SELF, 'group', { content: '我来订位子', senderId: ME, senderName: '本人昵称' }),
  row(G_IMAGE, 'group', { content: 'https://x/y.png', contentType: 'image', senderName: '李四' }),
  row(G_SYSTEM, 'group', { content: '王五加入了群聊', contentType: 'system', senderName: '王五' }),
  row(G_ANON, 'group', { content: '无名氏说的话', senderId: 'stranger', senderName: null }),
  row(getFriendConversationId(ME, FRIEND_ID), 'friend', { content: '好友的悄悄话', senderName: '阿美' }),
  row(getFriendConversationId(ME, BOT_ID), 'friend', { content: '机器人的回复', senderName: '助手机器人' }),
];

function group(id: string, name: string): Group {
  return {
    group_id: id, group_name: name, group_avatar_url: '', role: 'member',
    unread_count: 0, last_message_content: null, last_message_time: null,
  };
}
const GROUPS: Group[] = [
  group(G_OTHER, '群-他人'),
  group(G_SELF, '群-自己'),
  group(G_IMAGE, '群-图片'),
  group(G_SYSTEM, '群-系统'),
  group(G_ANON, '群-无名'),
];

function friend(id: string, nickname: string): Friend {
  return {
    friend_id: id, friend_nickname: nickname, friend_avatar_url: null,
    add_time: '2026-01-01T00:00:00Z', approve_reason: null, friend_remark: null,
    is_blacklisted: false, is_special_care: false,
  };
}
const FRIENDS: Friend[] = [friend(FRIEND_ID, '阿美'), friend(BOT_ID, '助手机器人')];

// ------------------------------------------------------------ 两端渲染适配

/** 桌面：消息 tab 下 .conv-preview 是预览文本（好友 tab 才显示 @id） */
async function renderDesktop(): Promise<(name: string) => string> {
  const { container } = render(
    <UnifiedList
      activeTab="chat"
      friends={FRIENDS}
      groups={GROUPS}
      friendsLoading={false}
      groupsLoading={false}
      friendsError={null}
      groupsError={null}
      searchQuery=""
      onSearchChange={vi.fn()}
      selectedTarget={null}
      onSelectTarget={vi.fn()}
      unreadSummary={null}
    />,
  );
  await waitFor(() => {
    expect(container.querySelectorAll('.conversation-item').length).toBeGreaterThan(0);
  });
  return (name: string) => {
    const cards = Array.from(container.querySelectorAll('.conversation-item'));
    const card = cards.find((c) => c.querySelector('.conv-name-text')?.textContent === name);
    expect(card, `桌面未找到卡片：${name}`).toBeTruthy();
    return card!.querySelector('.conv-preview')!.textContent ?? '';
  };
}

/** 移动：.mobile-contact-role 是预览文本 */
async function renderMobile(): Promise<(name: string) => string> {
  const { container } = render(
    <MobileChatList
      friends={FRIENDS}
      groups={GROUPS}
      searchQuery=""
      onSelectTarget={vi.fn()}
      unreadSummary={null}
    />,
  );
  await waitFor(() => {
    // 置顶 AI 卡恒在，故等到普通会话卡也进来（AI 卡 + 7 张会话卡）
    expect(container.querySelectorAll('.mobile-contact-card').length).toBeGreaterThan(1);
  });
  return (name: string) => {
    const cards = Array.from(container.querySelectorAll('.mobile-contact-card'));
    const card = cards.find((c) => c.querySelector('.mobile-contact-name')?.textContent?.startsWith(name));
    expect(card, `移动端未找到卡片：${name}`).toBeTruthy();
    return card!.querySelector('.mobile-contact-role')!.textContent ?? '';
  };
}

const ENDS: [string, () => Promise<(name: string) => string>][] = [
  ['桌面 UnifiedList', renderDesktop],
  ['移动 MobileChatList', renderMobile],
];

beforeEach(() => {
  cleanup();
  mocks.getConversationPreviews.mockReset();
  mocks.getConversationPreviews.mockResolvedValue(PREVIEW_ROWS);
});

describe.each(ENDS)('会话卡片预览发送者前缀 — %s', (_label, renderEnd) => {
  it('群聊：他人消息带「昵称: 」前缀', async () => {
    const previewOf = await renderEnd();
    expect(previewOf('群-他人')).toBe('张三: 今晚吃什么');
  });

  it('群聊：自己发的消息带「我: 」前缀（不显示自己的昵称）', async () => {
    const previewOf = await renderEnd();
    expect(previewOf('群-自己')).toBe('我: 我来订位子');
  });

  it('群聊：文件类消息前缀作用在占位文本上', async () => {
    const previewOf = await renderEnd();
    expect(previewOf('群-图片')).toBe('李四: [图片]');
  });

  it('群聊：系统消息不加前缀', async () => {
    const previewOf = await renderEnd();
    expect(previewOf('群-系统')).toBe('王五加入了群聊');
  });

  it('群聊：发送者昵称缺失且非本人 → 不加前缀，也不暴露裸用户 ID', async () => {
    const previewOf = await renderEnd();
    const text = previewOf('群-无名');
    expect(text).toBe('无名氏说的话');
    expect(text).not.toContain('stranger');
  });

  // ---- 反向：单聊 / bot 不得出现前缀 ----

  it('单聊（好友）：不加前缀', async () => {
    const previewOf = await renderEnd();
    const text = previewOf('阿美');
    expect(text).toBe('好友的悄悄话');
    expect(text).not.toContain('阿美: ');
  });

  it('bot 会话：不加前缀', async () => {
    const previewOf = await renderEnd();
    const text = previewOf('助手机器人');
    expect(text).toBe('机器人的回复');
    expect(text).not.toContain(': ');
  });

  it('单聊：自己发的消息也不加「我: 」前缀', async () => {
    mocks.getConversationPreviews.mockResolvedValue([
      row(getFriendConversationId(ME, FRIEND_ID), 'friend', {
        content: '我发给好友的话', senderId: ME, senderName: '本人昵称',
      }),
    ]);
    const previewOf = await renderEnd();
    expect(previewOf('阿美')).toBe('我发给好友的话');
  });
});

describe('两端呈现一致性（同一批 DB 行 → 同一串预览文本）', () => {
  it('桌面与移动对每张卡片渲染完全相同的预览文本', async () => {
    const desktopOf = await renderDesktop();
    const names = ['群-他人', '群-自己', '群-图片', '群-系统', '群-无名', '阿美', '助手机器人'];
    const desktopTexts = names.map(desktopOf);

    cleanup();
    const mobileOf = await renderMobile();
    const mobileTexts = names.map(mobileOf);

    expect(mobileTexts).toEqual(desktopTexts);
    // 防「两端都为空/都渲染不出」的空转通过
    expect(desktopTexts).toContain('张三: 今晚吃什么');
  });
});
