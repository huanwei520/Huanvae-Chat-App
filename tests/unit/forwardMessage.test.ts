/**
 * 转发语义边界（src/chat/shared/forwardMessage.ts）
 *
 * 这里守的是**三条会发出坏消息的边界**，不是"函数跑得通"：
 * - 可交互卡片 / 群系统消息 / 已撤回 / 在途 / 缺 file_uuid 的媒体 → 不给转发入口
 * - 请求体里**不得出现** reply_to 与 media_group 三件套（后端 400 / 对方留洞）
 * - 批量转发按发送时间升序（列表数组方向随实现变，不排序会发成倒序）
 */

import { describe, it, expect } from 'vitest';
import {
  canForwardMessage,
  summarizeForwardSource,
  buildFriendForwardRequest,
  buildGroupForwardRequest,
  collectForwardSources,
  toForwardSource,
  type ForwardSource,
} from '../../src/chat/shared/forwardMessage';

function src(over: Partial<ForwardSource> = {}): ForwardSource {
  return {
    message_uuid: 'm1',
    message_content: '明天的评审挪到 15:00',
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    send_time: '2026-08-17T09:42:00Z',
    senderName: '林知遥',
    is_recalled: false,
    ...over,
  };
}

describe('canForwardMessage —— 不可转发的一律不给入口', () => {
  it('文本消息可转发', () => {
    expect(canForwardMessage(src())).toBe(true);
  });

  it('带 file_uuid 的图片 / 视频 / 文件可转发', () => {
    for (const t of ['image', 'video', 'file']) {
      expect(canForwardMessage(src({ message_type: t, file_uuid: 'f-1', message_content: `[图片] a.png` })))
        .toBe(true);
    }
  });

  it('会议邀请可转发（内容是自包含 JSON，不依赖原会话）', () => {
    expect(canForwardMessage(src({ message_type: 'meeting_invite', message_content: '{"room_id":"1"}' }))).toBe(true);
  });

  it('可交互卡片不可转发：action 回调绑 message_uuid，转发后对方点开是坏的', () => {
    expect(canForwardMessage(src({ message_type: 'card', message_content: '{}' }))).toBe(false);
  });

  it('群系统消息不可转发', () => {
    expect(canForwardMessage(src({ message_type: 'system' }))).toBe(false);
  });

  it('已撤回不可转发', () => {
    expect(canForwardMessage(src({ is_recalled: true }))).toBe(false);
  });

  it('在途 / 发送失败不可转发（还没有服务端身份）', () => {
    expect(canForwardMessage(src({ sendStatus: 'sending' }))).toBe(false);
    expect(canForwardMessage(src({ sendStatus: 'failed' }))).toBe(false);
    expect(canForwardMessage(src({ sendStatus: 'sent' }))).toBe(true);
  });

  it('媒体类但缺 file_uuid 不可转发（无从复用文件）', () => {
    expect(canForwardMessage(src({ message_type: 'image', file_uuid: null }))).toBe(false);
    expect(canForwardMessage(src({ message_type: 'file', file_uuid: null }))).toBe(false);
  });
});

describe('summarizeForwardSource —— 预览条那一行摘要', () => {
  it('文本原样', () => {
    expect(summarizeForwardSource(src())).toBe('明天的评审挪到 15:00');
  });

  it('图片带文件名，且不会把标签重复成 [图片] [图片] a.png', () => {
    expect(summarizeForwardSource(src({ message_type: 'image', message_content: '[图片] a.png' })))
      .toBe('[图片] a.png');
  });

  it('内容没带标签前缀时也补得出标签', () => {
    expect(summarizeForwardSource(src({ message_type: 'file', message_content: 'report.pdf' })))
      .toBe('[文件] report.pdf');
  });

  it('会议邀请只给标签，不把 JSON 漏到预览里', () => {
    const summary = summarizeForwardSource(src({
      message_type: 'meeting_invite',
      message_content: '{"room_id":"42","password":"secret"}',
    }));
    expect(summary).toBe('[会议邀请]');
    expect(summary).not.toContain('secret');
  });
});

