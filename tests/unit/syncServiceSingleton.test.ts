/**
 * syncService 单例三件套 + 实时消息落库行为测试
 *
 * 覆盖 services/syncService.ts 此前无测试的部分：
 *  - initSyncService / getSyncService / destroySyncService 单例生命周期
 *    （init 返回并登记实例、重复 init 替换、destroy 置空）
 *  - handleRealtimeMessage：WS 实时消息 → db.saveMessage 的字段映射契约
 *    （seq 缺省归 0、seq 存在时才推进 updateConversationLastSeq）
 *  - handleMessageRecalled：直通 db.markMessageRecalled，错误不被吞
 *
 * mock 仅限外部边界（db）；SyncService 用真实类。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbMock = vi.hoisted(() => ({
  saveMessage: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
  markMessageRecalled: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/db', () => dbMock);

import {
  SyncService,
  initSyncService,
  getSyncService,
  destroySyncService,
} from '../../src/services/syncService';

function makeApi() {
  return {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    getBaseUrl: () => 'http://localhost:8080',
    getAccessToken: () => 'token',
  };
}

const realtimeMsg = {
  source_type: 'group' as const,
  source_id: 'g1',
  message_uuid: 'm1',
  sender_id: 'u2',
  sender_nickname: 'Bob',
  preview: 'hi',
  message_type: 'text',
  timestamp: '2026-01-01T00:00:00Z',
};

describe('syncService — 单例三件套 + handleRealtimeMessage / handleMessageRecalled', () => {
  beforeEach(() => {
    dbMock.saveMessage.mockClear();
    dbMock.updateConversationLastSeq.mockClear();
    dbMock.markMessageRecalled.mockClear();
    destroySyncService();
  });

  it('initSyncService 返回 SyncService 实例且 getSyncService 拿到同一引用', () => {
    const svc = initSyncService(makeApi() as never);
    expect(svc).toBeInstanceOf(SyncService);
    expect(getSyncService()).toBe(svc);
  });

  it('重复 init 替换单例：getSyncService 指向新实例、不再是旧的', () => {
    const first = initSyncService(makeApi() as never);
    const second = initSyncService(makeApi() as never);

    expect(second).not.toBe(first);
    expect(getSyncService()).toBe(second);
  });

  it('destroySyncService 置空：destroy 后 getSyncService 返回 null', () => {
    initSyncService(makeApi() as never);
    destroySyncService();
    expect(getSyncService()).toBeNull();
  });

  it('handleRealtimeMessage（带 seq）: 字段映射落库 + 推进会话 last_seq', async () => {
    const svc = new SyncService(makeApi() as never);

    await svc.handleRealtimeMessage({ ...realtimeMsg, seq: 5 });

    expect(dbMock.saveMessage).toHaveBeenCalledTimes(1);
    expect(dbMock.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message_uuid: 'm1',
        conversation_id: 'g1',
        conversation_type: 'group',
        content: 'hi',
        content_type: 'text',
        seq: 5,
        sender_id: 'u2',
        sender_name: 'Bob',
        send_time: '2026-01-01T00:00:00Z',
        is_recalled: false,
        is_deleted: false,
      }),
    );
    expect(dbMock.updateConversationLastSeq).toHaveBeenCalledTimes(1);
    expect(dbMock.updateConversationLastSeq).toHaveBeenCalledWith('g1', 5);
  });

  it('handleRealtimeMessage（无 seq）: seq 归 0 落库，且不推进 last_seq（falsy 守卫）', async () => {
    const svc = new SyncService(makeApi() as never);

    await svc.handleRealtimeMessage({ ...realtimeMsg });

    expect(dbMock.saveMessage).toHaveBeenCalledTimes(1);
    expect(dbMock.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message_uuid: 'm1', seq: 0 }),
    );
    expect(dbMock.updateConversationLastSeq).not.toHaveBeenCalled();
  });

  it('handleMessageRecalled: 直通 db.markMessageRecalled；DB 失败时错误不被吞', async () => {
    const svc = new SyncService(makeApi() as never);

    await svc.handleMessageRecalled('m-x');
    expect(dbMock.markMessageRecalled).toHaveBeenCalledWith('m-x');

    dbMock.markMessageRecalled.mockRejectedValueOnce(new Error('db-fail'));
    await expect(svc.handleMessageRecalled('m-y')).rejects.toThrow('db-fail');
    expect(dbMock.markMessageRecalled).toHaveBeenLastCalledWith('m-y');
  });

  it('单例与实例功能串联：init 后经 getSyncService() 调 handleRealtimeMessage 生效', async () => {
    initSyncService(makeApi() as never);
    const svc = getSyncService();
    expect(svc).not.toBeNull();

    await svc!.handleRealtimeMessage({ ...realtimeMsg, seq: 9 });

    expect(dbMock.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message_uuid: 'm1', conversation_id: 'g1', seq: 9 }),
    );
    expect(dbMock.updateConversationLastSeq).toHaveBeenCalledWith('g1', 9);
  });
});
