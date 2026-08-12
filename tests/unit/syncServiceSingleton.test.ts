/**
 * syncService 单例三件套 + 撤回直通行为测试
 *
 * 覆盖 services/syncService.ts 此前无测试的部分：
 *  - initSyncService / getSyncService / destroySyncService 单例生命周期
 *    （init 返回并登记实例、重复 init 替换、destroy 置空）
 *  - handleMessageRecalled：直通 db.markMessageRecalled，错误不被吞
 *
 * 原先这里还测 `handleRealtimeMessage`。该方法 2026-08-12 已删除：全仓零生产调用方
 * （WS 落库唯一入口是 wsHandlers.saveMessageToLocal），而它内部把 reply_to 写死 null
 * —— 正是本轮「引用块丢失」那一族缺陷的模板，留着等人接上去就是再踩一次。
 * 三条只测死代码的用例随之移除。
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

describe('syncService — 单例三件套 + handleMessageRecalled', () => {
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

  it('handleMessageRecalled: 直通 db.markMessageRecalled；DB 失败时错误不被吞', async () => {
    const svc = new SyncService(makeApi() as never);

    await svc.handleMessageRecalled('m-x');
    expect(dbMock.markMessageRecalled).toHaveBeenCalledWith('m-x');

    dbMock.markMessageRecalled.mockRejectedValueOnce(new Error('db-fail'));
    await expect(svc.handleMessageRecalled('m-y')).rejects.toThrow('db-fail');
    expect(dbMock.markMessageRecalled).toHaveBeenLastCalledWith('m-y');
  });

  it('单例与实例功能串联：init 后经 getSyncService() 调实例方法生效', async () => {
    initSyncService(makeApi() as never);
    const svc = getSyncService();
    expect(svc).not.toBeNull();

    await svc!.handleMessageRecalled('m-z');

    expect(dbMock.markMessageRecalled).toHaveBeenCalledWith('m-z');
  });
});