describe('buildFriendForwardRequest / buildGroupForwardRequest —— 请求体边界', () => {
  const media = src({
    message_type: 'image',
    message_content: '[图片] a.png',
    file_uuid: 'file-uuid-1',
    file_url: 'https://example.invalid/a.png',
    file_size: 1234,
  });

  it('私聊：复用原 file_uuid / file_url / file_size', () => {
    const req = buildFriendForwardRequest(media, 'friend-1');
    expect(req.receiver_id).toBe('friend-1');
    expect(req.file_uuid).toBe('file-uuid-1');
    expect(req.file_url).toBe('https://example.invalid/a.png');
    expect(req.file_size).toBe(1234);
    expect(req.message_type).toBe('image');
  });

  it('私聊：请求体里没有 reply_to，也没有 media_group 三件套', () => {
    const req = buildFriendForwardRequest(
      { ...media, message_content: '[图片] a.png' },
      'friend-1',
    ) as unknown as Record<string, unknown>;
    expect('reply_to' in req).toBe(false);
    expect('media_group_id' in req).toBe(false);
    expect('media_group_index' in req).toBe(false);
    expect('media_group_count' in req).toBe(false);
  });

  it('群：同样只带文件三件与内容，不带 reply_to / media_group', () => {
    const req = buildGroupForwardRequest(media, 'group-1') as unknown as Record<string, unknown>;
    expect(req.group_id).toBe('group-1');
    expect(req.file_uuid).toBe('file-uuid-1');
    expect('reply_to' in req).toBe(false);
    expect('media_group_id' in req).toBe(false);
  });

  it('群：纯文本时文件字段是 undefined（透传对象里等于不带该键）', () => {
    const req = buildGroupForwardRequest(src(), 'group-1');
    expect(req.file_uuid).toBeUndefined();
    expect(req.file_url).toBeUndefined();
    expect(req.file_size).toBeUndefined();
  });
});

describe('toForwardSource —— 逐键映射，不把消息上的其它字段带进去', () => {
  it('只保留转发需要的键，reply_to / media_group_id 不会漏过来', () => {
    const s = toForwardSource({
      message_uuid: 'm9',
      message_content: '[图片] b.png',
      message_type: 'image',
      file_uuid: 'f9',
      file_url: null,
      file_size: 9,
      send_time: '2026-08-17T10:00:00Z',
      is_recalled: false,
      // 下面两个是消息上真实存在、但转发**不该继承**的字段
      reply_to: 'other-msg',
      media_group_id: 'grp-1',
    } as never, '苏晚') as unknown as Record<string, unknown>;

    expect(s.senderName).toBe('苏晚');
    expect('reply_to' in s).toBe(false);
    expect('media_group_id' in s).toBe(false);
  });
});

describe('collectForwardSources —— 批量转发的选取与顺序', () => {
  const list = [
    { ...src({ message_uuid: 'c', send_time: '2026-08-17T12:00:00Z' }) },
    { ...src({ message_uuid: 'a', send_time: '2026-08-17T10:00:00Z' }) },
    { ...src({ message_uuid: 'b', send_time: '2026-08-17T11:00:00Z' }) },
    { ...src({ message_uuid: 'card', message_type: 'card' }) },
  ];

  it('只取选中的、且按发送时间升序（不是数组原序）', () => {
    const out = collectForwardSources(list, new Set(['a', 'b', 'c']), () => '我');
    expect(out.map((m) => m.message_uuid)).toEqual(['a', 'b', 'c']);
  });

  it('选中里混进不可转发的会被剔除', () => {
    const out = collectForwardSources(list, new Set(['a', 'card']), () => '我');
    expect(out.map((m) => m.message_uuid)).toEqual(['a']);
  });

  it('全都不可转发时返回空数组（调用方据此不给入口）', () => {
    const out = collectForwardSources(list, new Set(['card']), () => '我');
    expect(out).toEqual([]);
  });

  it('发送者名由回调决定（私聊自己 / 对方，群用消息自带昵称）', () => {
    const out = collectForwardSources(list, new Set(['a']), (m) => `sender-of-${m.message_uuid}`);
    expect(out[0].senderName).toBe('sender-of-a');
  });
});
