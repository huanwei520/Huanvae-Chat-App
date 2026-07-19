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

// ============================================================================
// Devices 域（registerDevice / getDevices / getDeviceConfig / lockDevice /
// unlockDevice / deleteDevice）契约测试
// ============================================================================

describe('serverApi.registerDevice', () => {
  it('POSTs to /api/hg/devices/register with all fields in body', async () => {
    const data = {
      device_id: 'dev-1',
      virtual_ip: '10.66.0.2',
      node_endpoint: '1.2.3.4:51820',
      topology: [],
    };
    mocks.invoke.mockResolvedValueOnce(makeResp({ success: true, code: 200, data }));

    const result = await serverApi.registerDevice(
      SERVER_URL,
      TOKEN,
      'MacBook',
      'macos',
      'fp-abc',
      'qd',
    );

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/devices/register`);
    expect(req.method).toBe('POST');
    expect(JSON.parse(req.body as string)).toEqual({
      device_name: 'MacBook',
      os: 'macos',
      device_fingerprint: 'fp-abc',
      preferred_region: 'qd',
    });
    expect(result).toEqual(data);
  });

  it('omits optional fields (os/device_fingerprint/preferred_region) → keys absent from body', async () => {
    mocks.invoke.mockResolvedValueOnce(
      makeResp({
        success: true,
        code: 200,
        data: { device_id: 'd', virtual_ip: '10.66.0.3', node_endpoint: null, topology: [] },
      }),
    );

    await serverApi.registerDevice(SERVER_URL, TOKEN, 'PC');

    // undefined 字段被 JSON.stringify 丢弃
    expect(JSON.parse(reqOf(0).body as string)).toEqual({ device_name: 'PC' });
  });
});

describe('serverApi.getDevices', () => {
  it('GETs /api/hg/devices with null body + Authorization header, returns data array passthrough', async () => {
    const devices = [
      { device_id: 'dev-1', device_name: 'MacBook', virtual_ip: '10.66.0.2', status: 'active' },
      { device_id: 'dev-2', device_name: 'PC', virtual_ip: '10.66.0.3', status: 'active' },
    ];
    mocks.invoke.mockResolvedValueOnce(makeResp({ success: true, code: 200, data: devices }));

    const result = await serverApi.getDevices(SERVER_URL, TOKEN);

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/devices`);
    expect(req.method).toBe('GET'); // init 未传 → method ?? 'GET'
    expect(req.body).toBeNull(); // init 未传 → body ?? null
    const headers = req.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(result).toEqual(devices);
  });

  it('routes through serverFetch error handling: success=false → throws error message', async () => {
    mocks.invoke.mockResolvedValueOnce(
      makeResp({ success: false, code: 403, data: null, error: 'device quota exceeded' }, 403),
    );

    await expect(serverApi.getDevices(SERVER_URL, TOKEN)).rejects.toThrow(
      'device quota exceeded',
    );
  });
});

describe('serverApi.getDeviceConfig', () => {
  it('GETs /api/hg/devices/{deviceId}/config and returns config passthrough', async () => {
    const config = {
      address: '10.66.0.2/32',
      dns: null,
      mtu: 1280,
      peers: [],
      obfuscation: {
        h1: [1, 2],
        h2: [3, 4],
        h3: [5, 6],
        h4: [7, 8],
        s1: 0,
        s2: 0,
        s3: 0,
        s4: 0,
        jc: 4,
        jmin: 8,
        jmax: 80,
      },
    };
    mocks.invoke.mockResolvedValueOnce(makeResp({ success: true, code: 200, data: config }));

    const result = await serverApi.getDeviceConfig(SERVER_URL, TOKEN, 'dev-1');

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/devices/dev-1/config`);
    expect(req.method).toBe('GET');
    expect(req.body).toBeNull();
    expect(result).toEqual(config);
  });
});

describe('serverApi.lockDevice', () => {
  it('POSTs to /api/hg/devices/{deviceId}/lock with {endpoint} body', async () => {
    mocks.invoke.mockResolvedValueOnce(makeResp({ success: true, code: 200, data: null }));

    await serverApi.lockDevice(SERVER_URL, TOKEN, 'dev-1', '5.6.7.8:51820');

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/devices/dev-1/lock`);
    expect(req.method).toBe('POST');
    expect(JSON.parse(req.body as string)).toEqual({ endpoint: '5.6.7.8:51820' });
  });
});

