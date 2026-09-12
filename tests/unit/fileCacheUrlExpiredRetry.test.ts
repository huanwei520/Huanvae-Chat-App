/**
 * F1 过期重取链 + F2 退避重试 单元测试（services/fileCache.triggerBackgroundDownload）
 *
 * 覆盖（判官 PASS 报告 §3-F1/F2 硬验收）：
 *  ① 首次下载返回 HV_URL_EXPIRED 错误 → 断言重新调用了 presign 端点
 *     （请求体逐字节 { operation: 'preview' }）→ 用新 URL 重调下载 → 成功落缓存
 *  ② 重取 ≤2 次后仍过期 → 终态 failDownload 且状态标穷举（urlExpiredExhausted=true）
 *  ④ 退避重试计数与间隔符合实现常量（1s / 2s / 4s，≤3 次重试）
 *  附加：无重取上下文时过期即终态；重取端点本身失败如实终态；同 cacheKey 并发 kick 幂等
 *
 * Rust 侧续传语义（unified_download.rs 模块头）：续传键 = 身份键 + ETag，与 URL 无关；
 * 同 cacheKey 重调 download_and_save_file 即从断点续传，故本层重调无需 Rust 改动。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============== mock 骨架（vi.hoisted 稳定单例） ==============

const tauriMock = vi.hoisted(() => ({
  /** download_and_save_file 的可控行为（每个用例自行设置） */
  downloadBehavior: null as null | ((args: Record<string, unknown>) => Promise<string> | string),
  /** 每次 download_and_save_file 调用收到的参数（camelCase，与 invoke 调用方一致） */
  downloadCalls: [] as Array<Record<string, unknown>>,
  emit: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case 'download_and_save_file': {
        tauriMock.downloadCalls.push(args ?? {});
        if (!tauriMock.downloadBehavior) {
          throw new Error('测试未设置 downloadBehavior');
        }
        return await tauriMock.downloadBehavior(args ?? {});
      }
      // db_get_file_hash_by_uuid / get_cached_file_path 等本地查询一律返回 null
      // ⇒ triggerBackgroundDownload 的本地缓存预检查走「无缓存」分支
      default:
        return null;
    }
  }),
  convertFileSrc: (s: string) => s,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: tauriMock.emit,
}));

// presign URL 优化改写 host —— 用例里要断言「新 URL 原样重调」，改成恒等
vi.mock('../../src/utils/network', () => ({
  optimizePresignedUrl: (url: string) => url,
}));

const apiMock = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  getBaseUrl: () => 'https://api.example.com',
}));

import {
  triggerBackgroundDownload,
  isUrlExpiredError,
  __resetInFlightDownloadsForTest,
  URL_EXPIRED_REFETCH_LIMIT,
  DOWNLOAD_RETRY_LIMIT,
  DOWNLOAD_RETRY_BASE_DELAY_MS,
} from '../../src/services/fileCache';
import { useFileCacheStore } from '../../src/stores/fileCacheStore';

const UUID = 'a7b3c9d0-1111-2222-3333-444455556666';
const URL_V1 = `https://minio.test/friends-file/obj?X-Amz-Signature=v1`;
const URL_V2 = `https://minio.test/friends-file/obj?X-Amz-Signature=v2`;
const URL_V3 = `https://minio.test/friends-file/obj?X-Amz-Signature=v3`;
const LOCAL_PATH = '/data/me_server/file/pictures/abcd1234_pic.png';

/** HV_URL_EXPIRED 的真实形态样本（unified_download.rs Display 输出格式） */
const URL_EXPIRED_ERR =
  'HV_URL_EXPIRED: 范围探测: HTTP 403（预签名 URL 已过期或失效，重取 URL 后可从断点续传）';

