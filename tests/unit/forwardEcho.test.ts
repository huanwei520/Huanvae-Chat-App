/**
 * 转发写穿回显（src/chat/shared/forwardEcho.ts）
 *
 * 守的是「发送端本机即时刷新」的三条形状边界：
 * - 回显帧必须与 WS new_message **同形同语义**（source_id = 接收者视角的会话对端），
 *   两个 useLocalXxxMessages 的 `source_id === 目标` 过滤才命中；
 * - 转发边界（不继承 reply_to / 相册三件套）在回显帧里同样成立；
 * - 媒体文件三件套按原消息复用，图片宽高带过去（本机渲染宽高比）。
 */

import { describe, it, expect } from 'vitest';
import { buildForwardEcho } from '../../src/chat/shared/forwardEcho';
import { toForwardSource, type ForwardSource } from '../../src/chat/shared/forwardMessage';

function src(over: Partial<ForwardSource> = {}): ForwardSource {
  return toForwardSource({
    message_uuid: 'm1',
    message_content: '明天的评审挪到 15:00',
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    send_time: '2026-08-17T09:42:00Z',
    is_recalled: false,
    ...over,
  } as ForwardSource, '林知遥');
}

const receipt = { message_uuid: 'srv-uuid-1', send_time: '2026-09-09T12:00:00Z', seq: 42 };

describe('buildForwardEcho —— 与 WS new_message 同形', () => {
  it('好友目标：source_id = 接收者 id，sender = 转发者本人', () => {
    const echo = buildForwardEcho({
      source: src(),
      target: { type: 'friend', id: 'fwdb01' },
      currentUserId: 'fwda01',
      currentUserNickname: 'fwA',
      currentUserAvatarUrl: null,
      receipt,
    });

    expect(echo.type).toBe('new_message');
    expect(echo.source_type).toBe('friend');
    expect(echo.source_id).toBe('fwdb01');
    expect(echo.sender_id).toBe('fwda01');
    expect(echo.sender_nickname).toBe('fwA');
    expect(echo.message_uuid).toBe('srv-uuid-1');
    expect(echo.seq).toBe(42);
    expect(echo.timestamp).toBe('2026-09-09T12:00:00Z');
    expect(echo.content).toBe('明天的评审挪到 15:00');
  });

  it('群目标：source_id = group_id', () => {
    const echo = buildForwardEcho({
      source: src(),
      target: { type: 'group', id: 'g-77' },
      currentUserId: 'fwda01',
      currentUserNickname: 'fwA',
      currentUserAvatarUrl: null,
      receipt,
    });

    expect(echo.source_type).toBe('group');
    expect(echo.source_id).toBe('g-77');
  });

  it('转发边界在回显帧里同样成立：reply_to / 相册三件套恒空', () => {
    const echo = buildForwardEcho({
      source: src({ reply_to: 'should-not-leak' } as Partial<ForwardSource>),
      target: { type: 'friend', id: 'fwdb01' },
      currentUserId: 'fwda01',
      currentUserNickname: 'fwA',
      currentUserAvatarUrl: null,
      receipt,
    });

    expect(echo.reply_to).toBeNull();
    expect(echo.media_group_id).toBeNull();
    expect(echo.media_group_index).toBeNull();
    expect(echo.media_group_count).toBeNull();
  });

  it('媒体消息：file 三件套按原样复用；图片宽高带过去（宽高比不跳变）', () => {
    const echo = buildForwardEcho({
      source: src({
        message_type: 'image',
        message_content: '[图片] b.png',
        file_uuid: 'f-9',
        file_url: '/files/f-9',
        file_size: 2048,
        image_width: 1080,
        image_height: 1920,
      }),
      target: { type: 'friend', id: 'fwdb01' },
      currentUserId: 'fwda01',
      currentUserNickname: 'fwA',
      currentUserAvatarUrl: 'https://cdn.example.com/a.png',
      receipt,
    });

    expect(echo.file_uuid).toBe('f-9');
    expect(echo.file_url).toBe('/files/f-9');
    expect(echo.file_size).toBe(2048);
    expect(echo.image_width).toBe(1080);
    expect(echo.image_height).toBe(1920);
    expect(echo.sender_avatar_url).toBe('https://cdn.example.com/a.png');
  });

  it('非图片消息不带宽高（undefined 不冒充 0）', () => {
    const echo = buildForwardEcho({
      source: src(),
      target: { type: 'friend', id: 'fwdb01' },
      currentUserId: 'fwda01',
      currentUserNickname: 'fwA',
      currentUserAvatarUrl: null,
      receipt,
    });

    expect(echo.image_width).toBeUndefined();
    expect(echo.image_height).toBeUndefined();
  });
});