describe('serverApi.unlockDevice', () => {
  it('POSTs to /api/hg/devices/{deviceId}/unlock with null body', async () => {
    mocks.invoke.mockResolvedValueOnce(makeResp({ success: true, code: 200, data: null }));

    await serverApi.unlockDevice(SERVER_URL, TOKEN, 'dev-1');

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/devices/dev-1/unlock`);
    expect(req.method).toBe('POST');
    expect(req.body).toBeNull(); // init 无 body → body ?? null
  });
});

describe('serverApi.deleteDevice', () => {
  it('DELETEs /api/hg/devices/{deviceId}', async () => {
    mocks.invoke.mockResolvedValueOnce(makeResp({ success: true, code: 200, data: null }));

    await serverApi.deleteDevice(SERVER_URL, TOKEN, 'dev-1');

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/devices/dev-1`);
    expect(req.method).toBe('DELETE');
    expect(req.body).toBeNull();
  });
});

// ============================================================================
// Links 域（createLinkInvite / acceptLinkInvite / listLinks / deleteLink）契约测试
// ============================================================================

describe('serverApi.createLinkInvite', () => {
  it('POSTs to /api/hg/links/invite with {from_device} body and returns invite passthrough', async () => {
    const data = {
      invite_id: 'inv-1',
      invite_token: 'link-tok',
      expires_at: '2026-07-18T00:00:00Z',
    };
    mocks.invoke.mockResolvedValueOnce(makeResp({ success: true, code: 200, data }));

    const result = await serverApi.createLinkInvite(SERVER_URL, TOKEN, 'dev-1');

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/links/invite`);
    expect(req.method).toBe('POST');
    expect(JSON.parse(req.body as string)).toEqual({ from_device: 'dev-1' });
    expect(result).toEqual(data);
  });
});

describe('serverApi.acceptLinkInvite', () => {
  it('POSTs to /api/hg/links/invite/accept with {invite_token, device_id} body', async () => {
    const data = {
      link_id: 'link-1',
      peer: {
        device_id: 'dev-9',
        public_key: 'pk',
        virtual_ip: '10.66.0.9',
        endpoint: null,
        is_same_node: false,
        psk_encrypted: null,
        psk_nonce: null,
        status: 'active',
        last_heartbeat: null,
      },
    };
    mocks.invoke.mockResolvedValueOnce(makeResp({ success: true, code: 200, data }));

    const result = await serverApi.acceptLinkInvite(SERVER_URL, TOKEN, 'link-tok', 'dev-2');

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/links/invite/accept`);
    expect(req.method).toBe('POST');
    expect(JSON.parse(req.body as string)).toEqual({
      invite_token: 'link-tok',
      device_id: 'dev-2',
    });
    expect(result).toEqual(data);
  });
});

describe('serverApi.listLinks', () => {
  it('GETs /api/hg/links with null body and returns link array passthrough', async () => {
    const links = [
      {
        link_id: 'link-1',
        device_a: 'dev-1',
        device_b: 'dev-2',
        link_source: 'invite',
        source_id: null,
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
      },
    ];
    mocks.invoke.mockResolvedValueOnce(makeResp({ success: true, code: 200, data: links }));

    const result = await serverApi.listLinks(SERVER_URL, TOKEN);

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/links`);
    expect(req.method).toBe('GET');
    expect(req.body).toBeNull();
    expect(result).toEqual(links);
  });
});

describe('serverApi.deleteLink', () => {
  it('DELETEs /api/hg/links/{linkId}', async () => {
    mocks.invoke.mockResolvedValueOnce(makeResp({ success: true, code: 200, data: null }));

    await serverApi.deleteLink(SERVER_URL, TOKEN, 'link-1');

    const req = reqOf(0);
    expect(req.url).toBe(`${SERVER_URL}/api/hg/links/link-1`);
    expect(req.method).toBe('DELETE');
    expect(req.body).toBeNull();
  });
});