function mockPresign(urls: string[] | string) {
  const list = Array.isArray(urls) ? urls : [urls];
  let i = 0;
  apiMock.post.mockImplementation(async () => {
    const url = list[Math.min(i, list.length - 1)];
    i += 1;
    return {
      presigned_url: url,
      expires_at: '2099-01-01T00:00:00Z',
      file_uuid: UUID,
      file_size: 1024,
      content_type: 'image/png',
    };
  });
}

describe('F1：下载路径 URL 过期重取链', () => {
  beforeEach(() => {
    useFileCacheStore.setState({ downloadTasks: {}, urlCache: {} });
    __resetInFlightDownloadsForTest();
    tauriMock.downloadBehavior = null;
    tauriMock.downloadCalls = [];
    tauriMock.emit.mockClear();
    apiMock.post.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('① 首次下载 HV_URL_EXPIRED → 重取 presign（body 逐字节 {operation:"preview"}）→ 新 URL 重调 → 落缓存', async () => {
    mockPresign([URL_V2, URL_V3]);
    tauriMock.downloadBehavior = async (args) => {
      if (args.url === URL_V1) {
        throw new Error(URL_EXPIRED_ERR);
      }
      return LOCAL_PATH;
    };

    await triggerBackgroundDownload(URL_V1, UUID, 'pic.png', 'image', 1024, {
      api: apiMock as never,
      urlType: 'friend',
      fileUuid: UUID,
    });

    // 重取了 presign 端点：friend 面、请求体逐字节 { operation: 'preview' }
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    expect(apiMock.post).toHaveBeenCalledWith(
      `/api/storage/friends_file/${UUID}/presigned_url`,
      { operation: 'preview' },
    );
    // 逐字节口径：JSON 序列化后必须与字面量完全一致（无多余字段）
    expect(JSON.stringify(apiMock.post.mock.calls[0][1])).toBe(
      JSON.stringify({ operation: 'preview' }),
    );

    // 两次下载调用：第一次旧 URL，第二次新 URL（重调实现续传）
    expect(tauriMock.downloadCalls).toHaveLength(2);
    expect(tauriMock.downloadCalls[0].url).toBe(URL_V1);
    expect(tauriMock.downloadCalls[1].url).toBe(URL_V2);

    // 成功落缓存：任务 completed + localPath + 跨窗口完成事件
    const task = useFileCacheStore.getState().downloadTasks[UUID];
    expect(task.status).toBe('completed');
    expect(task.localPath).toBe(LOCAL_PATH);
    expect(tauriMock.emit).toHaveBeenCalledWith(
      'file-download-completed',
      expect.objectContaining({ cacheKey: UUID, localPath: LOCAL_PATH, fileName: 'pic.png' }),
    );
  });

  it('② 重取 ≤2 次后仍过期 → 终态 failDownload 且 urlExpiredExhausted=true（穷举标记）', async () => {
    mockPresign([URL_V2, URL_V3]);
    tauriMock.downloadBehavior = async () => {
      throw new Error(URL_EXPIRED_ERR);
    };

    await triggerBackgroundDownload(URL_V1, UUID, 'pic.png', 'image', 1024, {
      api: apiMock as never,
      urlType: 'friend',
      fileUuid: UUID,
    });

    // 首次 + 恰好 URL_EXPIRED_REFETCH_LIMIT 次重取，不多不少
    expect(tauriMock.downloadCalls).toHaveLength(URL_EXPIRED_REFETCH_LIMIT + 1);
    expect(apiMock.post).toHaveBeenCalledTimes(URL_EXPIRED_REFETCH_LIMIT);
    expect(tauriMock.downloadCalls[1].url).toBe(URL_V2);
    expect(tauriMock.downloadCalls[2].url).toBe(URL_V3);

    // 终态：failed + 穷举标记 + 错误信息如实描述
    const task = useFileCacheStore.getState().downloadTasks[UUID];
    expect(task.status).toBe('failed');
    expect(task.urlExpiredExhausted).toBe(true);
    expect(task.error).toContain('URL 过期');
    expect(task.error).toContain(`重取 ${URL_EXPIRED_REFETCH_LIMIT} 次后仍失败`);
    // 不发完成事件
    expect(tauriMock.emit).not.toHaveBeenCalled();
  });

  it('无重取上下文（未传 api）时 URL 过期 → 即时终态，不做无意义的同 URL 重试', async () => {
    tauriMock.downloadBehavior = async () => {
      throw new Error(URL_EXPIRED_ERR);
    };

    await triggerBackgroundDownload(URL_V1, UUID, 'pic.png', 'image', 1024);

    expect(tauriMock.downloadCalls).toHaveLength(1); // 不重试同一个过期 URL
    expect(apiMock.post).not.toHaveBeenCalled();
    const task = useFileCacheStore.getState().downloadTasks[UUID];
    expect(task.status).toBe('failed');
    expect(task.urlExpiredExhausted).toBe(false);
    expect(task.error).toContain('无重取上下文');
  });

  it('重取 presign 端点本身失败 → 如实终态（urlExpiredExhausted=false），不误标穷举', async () => {
    apiMock.post.mockRejectedValue(new Error('HTTP 401 刷新后仍失败'));
    tauriMock.downloadBehavior = async () => {
      throw new Error(URL_EXPIRED_ERR);
    };

    await triggerBackgroundDownload(URL_V1, UUID, 'pic.png', 'image', 1024, {
      api: apiMock as never,
      urlType: 'friend',
      fileUuid: UUID,
    });

    const task = useFileCacheStore.getState().downloadTasks[UUID];
    expect(task.status).toBe('failed');
    expect(task.error).toContain('重取 presigned URL 失败');
    expect(task.urlExpiredExhausted).toBe(false);
  });

  it('isUrlExpiredError 形态识别：HV_URL_EXPIRED / 裸 401/403 命中，其它引擎形态不误报', () => {
    expect(isUrlExpiredError(new Error(URL_EXPIRED_ERR))).toBe(true);
    expect(isUrlExpiredError('HV_URL_EXPIRED: x')).toBe(true);
    expect(isUrlExpiredError(new Error('HTTP 401 Unauthorized'))).toBe(true);
    expect(isUrlExpiredError(new Error('HTTP_403 Forbidden'))).toBe(true);
    expect(isUrlExpiredError(new Error('HV_HTTP_404: 文件未找到'))).toBe(false);
    expect(isUrlExpiredError(new Error('HV_NET: 连接被重置'))).toBe(false);
    expect(isUrlExpiredError(new Error('HV_REMOTE_CHANGED: ETag 变了'))).toBe(false);
    expect(isUrlExpiredError(null)).toBe(false);
  });
});

describe('F2：一般失败指数退避重试', () => {
  beforeEach(() => {
    useFileCacheStore.setState({ downloadTasks: {}, urlCache: {} });
    __resetInFlightDownloadsForTest();
    tauriMock.downloadBehavior = null;
    tauriMock.downloadCalls = [];
    tauriMock.emit.mockClear();
    apiMock.post.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it(`④ 失败按指数退避重试（间隔 ${DOWNLOAD_RETRY_BASE_DELAY_MS}×2^n ms），第 3 次尝试成功`, async () => {
    vi.useFakeTimers();
    let attempts = 0;
    tauriMock.downloadBehavior = async () => {
      attempts += 1;
      if (attempts <= 2) {
        throw new Error('HV_NET: 连接被重置');
      }
      return LOCAL_PATH;
    };

    const done = triggerBackgroundDownload(URL_V1, UUID, 'pic.png', 'image', 1024, {
      api: apiMock as never,
      urlType: 'friend',
      fileUuid: UUID,
    });

    // 首次尝试立即发生（失败）
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    // 第一次退避：DOWNLOAD_RETRY_BASE_DELAY_MS × 2^0 = 1000ms，999ms 时还没到
    await vi.advanceTimersByTimeAsync(DOWNLOAD_RETRY_BASE_DELAY_MS - 1);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toBe(2);

    // 第二次退避：× 2^1 = 2000ms，1999ms 时还没到
    await vi.advanceTimersByTimeAsync(DOWNLOAD_RETRY_BASE_DELAY_MS * 2 - 1);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toBe(3);

    await done;

    expect(tauriMock.downloadCalls).toHaveLength(3);
    const task = useFileCacheStore.getState().downloadTasks[UUID];
    expect(task.status).toBe('completed');
    expect(task.localPath).toBe(LOCAL_PATH);
  });

  it(`④ 退避重试穷举（${DOWNLOAD_RETRY_LIMIT} 次）仍失败 → 终态 failDownload`, async () => {
    vi.useFakeTimers();
    tauriMock.downloadBehavior = async () => {
      throw new Error('HV_NET: 连接被重置');
    };

    const done = triggerBackgroundDownload(URL_V1, UUID, 'pic.png', 'image', 1024, {
      api: apiMock as never,
      urlType: 'friend',
      fileUuid: UUID,
    });
    // 首次 + DOWNLOAD_RETRY_LIMIT 次退避重试的等待总时长：1000 + 2000 + 4000
    await vi.advanceTimersByTimeAsync(
      DOWNLOAD_RETRY_BASE_DELAY_MS * (2 ** DOWNLOAD_RETRY_LIMIT - 1) + 1,
    );
    await done;

    expect(tauriMock.downloadCalls).toHaveLength(DOWNLOAD_RETRY_LIMIT + 1);
    const task = useFileCacheStore.getState().downloadTasks[UUID];
    expect(task.status).toBe('failed');
    expect(task.urlExpiredExhausted).toBe(false);
    expect(task.error).toContain('HV_NET');
    expect(tauriMock.emit).not.toHaveBeenCalled();
  });
});

describe('并发 kick 幂等（F2 前置）', () => {
  beforeEach(() => {
    useFileCacheStore.setState({ downloadTasks: {}, urlCache: {} });
    __resetInFlightDownloadsForTest();
    tauriMock.downloadBehavior = null;
    tauriMock.downloadCalls = [];
    tauriMock.emit.mockClear();
    apiMock.post.mockReset();
  });

  it('同一 cacheKey 并发 kick 只触发一次下载', async () => {
    let resolveDownload: (p: string) => void = () => {};
    tauriMock.downloadBehavior = () =>
      new Promise<string>((resolve) => {
        resolveDownload = resolve;
      });

    const p1 = triggerBackgroundDownload(URL_V1, UUID, 'pic.png', 'image', 1024, {
      api: apiMock as never,
      urlType: 'friend',
      fileUuid: UUID,
    });
    const p2 = triggerBackgroundDownload(URL_V1, UUID, 'pic.png', 'image', 1024, {
      api: apiMock as never,
      urlType: 'friend',
      fileUuid: UUID,
    });
    await p2; // 第二次 kick 应即时返回（在飞占位）
    // 等首次下载真正开跑（异步预检查之后）再放行，避免 resolveDownload 尚未赋值
    await vi.waitFor(() => {
      expect(tauriMock.downloadCalls).toHaveLength(1);
    });
    resolveDownload(LOCAL_PATH);
    await p1;

    expect(tauriMock.downloadCalls).toHaveLength(1);
    const task = useFileCacheStore.getState().downloadTasks[UUID];
    expect(task.status).toBe('completed');
  });

  it('在飞释放后，已完成任务的下一次 kick 被任务表跳过', async () => {
    tauriMock.downloadBehavior = async () => LOCAL_PATH;
    await triggerBackgroundDownload(URL_V1, UUID, 'pic.png', 'image', 1024);
    await triggerBackgroundDownload(URL_V1, UUID, 'pic.png', 'image', 1024);
    expect(tauriMock.downloadCalls).toHaveLength(1);
  });
});
