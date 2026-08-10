/**
 * 消息回复引用纯逻辑测试（src/chat/shared/replyPreview.ts，群聊 + 私聊共用）
 *
 * 覆盖三件真实会写错的事：
 * 1. summarize：撤回优先级必须高于类型分支（否则引用块继续泄露已撤回内容）；
 *    多行文本必须折叠空白再截断（否则单行引用块被换行撑成一堆空格）
 * 2. buildReplyPreviewIndex：显示名解析器要真的被用上（群内私有备注口径），且对
 *    没有 sender_nickname 字段的私聊消息同样可用（泛型结构最小形状）
 * 3. resolveReplyQuote：非回复 → null（不渲染）；回复但原消息不在窗口 → 占位而非 null
 *    —— 这条正是「原消息不在已加载范围」降级链路的第一环，返回 null 会让引用块整个消失，
 *    用户根本看不出这是一条回复。
 */

import { describe, it, expect } from 'vitest';
import type { GroupMessage } from '../../src/api/groupMessages';
import type { Message } from '../../src/types/chat';
import {
  REPLY_EMPTY_TEXT,
  REPLY_PREVIEW_MAX_LEN,
  REPLY_UNRESOLVED_TEXT,
  buildReplyPreviewIndex,
  resolveReplyQuote,
  summarizeMessageForReply,
  truncateReplyText,
} from '../../src/chat/shared/replyPreview';

function makeMessage(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    message_uuid: 'u-1',
    group_id: 'g-1',
    sender_id: 'them',
    sender_nickname: 'Alice',
    sender_avatar_url: '',
    message_content: 'hello',
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    file_hash: null,
    image_width: null,
    image_height: null,
    reply_to: null,
    send_time: '2026-01-01T00:00:00Z',
    is_recalled: false,
    seq: 1,
    ...overrides,
  };
}

/** 私聊消息基线：注意它**没有** sender_nickname / group_id 等群消息专属字段 */
function makePrivate(): Message {
  return {
    message_uuid: 'p-1',
    sender_id: 'me',
    receiver_id: 'peer',
    message_content: 'hi',
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    file_hash: null,
    reply_to: null,
    send_time: '2026-01-01T00:00:00Z',
    is_recalled: false,
  };
}

describe('truncateReplyText', () => {
  it('折叠换行/连续空白为单空格并 trim', () => {
    expect(truncateReplyText('  第一行\n\n第二行\t尾  ')).toBe('第一行 第二行 尾');
  });

  it('未超长时原样返回（不加省略号）', () => {
    expect(truncateReplyText('短文本')).toBe('短文本');
  });

  it('超长时截断到上限并加省略号', () => {
    const long = 'a'.repeat(REPLY_PREVIEW_MAX_LEN + 20);
    const out = truncateReplyText(long);
    expect(out).toBe(`${'a'.repeat(REPLY_PREVIEW_MAX_LEN)}…`);
    expect(out.length).toBe(REPLY_PREVIEW_MAX_LEN + 1);
  });

  it('折叠发生在截断之前（空白不占预算）', () => {
    // 60 个 'a' 之间塞满空格：折叠后正好 60 字 → 不该被截断
    const spaced = 'a'.repeat(REPLY_PREVIEW_MAX_LEN).split('').join(' ');
    expect(truncateReplyText(spaced.replace(/ /g, '')).endsWith('…')).toBe(false);
  });
});

