/**
 * HuanvaeGuard serverApi 单元测试
 *
 * serverFetch 已迁移到 Rust secure_http(invoke('secure_http'))。故 mock invoke +
 * discovery.resolveForSecureHttp(返回 null → 退化 pin_ca);断言改为校验 secure_http 的 req 参数。
 *
 * 验证：
 *   - 关键端点（acceptGroupInvite / createGroupInvite / joinGroup）的 URL、HTTP 方法、请求体正确
 *   - serverFetch 错误处理（非 2xx、success=false、非 JSON 路径）
 *   - joinGroup 函数虽然 UI 不再调用但保留可用（兼容后端契约）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../../src/services/discovery', () => ({ resolveForSecureHttp: () => null }));

import * as serverApi from '../../src/huanvaeGuard/serverApi';

const SERVER_URL = 'https://api.example.com';
const TOKEN = 'access-token-xyz';

/** 构造 secure_http(invoke) 返回的 SecureHttpResp */
function makeResp<T>(body: T, status = 200) {
  return { status, headers: {}, body: JSON.stringify(body) };
}

/** 取第 i 次 invoke('secure_http', {req}) 的 req */
function reqOf(i: number): Record<string, unknown> {
  const args = mocks.invoke.mock.calls[i] as [string, { req: Record<string, unknown> }];
  return args[1].req;
}

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe('serverApi.acceptGroupInvite', () => {
  it('POSTs to /api/hg/groups/{groupId}/invite/accept with body containing invite_token + device_id', async () => {
    mocks.invoke.mockResolvedValueOnce(
      makeResp({
        success: true,
        code: 200,
        data: { group_id: 'grp-1', status: 'active', pending_peers: 0 },
      }),
    );

    const result = await serverApi.acceptGroupInvite(
      SERVER_URL,
      TOKEN,
      'grp-1',
      'invite-tok-abc',
      'dev-1',
    );

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/groups/grp-1/invite/accept`);
    expect(req.method).toBe('POST');
    expect(JSON.parse(req.body as string)).toEqual({
      invite_token: 'invite-tok-abc',
      device_id: 'dev-1',
    });
    const headers = req.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['Content-Type']).toBe('application/json');

    expect(result).toEqual({ group_id: 'grp-1', status: 'active', pending_peers: 0 });
  });

  it('throws Error with backend error message on success=false', async () => {
    mocks.invoke.mockResolvedValueOnce(
      makeResp({ success: false, code: 400, data: null, error: 'invite token expired' }, 400),
    );

    await expect(
      serverApi.acceptGroupInvite(SERVER_URL, TOKEN, 'g', 't', 'd'),
    ).rejects.toThrow('invite token expired');
  });
});

describe('serverApi.createGroupInvite', () => {
  it('POSTs to /api/hg/groups/{groupId}/invite without body', async () => {
    mocks.invoke.mockResolvedValueOnce(
      makeResp({
        success: true,
        code: 200,
        data: { invite_id: 'inv-1', invite_token: 'tok-xyz', expires_at: '2026-05-07T00:00:00Z' },
      }),
    );

    const result = await serverApi.createGroupInvite(SERVER_URL, TOKEN, 'grp-1');

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/groups/grp-1/invite`);
    expect(req.method).toBe('POST');
    // 没有 body → secure_http 的 body 为 null
    expect(req.body).toBeNull();

    expect(result.invite_token).toBe('tok-xyz');
    expect(result.invite_id).toBe('inv-1');
  });
});

