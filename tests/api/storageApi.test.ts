/**
 * 文件存储 API 封装单元测试（src/api/storage.ts）
 *
 * 用假 ApiClient（get/post/put/delete/patch 为 vi.fn）验证：
 *   - getFiles：全参/部分参/无参三种 query 拼接（URLSearchParams 按
 *     page→limit→sort_by→sort_order 的源码 set 顺序）+ 异常向上抛；
 *   - getFileCategory：纯函数，按 content_type 前缀分类；
 *   - deleteFile：DELETE /api/storage/file/{uuid} + 异常向上抛。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/client';
import * as storage from '../../src/api/storage';

function makeApi() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    getBaseUrl: vi.fn(),
    getAccessToken: vi.fn(),
    refreshAccessToken: vi.fn(),
  } as unknown as ApiClient & {
    get: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

describe('文件存储 API 封装 (api/storage)', () => {
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
  });

  // ---- getFiles ----

  it('getFiles 全参：query 按 page→limit→sort_by→sort_order 顺序拼接', async () => {
    const resp = {
      files: [],
      total: 0,
      page: 2,
      page_size: 50,
      total_pages: 0,
      has_more: false,
    };
    api.get.mockResolvedValue(resp);
    const out = await storage.getFiles(api, {
      page: 2,
      limit: 50,
      sort_by: 'file_size',
      sort_order: 'desc',
    });
    expect(api.get).toHaveBeenCalledWith(
      '/api/storage/files?page=2&limit=50&sort_by=file_size&sort_order=desc',
    );
    expect(out).toEqual(resp);
  });

  it('getFiles 部分参：只传 sort_by 时 query 仅含 sort_by', async () => {
    api.get.mockResolvedValue({ files: [] });
    await storage.getFiles(api, { sort_by: 'created_at' });
    expect(api.get).toHaveBeenCalledWith('/api/storage/files?sort_by=created_at');
  });

  it('getFiles 无参：URL 不带问号', async () => {
    api.get.mockResolvedValue({ files: [] });
    await storage.getFiles(api);
    expect(api.get).toHaveBeenCalledWith('/api/storage/files');
  });

  it('getFiles 异常：api.get 抛错时向上抛', async () => {
    api.get.mockRejectedValue(new Error('files-fail'));
    await expect(storage.getFiles(api, { page: 1 })).rejects.toThrow('files-fail');
  });

  // ---- getFileCategory（纯函数，无 api）----

  it.each([
    ['image/png', 'image'],
    ['video/mp4', 'video'],
    ['application/pdf', 'file'],
    ['text/plain', 'file'],
  ] as const)('getFileCategory(%s) → %s', (contentType, expected) => {
    expect(storage.getFileCategory(contentType)).toBe(expected);
  });

  // ---- deleteFile ----

  it('deleteFile 正常：DELETE /api/storage/file/{uuid}', async () => {
    api.delete.mockResolvedValue(undefined);
    const out = await storage.deleteFile(api, 'uuid-abc-123');
    expect(api.delete).toHaveBeenCalledWith('/api/storage/file/uuid-abc-123');
    expect(out).toBeUndefined();
  });

  it('deleteFile 异常：api.delete 抛错时向上抛', async () => {
    api.delete.mockRejectedValue(new Error('delete-fail'));
    await expect(storage.deleteFile(api, 'uuid-abc-123')).rejects.toThrow('delete-fail');
  });
});
