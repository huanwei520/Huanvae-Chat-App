/**
 * DB 预览通知防抖逻辑单元测试
 *
 * 测试 src/db/index.ts 中 saveMessage 等写入操作触发的防抖预览变更事件。
 *
 * 包含测试：
 * - saveMessage 完成后应在 150ms 后触发 conversation-previews-changed 事件
 * - 多次快速调用只触发一次事件（防抖）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import * as db from '../../src/db';

const mockInvoke = vi.mocked(invoke);

const minimalMessage = {
  message_uuid: 'msg-1',
  conversation_id: 'conv-1',
  conversation_type: 'friend',
  sender_id: 's1',
  sender_name: 'Test',
  sender_avatar: null,
  content: 'test',
  content_type: 'text',
  file_uuid: null,
  file_url: null,
  file_size: null,
  file_hash: null,
  image_width: null,
  image_height: null,
  seq: 1,
  reply_to: null,
  is_recalled: false,
  is_deleted: false,
  send_time: '2026-01-01T00:00:00Z',
} as Parameters<typeof db.saveMessage>[0];

describe('DB 预览通知防抖逻辑', () => {
  let eventSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockInvoke.mockResolvedValue(undefined);
    eventSpy = vi.fn();
    window.addEventListener('conversation-previews-changed', eventSpy);
  });

  afterEach(() => {
    window.removeEventListener('conversation-previews-changed', eventSpy);
    vi.useRealTimers();
  });

  it('saveMessage 完成后应在 150ms 后触发预览变更事件', async () => {
    await db.saveMessage(minimalMessage);
    expect(eventSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(eventSpy).toHaveBeenCalledTimes(1);
  });

  it('多次快速调用只触发一次事件（防抖）', async () => {
    await db.saveMessage(minimalMessage);
    await db.saveMessage(minimalMessage);
    await db.saveMessage(minimalMessage);
    vi.advanceTimersByTime(150);
    expect(eventSpy).toHaveBeenCalledTimes(1);
  });
});