describe('serverApi.joinGroup (preserved for backend contract compatibility)', () => {
  it('still posts to /api/hg/groups/{groupId}/join with device_id body', async () => {
    mocks.invoke.mockResolvedValueOnce(
      makeResp({
        success: true,
        code: 200,
        data: { group_id: 'grp-1', status: 'active', pending_peers: 0 },
      }),
    );

    const result = await serverApi.joinGroup(SERVER_URL, TOKEN, 'grp-1', 'dev-1');

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/groups/grp-1/join`);
    expect(req.method).toBe('POST');
    expect(JSON.parse(req.body as string)).toEqual({ device_id: 'dev-1' });
    expect(result).toEqual({ group_id: 'grp-1', status: 'active', pending_peers: 0 });
  });
});

describe('serverApi.leaveGroup', () => {
  it('DELETEs /api/hg/groups/{groupId}/leave/{deviceId}', async () => {
    mocks.invoke.mockResolvedValueOnce(makeResp({ success: true, code: 200, data: null }));

    await serverApi.leaveGroup(SERVER_URL, TOKEN, 'grp-1', 'dev-1');

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/groups/grp-1/leave/dev-1`);
    expect(req.method).toBe('DELETE');
  });
});

describe('serverApi.deleteGroup', () => {
  it('DELETEs /api/hg/groups/{groupId}', async () => {
    mocks.invoke.mockResolvedValueOnce(makeResp({ success: true, code: 200, data: null }));

    await serverApi.deleteGroup(SERVER_URL, TOKEN, 'grp-1');

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/groups/grp-1`);
    expect(req.method).toBe('DELETE');
  });
});

describe('serverApi.toggleGroup', () => {
  it('POSTs to /api/hg/groups/{groupId}/toggle and returns boolean', async () => {
    mocks.invoke.mockResolvedValueOnce(makeResp({ success: true, code: 200, data: false }));

    const result = await serverApi.toggleGroup(SERVER_URL, TOKEN, 'grp-1');

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/groups/grp-1/toggle`);
    expect(req.method).toBe('POST');
    expect(result).toBe(false);
  });
});

describe('serverApi.createGroup', () => {
  it('POSTs name + description + max_devices in body', async () => {
    mocks.invoke.mockResolvedValueOnce(
      makeResp({ success: true, code: 200, data: { group_id: 'grp-new', name: '团队' } }),
    );

    await serverApi.createGroup(SERVER_URL, TOKEN, '团队', '描述', 10);

    expect(JSON.parse(reqOf(0).body as string)).toEqual({
      name: '团队',
      description: '描述',
      max_devices: 10,
    });
  });

  it('omits optional fields cleanly', async () => {
    mocks.invoke.mockResolvedValueOnce(
      makeResp({ success: true, code: 200, data: { group_id: 'g', name: 'n' } }),
    );

    await serverApi.createGroup(SERVER_URL, TOKEN, 'n');

    const body = JSON.parse(reqOf(0).body as string);
    expect(body.name).toBe('n');
    expect(body.description).toBeUndefined();
    expect(body.max_devices).toBeUndefined();
  });
});

// ============================================================================
// serverFetch 错误处理（间接通过 listGroups 验证）
// ============================================================================

describe('serverFetch error handling', () => {
  it('throws with json.error when present and success=false', async () => {
    mocks.invoke.mockResolvedValueOnce(
      makeResp({ success: false, code: 401, data: null, error: 'unauthorized' }, 401),
    );

    await expect(serverApi.listGroups(SERVER_URL, TOKEN)).rejects.toThrow('unauthorized');
  });

  it('throws with json.message when error is missing', async () => {
    mocks.invoke.mockResolvedValueOnce(
      makeResp({ success: false, code: 500, data: null, message: 'server explosion' }, 500),
    );

    await expect(serverApi.listGroups(SERVER_URL, TOKEN)).rejects.toThrow('server explosion');
  });

  it('throws with HTTP {status} when neither error nor message is provided', async () => {
    mocks.invoke.mockResolvedValueOnce(
      makeResp({ success: false, code: 502, data: null }, 502),
    );

    await expect(serverApi.listGroups(SERVER_URL, TOKEN)).rejects.toThrow('HTTP 502');
  });

  it('handles non-JSON response gracefully', async () => {
    // body 非 JSON → serverFetch 解析失败降级 {success:false,code:status} → 抛 HTTP 503
    mocks.invoke.mockResolvedValueOnce({ status: 503, headers: {}, body: 'not json' });

    await expect(serverApi.listGroups(SERVER_URL, TOKEN)).rejects.toThrow('HTTP 503');
  });
});
