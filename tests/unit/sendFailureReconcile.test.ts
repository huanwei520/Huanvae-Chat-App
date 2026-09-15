/**
 * 媒体假阴性失败的服务端对账（sendFailureReconcile）回归
 *
 * 病灶：媒体上传的「建消息」发生在服务端响应里（秒传分支 / confirm）。响应在回程
 * 丢失时，客户端标 failed，而消息其实已建好、对端已收到 —— 假阴性。
 * 存储路径服务端不把自己的消息经 WS 推回本机 ⇒ 唯一真值来源是服务端历史。
 *
 * ① probeSentMedia 匹配规则：sender + 类型 + 派生正文 + 时间下界；多条取最早。
 * ② reconcileFailedSendingEntry 全流程：命中 ⇒ 落库 + markSent（done + realUuid）；
 *   未命中/网络仍失败 ⇒ 保持 failed 原状。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  probeSentMedia,
  reconcileFailedSendingEntry,
  type MediaProbe,
} from '../../src/chat/shared/sendFailureReconcile';
import { useSendingMediaStore, type SendingMediaEntry } from '../../src/stores/sendingMediaStore';
import type { ApiClient } from '../../src/api/client';

// db 是 Tauri invoke 后端 —— 单测里必须整体 mock 掉
vi.mock('../../src/db', () => ({
  saveMessage: vi.fn().mockResolvedValue(undefined),
}));

import { saveMessage } from '../../src/db';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');

function friendRow(overrides: Record<string, unknown>) {
  return {
    message_uuid: 'srv-uuid-1',
    sender_id: 'user-self',
    message_content: '[图片] shot.png',
    message_type: 'image',
    file_uuid: 'fu-1',
    file_url: 'https://files.example/fu-1',
    file_size: 12345,
    image_width: 800,
    image_height: 600,
    reply_to: null,
    media_group_id: null,
    media_group_index: null,
    media_group_count: null,
    seq: 41,
    send_time: '2026-09-13T11:59:30.000Z',
    is_recalled: false,
    ...overrides,
  };
}

function probe(overrides: Partial<MediaProbe> = {}): MediaProbe {
  return {
    conversationType: 'friend',
    targetId: 'friend-1',
    kind: 'image',
    caption: undefined,
    filename: 'shot.png',
    // 入队时刻 = NOW - 1min；服务端时钟偏差容差 5min
    sendTimeIso: new Date(NOW - 60_000).toISOString(),
    userId: 'user-self',
    ...overrides,
  };
}

function fakeApi(history: unknown[]): ApiClient {
  return {
    get: vi.fn().mockResolvedValue({ messages: history }),
  } as unknown as ApiClient;
}

function entry(overrides: Partial<SendingMediaEntry> = {}): SendingMediaEntry {
  return {
    clientId: 'client_test-1',
    file: new File(['bytes'], 'shot.png', { type: 'image/png' }),
    conversationKey: 'friend:user-self:friend-1',
    conversationType: 'friend',
    targetId: 'friend-1',
    status: 'failed',
    percent: 0,
    shape: { kind: 'single', groupId: null, index: null, count: null },
    preview: {
      name: 'shot.png',
      kind: 'image',
      size: 12345,
      localPath: '',
      width: 800,
      height: 600,
      previewUrl: null,
    },
    caption: undefined,
    realUuid: null,
    sendTime: new Date(NOW - 60_000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 清空真实 zustand store 里可能残留的条目
  const s = useSendingMediaStore.getState();
  s.orderByConversation.entry_ = [];
  useSendingMediaStore.setState({
    entries: {},
    orderByConversation: { 'friend:user-self:friend-1': ['client_test-1'] },
  });
  useSendingMediaStore.getState().entries['client_test-1'] = undefined as never;
});

describe('① probeSentMedia 匹配规则', () => {
  it('命中：自己发的 + 同类型 + 同派生正文 + 时间在入队之后', async () => {
    const hit = await probeSentMedia(fakeApi([friendRow({})]), probe());
    expect(hit).not.toBeNull();
    expect(hit?.message_uuid).toBe('srv-uuid-1');
    expect(hit?.seq).toBe(41);
  });

  it('配文非空时按 caption 派生正文匹配（caption 取代 [图片] 文件名）', async () => {
    const hit = await probeSentMedia(
      fakeApi([friendRow({ message_content: '看这张' })]),
      probe({ caption: '看这张' }),
    );
    expect(hit?.message_uuid).toBe('srv-uuid-1');
  });

  it('别人发的同正文消息不算（sender 不符）', async () => {
    const hit = await probeSentMedia(
      fakeApi([friendRow({ sender_id: 'friend-1' })]),
      probe(),
    );
    expect(hit).toBeNull();
  });

  it('同正文但早于入队时刻（减容差）的旧消息不冒领', async () => {
    const hit = await probeSentMedia(
      fakeApi([friendRow({ send_time: '2026-09-13T10:00:00.000Z' })]),
      probe(),
    );
    expect(hit).toBeNull();
  });

  it('正文对不上（文件名/配文不同）不认领', async () => {
    const hit = await probeSentMedia(
      fakeApi([friendRow({ message_content: '[图片] other.png' })]),
      probe(),
    );
    expect(hit).toBeNull();
  });

  it('类型对不上不认领', async () => {
    const hit = await probeSentMedia(
      fakeApi([friendRow({ message_type: 'video' })]),
      probe(),
    );
    expect(hit).toBeNull();
  });

  it('多条命中取最早的那条（这次上传建的是第一条）', async () => {
    const hit = await probeSentMedia(fakeApi([
      friendRow({ message_uuid: 'srv-uuid-2', send_time: '2026-09-13T11:59:50.000Z', seq: 43 }),
      friendRow({ message_uuid: 'srv-uuid-1', send_time: '2026-09-13T11:59:30.000Z', seq: 41 }),
    ]), probe());
    expect(hit?.message_uuid).toBe('srv-uuid-1');
  });

  it('空历史 ⇒ null', async () => {
    const hit = await probeSentMedia(fakeApi([]), probe());
    expect(hit).toBeNull();
  });

  it('群会话走群历史端点', async () => {
    const api = {
      get: vi.fn().mockImplementation((_path: string) => {
        expect(String(_path)).toContain('/api/group_messages');
        return Promise.resolve({
          messages: [friendRow({})],
        });
      }),
    } as unknown as ApiClient;
    const hit = await probeSentMedia(api, probe({ conversationType: 'group', targetId: 'group-9' }));
    expect(hit?.message_uuid).toBe('srv-uuid-1');
  });
});

describe('② reconcileFailedSendingEntry 全流程', () => {
  it('命中 ⇒ 落库（真实 seq / file 字段）+ markSent（done + realUuid）', async () => {
    const e = entry();
    useSendingMediaStore.getState().enqueue([{
      clientId: e.clientId,
      file: e.file,
      conversationKey: e.conversationKey,
      conversationType: e.conversationType,
      targetId: e.targetId,
      shape: e.shape,
      preview: { name: e.preview.name, kind: e.preview.kind, size: e.preview.size, localPath: e.preview.localPath, width: e.preview.width, height: e.preview.height },
      caption: e.caption,
      replyTo: e.replyTo,
      sendTime: e.sendTime,
    }]);
    // enqueue 后状态是 pending，手工拨到 failed（对账的前置状态）
    useSendingMediaStore.getState().markFailed(e.clientId, '网络错误');
    expect(useSendingMediaStore.getState().entries[e.clientId]?.status).toBe('failed');

    await reconcileFailedSendingEntry(fakeApi([friendRow({})]), e, {
      userId: 'user-self',
      profile: { user_nickname: '测试者', user_avatar_url: null },
    });

    expect(saveMessage).toHaveBeenCalledTimes(1);
    const saved = (saveMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.message_uuid).toBe('srv-uuid-1');
    expect(saved.seq).toBe(41);
    expect(saved.file_uuid).toBe('fu-1');
    expect(saved.image_width).toBe(800);
    expect(saved.sender_id).toBe('user-self');

    const after = useSendingMediaStore.getState().entries[e.clientId];
    expect(after?.status).toBe('done');
    expect(after?.realUuid).toBe('srv-uuid-1');
  });

  it('未命中（真失败）⇒ 保持 failed，不落库', async () => {
    const e = entry();
    useSendingMediaStore.getState().enqueue([{
      clientId: e.clientId,
      file: e.file,
      conversationKey: e.conversationKey,
      conversationType: e.conversationType,
      targetId: e.targetId,
      shape: e.shape,
      preview: { name: e.preview.name, kind: e.preview.kind, size: e.preview.size, localPath: e.preview.localPath, width: e.preview.width, height: e.preview.height },
      caption: e.caption,
      replyTo: e.replyTo,
      sendTime: e.sendTime,
    }]);
    useSendingMediaStore.getState().markFailed(e.clientId, '网络错误');

    await reconcileFailedSendingEntry(fakeApi([]), e, {
      userId: 'user-self',
      profile: { user_nickname: '测试者', user_avatar_url: null },
    });

    expect(saveMessage).not.toHaveBeenCalled();
    expect(useSendingMediaStore.getState().entries[e.clientId]?.status).toBe('failed');
    expect(useSendingMediaStore.getState().entries[e.clientId]?.realUuid).toBeNull();
  });

  it('对账请求自身网络失败 ⇒ 永不抛错，保持 failed（尽力而为契约）', async () => {
    const e = entry();
    const api = { get: vi.fn().mockRejectedValue(new Error('仍断网')) } as unknown as ApiClient;
    await expect(
      reconcileFailedSendingEntry(api, e, {
        userId: 'user-self',
        profile: { user_nickname: '测试者', user_avatar_url: null },
      }),
    ).resolves.toBeUndefined();
    expect(saveMessage).not.toHaveBeenCalled();
  });
});
