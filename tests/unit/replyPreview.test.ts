/**
 * 群消息回复引用纯逻辑测试（src/chat/group/replyPreview.ts）
 *
 * 覆盖三件真实会写错的事：
 * 1. summarize：撤回优先级必须高于类型分支（否则引用块继续泄露已撤回内容）；
 *    多行文本必须折叠空白再截断（否则单行引用块被换行撑成一堆空格）
 * 2. buildReplyPreviewIndex：显示名解析器要真的被用上（群内私有备注口径）
 * 3. resolveReplyQuote：非回复 → null（不渲染）；回复但原消息不在窗口 → 占位而非 null
 *    —— 这条正是「原消息不在已加载范围」降级链路的第一环，返回 null 会让引用块整个消失，
 *    用户根本看不出这是一条回复。
 */

import { describe, it, expect } from 'vitest';
import type { GroupMessage } from '../../src/api/groupMessages';
import {
  REPLY_EMPTY_TEXT,
  REPLY_PREVIEW_MAX_LEN,
  REPLY_UNRESOLVED_TEXT,
  buildReplyPreviewIndex,
  resolveReplyQuote,
  summarizeGroupMessageForReply,
  truncateReplyText,
} from '../../src/chat/group/replyPreview';

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

describe('summarizeGroupMessageForReply', () => {
  it('已撤回优先于一切类型分支 —— 绝不回显原内容', () => {
    expect(
      summarizeGroupMessageForReply(
        makeMessage({ is_recalled: true, message_content: '机密原文', message_type: 'text' }),
      ),
    ).toBe('消息已撤回');
    // 图片类同理：撤回后不给 [图片] 而给撤回文案
    expect(
      summarizeGroupMessageForReply(makeMessage({ is_recalled: true, message_type: 'image' })),
    ).toBe('消息已撤回');
  });

  it('非文本类型给类型标签', () => {
    expect(summarizeGroupMessageForReply(makeMessage({ message_type: 'image' }))).toBe('[图片]');
    expect(summarizeGroupMessageForReply(makeMessage({ message_type: 'video' }))).toBe('[视频]');
    expect(summarizeGroupMessageForReply(makeMessage({ message_type: 'meeting_invite' }))).toBe('[会议邀请]');
    expect(summarizeGroupMessageForReply(makeMessage({ message_type: 'card' }))).toBe('[卡片]');
  });

  it('文件类型带上文件名；文件名为空时退化为纯标签', () => {
    expect(
      summarizeGroupMessageForReply(makeMessage({ message_type: 'file', message_content: '报表.xlsx' })),
    ).toBe('[文件] 报表.xlsx');
    expect(
      summarizeGroupMessageForReply(makeMessage({ message_type: 'file', message_content: '' })),
    ).toBe('[文件]');
  });

  it('文本类型折叠多行并截断', () => {
    expect(
      summarizeGroupMessageForReply(makeMessage({ message_content: '第一行\n第二行' })),
    ).toBe('第一行 第二行');
    const long = 'x'.repeat(REPLY_PREVIEW_MAX_LEN + 5);
    expect(summarizeGroupMessageForReply(makeMessage({ message_content: long })).endsWith('…')).toBe(true);
  });

  it('空文本给兜底占位（不返回空串，否则引用块只剩名字一行）', () => {
    expect(summarizeGroupMessageForReply(makeMessage({ message_content: '   ' }))).toBe(REPLY_EMPTY_TEXT);
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

  it('不传解析器时退化为消息自带 sender_nickname', () => {
    const index = buildReplyPreviewIndex([makeMessage({ message_uuid: 'a', sender_nickname: 'Bob' })]);
    expect(index.get('a')?.senderName).toBe('Bob');
  });
});

describe('resolveReplyQuote', () => {
  const index = buildReplyPreviewIndex([
    makeMessage({ message_uuid: 'target', sender_nickname: 'Alice', message_content: '被引用的原文' }),
  ]);

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
