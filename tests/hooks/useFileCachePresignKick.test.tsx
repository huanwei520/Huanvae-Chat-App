/**
 * F2 缓存触发时点前移 行为测试（hooks/useFileCache）
 *
 * 覆盖（判官 PASS 报告 §3-F2 硬验收 ③）：
 * - presign URL 取得后**立即** kick 后台缓存下载，不等 <img> onLoad 渲染回调；
 * - onLoad 再触发时不重复 kick（downloadTriggeredRef 去重）；
 * - 本地缓存命中（isLocal）不 kick；
 * - 视频保持「等 onPlay」旧语义（autoCache=false 不提前 kick），onPlay 时把
 *   F1 重取上下文（api/urlType/fileUuid）一并传给下载链。
 *
 * services/fileCache 整模块 mock：本文件验证的是 hook 层触发时点与传参契约，
 * 下载/重取链内部行为由 tests/unit/fileCacheUrlExpiredRetry.test.ts 覆盖。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  getBaseUrl: () => 'https://api.example.com',
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => apiMock,
  useSession: () => ({ session: { serverUrl: 'https://api.example.com' } }),
}));

const fileCacheMock = vi.hoisted(() => ({
  getFileSource: vi.fn(),
  getVideoSource: vi.fn(),
  triggerBackgroundDownload: vi.fn(),
  getFileTypeFromMime: vi.fn((ct?: string) =>
    (ct ?? '').startsWith('image/') ? 'image' : (ct ?? '').startsWith('video/') ? 'video' : 'document',
  ),
  startProgressListener: vi.fn().mockResolvedValue(undefined),
  fileIdentityKey: vi.fn((uuid: string, hash?: string | null) => hash || uuid),
}));

vi.mock('../../src/services/fileCache', () => fileCacheMock);

import { useImageCache, useVideoCache } from '../../src/hooks/useFileCache';

const REMOTE_SOURCE = {
  src: 'https://display.example.com/obj',
  isLocal: false,
  presignedUrl: 'https://presigned.example.com/obj',
} as const;

describe('F2：presign 取得后立即 kick 后台缓存下载', () => {
  beforeEach(() => {
    fileCacheMock.getFileSource.mockReset();
    fileCacheMock.getVideoSource.mockReset();
    fileCacheMock.triggerBackgroundDownload.mockReset().mockResolvedValue(undefined);
  });

  it('远程图片：loadSource 拿到 presign 即 kick，onLoad 从未发生也不影响；onLoad 再触发不重复', async () => {
    fileCacheMock.getFileSource.mockResolvedValue(REMOTE_SOURCE);

    const { result } = renderHook(() => useImageCache('uuid-kick', null, 'pic.png', 'friend'));

    // 关键断言：不需要任何 onLoad/渲染回调，kick 已经发生
    await waitFor(() => {
      expect(fileCacheMock.triggerBackgroundDownload).toHaveBeenCalledTimes(1);
    });
    expect(fileCacheMock.getFileSource).toHaveBeenCalledWith(
      apiMock,
      'uuid-kick',
      null,
      'friend',
    );
    // 用原始 presigned URL + F1 重取上下文（api/urlType/fileUuid）
    expect(fileCacheMock.triggerBackgroundDownload).toHaveBeenCalledWith(
      'https://presigned.example.com/obj',
      'uuid-kick',
      'pic.png',
      'image',
      undefined,
      { api: apiMock, urlType: 'friend', fileUuid: 'uuid-kick' },
    );

    // onLoad 此时才触发（渲染成功后的正常回调）⇒ 已 kick 过，不得重复
    act(() => {
      result.current.onLoad();
    });
    expect(fileCacheMock.triggerBackgroundDownload).toHaveBeenCalledTimes(1);
  });

  it('本地缓存命中（isLocal=true）不 kick', async () => {
    fileCacheMock.getFileSource.mockResolvedValue({
      src: 'asset://localhost/local.png',
      isLocal: true,
      localPath: '/data/file/pictures/local.png',
    });

    const { result } = renderHook(() => useImageCache('uuid-local', null, 'pic.png', 'friend'));

    await waitFor(() => {
      expect(result.current.isLocal).toBe(true);
    });
    expect(fileCacheMock.triggerBackgroundDownload).not.toHaveBeenCalled();

    act(() => {
      result.current.onLoad();
    });
    expect(fileCacheMock.triggerBackgroundDownload).not.toHaveBeenCalled();
  });

  it('视频不提前 kick（保持等 onPlay 旧语义）；onPlay 时传 F1 重取上下文', async () => {
    // 桌面端（jsdom 非 mobile/macOS）视频走 getFileSource；getVideoSource 仅移动端/macOS 分支
    fileCacheMock.getFileSource.mockResolvedValue({
      src: 'https://display.example.com/video',
      isLocal: false,
      presignedUrl: 'https://presigned.example.com/video',
    });

    const { result } = renderHook(() =>
      useVideoCache('uuid-video', null, 'clip.mp4', 2048, 'friend'),
    );

    await waitFor(() => {
      expect(fileCacheMock.getFileSource).toHaveBeenCalledWith(
        apiMock,
        'uuid-video',
        null,
        'friend',
      );
    });
    // presign 已取得但绝不提前 kick（autoCache=false 的视频不走 F2 时点前移）
    expect(fileCacheMock.triggerBackgroundDownload).not.toHaveBeenCalled();
    expect(fileCacheMock.triggerBackgroundDownload).not.toHaveBeenCalled();

    act(() => {
      result.current.onPlay();
    });
    await waitFor(() => {
      expect(fileCacheMock.triggerBackgroundDownload).toHaveBeenCalledTimes(1);
    });
    expect(fileCacheMock.triggerBackgroundDownload).toHaveBeenCalledWith(
      'https://presigned.example.com/video',
      'uuid-video',
      'clip.mp4',
      'video',
      2048,
      { api: apiMock, urlType: 'friend', fileUuid: 'uuid-video' },
    );
  });
});
