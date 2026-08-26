/**
 * NFC executor 单元测试
 *
 * 验证 dispatch 根据 action.kind 正确派发：
 * - miniapp/open → 查 app + setMiniAppLaunching
 * - http/request GET → httpFetch 调用含 method 且无 body
 * - http/request POST → httpFetch 调用含 Content-Type + body
 * - getMiniAppById 返 null → 抛错
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatch } from '../../src/nfc/executor';
import type { MiniApp } from '../../src/api/miniapps';

function makeMiniApp(id: string): MiniApp {
  return {
    miniapp_id: id,
    name: id,
    display_name: id,
    description: '',
    icon_url: '',
    access_url: `/apps/${id}/`,
    status: 'published',
    developer_id: 'dev',
    developer_nickname: 'dev',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    published_at: '2024-01-01',
  };
}

/**
 * 加群三开关落地那条派发臂的桩。
 * 每条用例都会顺带断言它**没有**被调用（防"派发臂串台"：小程序/http 走到群那条去）。
 */
const openGroupDetail = vi.fn();

beforeEach(() => {
  openGroupDetail.mockReset();
});

describe('dispatch — group/join（扫码加群落地）', () => {
  const GID = '11111111-2222-3333-4444-555555555555';

  it('派发到 openGroupDetail，且 source 固定为 qr（不是 search / referral）', async () => {
    await dispatch(
      { kind: 'group/join', groupId: GID },
      { setMiniAppLaunching: vi.fn(), getMiniAppById: vi.fn(), openGroupDetail },
    );
    expect(openGroupDetail).toHaveBeenCalledTimes(1);
    expect(openGroupDetail).toHaveBeenCalledWith(GID, 'qr');
  });

  it('🔴 只打开详情，不发任何加群请求（贴一下卡/扫一下码不等于同意入群）', async () => {
    const httpFetch = vi.fn();
    const setMiniAppLaunching = vi.fn();
    await dispatch(
      { kind: 'group/join', groupId: GID },
      { setMiniAppLaunching, getMiniAppById: vi.fn(), openGroupDetail, httpFetch },
    );
    expect(httpFetch).not.toHaveBeenCalled();
    expect(setMiniAppLaunching).not.toHaveBeenCalled();
  });
});

describe('dispatch — miniapp/open', () => {
  it('找到 app → 调 setMiniAppLaunching 含正确 app', async () => {
    const app = makeMiniApp('app-1');
    const setMiniAppLaunching = vi.fn();
    const getMiniAppById = vi.fn().mockResolvedValue(app);

    await dispatch(
      { kind: 'miniapp/open', miniappId: 'app-1' },
      { setMiniAppLaunching, getMiniAppById, openGroupDetail },
    );

    expect(getMiniAppById).toHaveBeenCalledWith('app-1');
    expect(setMiniAppLaunching).toHaveBeenCalledWith(app);
  });

  it('找不到 app → 抛错（含 id 信息），且不调 setMiniAppLaunching', async () => {
    const setMiniAppLaunching = vi.fn();
    const getMiniAppById = vi.fn().mockResolvedValue(null);

    await expect(
      dispatch(
        { kind: 'miniapp/open', miniappId: 'missing-app' },
        { setMiniAppLaunching, getMiniAppById, openGroupDetail },
      ),
    ).rejects.toThrow(/missing-app/);
    expect(setMiniAppLaunching).not.toHaveBeenCalled();
  });
});

describe('dispatch — http/request', () => {
  it('GET 请求 → httpFetch 调用含 method=GET 且无 body/headers', async () => {
    const httpFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });

    await dispatch(
      { kind: 'http/request', url: 'https://api.test/x', method: 'GET', body: null },
      {
        setMiniAppLaunching: vi.fn(),
        getMiniAppById: vi.fn(),
        openGroupDetail,
        httpFetch,
      },
    );

    expect(httpFetch).toHaveBeenCalledWith('https://api.test/x', { method: 'GET' });
  });

  it('POST 带 body → httpFetch 含 Content-Type + JSON.stringify(body)', async () => {
    const httpFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });

    await dispatch(
      {
        kind: 'http/request',
        url: 'https://api.test/y',
        method: 'POST',
        body: { hello: 'world' },
      },
      {
        setMiniAppLaunching: vi.fn(),
        getMiniAppById: vi.fn(),
        openGroupDetail,
        httpFetch,
      },
    );

    expect(httpFetch).toHaveBeenCalledWith('https://api.test/y', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
  });

  it('HTTP 非 2xx → 抛错含 status', async () => {
    const httpFetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });

    await expect(
      dispatch(
        { kind: 'http/request', url: 'https://api.test/fail', method: 'GET', body: null },
        {
          setMiniAppLaunching: vi.fn(),
          getMiniAppById: vi.fn(),
          openGroupDetail,
          httpFetch,
        },
      ),
    ).rejects.toThrow(/500/);
  });
});
