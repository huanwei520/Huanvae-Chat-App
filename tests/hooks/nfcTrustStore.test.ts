/**
 * trustStore 包装层单元测试
 *
 * 验证 4 个方法都调用 invoke 含正确 command 名 + 参数。
 * 不验证 Rust 后端行为（由 src-tauri 的 rust 测试覆盖，本测仅契约层）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { trustStore } from '../../src/nfc/trustStore';

const mockedInvoke = vi.mocked(invoke);

describe('trustStore', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it('isTrusted 调 invoke("db_nfc_is_trusted") 含 camelCase 参数', async () => {
    mockedInvoke.mockResolvedValueOnce(true);
    const result = await trustStore.isTrusted('uid-1', 'hash-1');
    expect(mockedInvoke).toHaveBeenCalledWith('db_nfc_is_trusted', {
      uid: 'uid-1',
      payloadHash: 'hash-1',
    });
    expect(result).toBe(true);
  });

  it('addTrusted 调 invoke("db_nfc_add_trusted") 含 createdAt（毫秒时间戳）', async () => {
    const before = Date.now();
    mockedInvoke.mockResolvedValueOnce(undefined);
    await trustStore.addTrusted('uid-x', 'hash-x', '打开小程序: foo');
    const after = Date.now();

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    const call = mockedInvoke.mock.calls[0]!;
    expect(call[0]).toBe('db_nfc_add_trusted');
    const args = call[1] as { uid: string; payloadHash: string; actionSummary: string; createdAt: number };
    expect(args.uid).toBe('uid-x');
    expect(args.payloadHash).toBe('hash-x');
    expect(args.actionSummary).toBe('打开小程序: foo');
    expect(args.createdAt).toBeGreaterThanOrEqual(before);
    expect(args.createdAt).toBeLessThanOrEqual(after);
  });

  it('listTrusted 透传 invoke 返回值', async () => {
    const fake = [
      { uid: 'a', payload_hash: 'b', action_summary: 'x', created_at: 1 },
      { uid: 'c', payload_hash: 'd', action_summary: 'y', created_at: 2 },
    ];
    mockedInvoke.mockResolvedValueOnce(fake);
    const result = await trustStore.listTrusted();
    expect(mockedInvoke).toHaveBeenCalledWith('db_nfc_list_trusted');
    expect(result).toBe(fake);
  });

  it('removeTrusted 调 invoke("db_nfc_remove_trusted") 含正确参数', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await trustStore.removeTrusted('uid-r', 'hash-r');
    expect(mockedInvoke).toHaveBeenCalledWith('db_nfc_remove_trusted', {
      uid: 'uid-r',
      payloadHash: 'hash-r',
    });
  });
});