describe('summarizeMessageForReply', () => {
  it('已撤回优先于一切类型分支 —— 绝不回显原内容', () => {
    expect(
      summarizeMessageForReply(
        makeMessage({ is_recalled: true, message_content: '机密原文', message_type: 'text' }),
      ),
    ).toBe('消息已撤回');
    // 图片类同理：撤回后不给 [图片] 而给撤回文案
    expect(
      summarizeMessageForReply(makeMessage({ is_recalled: true, message_type: 'image' })),
    ).toBe('消息已撤回');
  });

  it('非文本类型给类型标签', () => {
    expect(summarizeMessageForReply(makeMessage({ message_type: 'image' }))).toBe('[图片]');
    expect(summarizeMessageForReply(makeMessage({ message_type: 'video' }))).toBe('[视频]');
    expect(summarizeMessageForReply(makeMessage({ message_type: 'meeting_invite' }))).toBe('[会议邀请]');
    expect(summarizeMessageForReply(makeMessage({ message_type: 'card' }))).toBe('[卡片]');
  });

  it('文件类型带上文件名；文件名为空时退化为纯标签', () => {
    expect(
      summarizeMessageForReply(makeMessage({ message_type: 'file', message_content: '报表.xlsx' })),
    ).toBe('[文件] 报表.xlsx');
    expect(
      summarizeMessageForReply(makeMessage({ message_type: 'file', message_content: '' })),
    ).toBe('[文件]');
  });

  it('文本类型折叠多行并截断', () => {
    expect(
      summarizeMessageForReply(makeMessage({ message_content: '第一行\n第二行' })),
    ).toBe('第一行 第二行');
    const long = 'x'.repeat(REPLY_PREVIEW_MAX_LEN + 5);
    expect(summarizeMessageForReply(makeMessage({ message_content: long })).endsWith('…')).toBe(true);
  });

  it('空文本给兜底占位（不返回空串，否则引用块只剩名字一行）', () => {
    expect(summarizeMessageForReply(makeMessage({ message_content: '   ' }))).toBe(REPLY_EMPTY_TEXT);
  });
});

describe('buildReplyPreviewIndex', () => {
  it('按 message_uuid 建索引，且真的使用注入的显示名解析器（群内备注口径）', () => {
    const messages = [
      makeMessage({ message_uuid: 'a', sender_id: 'u1', sender_nickname: '原昵称', message_content: '正文A' }),
      makeMessage({ message_uuid: 'b', sender_id: 'u2', message_type: 'image' }),
    ];
    const index = buildReplyPreviewIndex(messages, (m) => (m.sender_id === 'u1' ? '我给他的备注' : m.sender_nickname));

    expect(index.get('a')).toEqual({ senderName: '我给他的备注', text: '正文A' });
    expect(index.get('b')).toEqual({ senderName: 'Alice', text: '[图片]' });
    expect(index.size).toBe(2);
  });

  // 私聊消息（Message）**没有** sender_nickname 字段——这正是 resolveSenderName 必传的原因。
  // 本用例锁住「同一套纯逻辑对两种消息形态都可用」这个上提到 chat/shared 的理由本身。
  it('对私聊消息（无 sender_nickname 字段）同样可用，显示名由调用方注入', () => {
    const privateMessages: Message[] = [
      { ...makePrivate(), message_uuid: 'p1', sender_id: 'me', message_content: '我说的' },
      { ...makePrivate(), message_uuid: 'p2', sender_id: 'peer', message_type: 'image' },
    ];
    const index = buildReplyPreviewIndex(
      privateMessages,
      (m) => (m.sender_id === 'me' ? '我' : '对方'),
    );

    expect(index.get('p1')).toEqual({ senderName: '我', text: '我说的' });
    expect(index.get('p2')).toEqual({ senderName: '对方', text: '[图片]' });
  });
});

describe('resolveReplyQuote', () => {
  const index = buildReplyPreviewIndex(
    [makeMessage({ message_uuid: 'target', sender_nickname: 'Alice', message_content: '被引用的原文' })],
    (m) => m.sender_nickname,
  );

  it('非回复消息返回 null（气泡不渲染引用块）', () => {
    expect(resolveReplyQuote(index, null)).toBeNull();
    expect(resolveReplyQuote(index, undefined)).toBeNull();
    expect(resolveReplyQuote(index, '')).toBeNull();
  });

  it('命中原消息：给出发送者显示名 + 摘要，resolved=true', () => {
    expect(resolveReplyQuote(index, 'target')).toEqual({
      senderName: 'Alice',
      text: '被引用的原文',
      resolved: true,
    });
  });

  it('原消息不在已加载窗口：给可点击的占位而不是 null（降级链路第一环）', () => {
    const out = resolveReplyQuote(index, 'not-loaded-uuid');
    expect(out).not.toBeNull();
    expect(out).toEqual({ senderName: null, text: REPLY_UNRESOLVED_TEXT, resolved: false });
  });

  it('索引本身缺失（首帧还没建好）也走占位分支，不抛错', () => {
    expect(resolveReplyQuote(undefined, 'whatever')).toEqual({
      senderName: null,
      text: REPLY_UNRESOLVED_TEXT,
      resolved: false,
    });
  });
});
