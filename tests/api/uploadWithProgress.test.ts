/**
 * uploadWithProgress 分支覆盖测试（src/api/upload.ts）
 *
 * 覆盖此前无直接测试的分支：
 * - onProgress 进度回调（lengthComputable true/false、未传回调时不崩）
 * - onerror → '网络错误'
 * - 非 2xx 错误消息分解（data.error → data.message → HTTP <status> 三级回退）
 * - 200 但响应非 JSON → '解析响应失败'
 * - 反代收口：open 的 URL 必须经 proxyRequestUrl 改写（mock 成 proxied: 前缀可断言）
 * - Authorization 头 与 FormData 字段名
 *
 * 200 happy path 的解包链路已由 tests/api/uploadBackground.test.ts 间接覆盖，
 * 此处 happy path 仅在进度用例内顺带验证 resolve 透传，不重复铺开。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// proxyRequestUrl 依赖 Tauri；mock 成加 proxied: 前缀，让"URL 经过反代改写"可被精确断言
vi.mock('../../src/services/secureProxy', () => ({
  proxyRequestUrl: (url: string) => `proxied:${url}`,
}));

import { uploadWithProgress } from '../../src/api/upload';

/** 进度事件形状（SUT 只读这三个字段） */
interface ProgressEventLike {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

/** 每个用例通过重赋 sendScript 编排 send() 后的回放行为（进度事件 / 响应 / 网络错误） */
let sendScript: (xhr: FakeXHR) => void = () => {};
/** 记录本用例创建的 XHR 实例，供断言 open/setRequestHeader/send 参数 */
let instances: FakeXHR[] = [];

// 可配置的裸 XHR 替身（模式来自 tests/api/uploadBackground.test.ts，扩展为记录参数 + 可编排回放）
class FakeXHR {
  upload: { onprogress: ((e: ProgressEventLike) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 0;
  responseText = '';
  openArgs: Array<[string, string]> = [];
  headerArgs: Array<[string, string]> = [];
  sentBody: FormData | null = null;

  constructor() {
    instances.push(this);
  }

  open(method: string, url: string): void {
    this.openArgs.push([method, url]);
  }

  setRequestHeader(name: string, value: string): void {
    this.headerArgs.push([name, value]);
  }

  send(body?: unknown): void {
    this.sentBody = body instanceof FormData ? body : null;
    sendScript(this);
  }
}

/** 编排辅助：回放一个指定状态码/响应体的完成事件 */
function respond(xhr: FakeXHR, status: number, body: string): void {
  xhr.status = status;
  xhr.responseText = body;
  xhr.onload?.();
}

const UPLOAD_URL = 'https://api.example.cn/api/profile/avatar';
const file = new File(['x'], 'avatar.png', { type: 'image/png' });

describe('uploadWithProgress（src/api/upload.ts）', () => {
  const OriginalXHR = globalThis.XMLHttpRequest;

  beforeEach(() => {
    instances = [];
    sendScript = () => {};
    globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
  });
  afterEach(() => {
    globalThis.XMLHttpRequest = OriginalXHR;
  });

  it('onProgress：lengthComputable 时按序回调百分比，最终 resolve 透传 JSON', async () => {
    sendScript = (xhr) => {
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      respond(xhr, 200, '{"ok":true,"id":7}');
    };
    const onProgress = vi.fn();

    const res = await uploadWithProgress(UPLOAD_URL, 'tok', file, 'avatar', onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 25);
    expect(onProgress).toHaveBeenNthCalledWith(2, 50);
    expect(res).toEqual({ ok: true, id: 7 });
  });

  it('onProgress：lengthComputable=false 的进度事件不回调', async () => {
    sendScript = (xhr) => {
      xhr.upload.onprogress?.({ lengthComputable: false, loaded: 25, total: 0 });
      respond(xhr, 200, '{}');
    };
    const onProgress = vi.fn();

    await uploadWithProgress(UPLOAD_URL, 'tok', file, 'avatar', onProgress);

    expect(onProgress).not.toHaveBeenCalled();
  });

  it('未传 onProgress：进度事件不崩溃，正常 resolve', async () => {
    sendScript = (xhr) => {
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      respond(xhr, 200, '{"ok":1}');
    };

    await expect(uploadWithProgress(UPLOAD_URL, 'tok', file, 'avatar')).resolves.toEqual({ ok: 1 });
  });

  it('onerror：reject Error("网络错误")', async () => {
    sendScript = (xhr) => {
      xhr.onerror?.();
    };

    await expect(uploadWithProgress(UPLOAD_URL, 'tok', file, 'avatar')).rejects.toThrow('网络错误');
  });

  it('非 2xx：优先取响应体 error 字段作错误消息', async () => {
    sendScript = (xhr) => {
      respond(xhr, 400, '{"error":"file too large"}');
    };

    await expect(uploadWithProgress(UPLOAD_URL, 'tok', file, 'avatar')).rejects.toThrow('file too large');
  });

  it('非 2xx：无 error 字段时回退到 message 字段', async () => {
    sendScript = (xhr) => {
      respond(xhr, 400, '{"message":"quota"}');
    };

    await expect(uploadWithProgress(UPLOAD_URL, 'tok', file, 'avatar')).rejects.toThrow('quota');
  });

  it('非 2xx：error/message 均缺失时回退到 "HTTP <status>"', async () => {
    sendScript = (xhr) => {
      respond(xhr, 500, '{}');
    };

    await expect(uploadWithProgress(UPLOAD_URL, 'tok', file, 'avatar')).rejects.toThrow('HTTP 500');
  });

  it('200 但响应体非 JSON：reject Error("解析响应失败")', async () => {
    sendScript = (xhr) => {
      respond(xhr, 200, 'not-json');
    };

    await expect(uploadWithProgress(UPLOAD_URL, 'tok', file, 'avatar')).rejects.toThrow('解析响应失败');
  });

  it('open 用 POST + 反代改写后的 URL，且带 Authorization: Bearer 头', async () => {
    sendScript = (xhr) => {
      respond(xhr, 200, '{}');
    };

    await uploadWithProgress(UPLOAD_URL, 'tok-x', file, 'avatar');

    expect(instances).toHaveLength(1);
    // URL 必须经 proxyRequestUrl 改写（裸 URL 会让 webview 验不过私有 CA）
    expect(instances[0].openArgs).toEqual([['POST', `proxied:${UPLOAD_URL}`]]);
    expect(instances[0].headerArgs).toEqual([['Authorization', 'Bearer tok-x']]);
  });

  it('send 的 FormData 以 fieldName 为键携带原 File', async () => {
    sendScript = (xhr) => {
      respond(xhr, 200, '{}');
    };

    await uploadWithProgress(UPLOAD_URL, 'tok', file, 'avatar');

    const body = instances[0].sentBody;
    expect(body).toBeInstanceOf(FormData);
    expect(body?.get('avatar')).toBe(file);
  });
});
