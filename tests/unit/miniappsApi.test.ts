/**
 * 小程序 API 路径回归测试
 *
 * src/api/miniapps.ts 的函数都接收一个 ApiClient 并调用 .post/.get/...。
 * 这里用一个最小的 mock ApiClient 断言**请求路径字符串**精确正确——
 * 路径拼写漂移(如 reset_password 误写成 reset-password)是 vitest 能低成本拦下的
 * 一类 bug:后端路由 axum 0.8 精确匹配,连字符/下划线不符会 404。
 */

import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '../../src/api/client';
import {
  submitMiniAppRequest,
  resetSSHPassword,
  getMiniApp,
  startContainer,
  deleteMiniApp,
  listPublishedMiniApps,
  listMyMiniApps,
  updateMiniApp,
  publishMiniApp,
  unpublishMiniApp,
  stopContainer,
  restartContainer,
  getContainerInfo,
} from '../../src/api/miniapps';

/** 最小 mock ApiClient：只实现被测函数用到的方法,记录调用参数 */
function mockApi() {
  const post = vi.fn().mockResolvedValue({});
  const get = vi.fn().mockResolvedValue({});
  const del = vi.fn().mockResolvedValue({});
  const api = { post, get, delete: del } as unknown as ApiClient;
  return { api, post, get, del };
}

describe('miniapps API 请求路径', () => {
  it('resetSSHPassword 打后端下划线路由 /reset_password（非连字符，否则 axum 404）', () => {
    const { api, post } = mockApi();
    resetSSHPassword(api, 'app-1');
    expect(post).toHaveBeenCalledWith('/api/miniapps/app-1/reset_password', {});
  });

  it('submitMiniAppRequest 提交到 /api/miniapps（审批制申请）', () => {
    const { api, post } = mockApi();
    const body = { name: 'demo', display_name: '演示', proposed_cpu: '2', proposed_mem: '2g' };
    submitMiniAppRequest(api, body);
    expect(post).toHaveBeenCalledWith('/api/miniapps', body);
  });

  it('getMiniApp 走 /api/miniapps/{id}', () => {
    const { api, get } = mockApi();
    getMiniApp(api, 'app-2');
    expect(get).toHaveBeenCalledWith('/api/miniapps/app-2');
  });

  it('startContainer 走 /api/miniapps/{id}/start（单词路由）', () => {
    const { api, post } = mockApi();
    startContainer(api, 'app-3');
    expect(post).toHaveBeenCalledWith('/api/miniapps/app-3/start', {});
  });

  it('deleteMiniApp 走 DELETE /api/miniapps/{id}', () => {
    const { api, del } = mockApi();
    deleteMiniApp(api, 'app-4');
    expect(del).toHaveBeenCalledWith('/api/miniapps/app-4');
  });
});

// ============================================
// 以下为补充覆盖：列表 / 更新 / 发布 / 容器操作
// （updateMiniApp 走 api.put，上方 mockApi 未实现 put，故这里用补全版 makeApi）
// ============================================

/** 补全版 mock ApiClient：含 put，覆盖本节全部被测函数 */
function makeApi() {
  const get = vi.fn().mockResolvedValue({});
  const post = vi.fn().mockResolvedValue({});
  const put = vi.fn().mockResolvedValue({});
  const del = vi.fn().mockResolvedValue({});
  const api = { get, post, put, delete: del } as unknown as ApiClient;
  return { api, get, post, put, del };
}

describe('miniapps API 请求路径（列表/更新/发布/容器）', () => {
  it('listPublishedMiniApps 走 GET /api/miniapps，返回值透传', async () => {
    const { api, get } = makeApi();
    const apps = [{ miniapp_id: 'app-1', name: 'demo', status: 'published' }];
    get.mockResolvedValue(apps);
    const out = await listPublishedMiniApps(api);
    expect(get).toHaveBeenCalledWith('/api/miniapps');
    expect(out).toEqual(apps);
  });

  it('listMyMiniApps 走 GET /api/miniapps/my', async () => {
    const { api, get } = makeApi();
    await listMyMiniApps(api);
    expect(get).toHaveBeenCalledWith('/api/miniapps/my');
  });

  it('updateMiniApp 走 PUT /api/miniapps/{id}，body 原样透传', async () => {
    const { api, put } = makeApi();
    put.mockResolvedValue({ message: '更新成功' });
    const data = { display_name: '新名字', description: '新描述', icon_url: 'https://x/i.png' };
    const out = await updateMiniApp(api, 'app-5', data);
    expect(put).toHaveBeenCalledWith('/api/miniapps/app-5', data);
    expect(out).toEqual({ message: '更新成功' });
  });

  it('publishMiniApp 走 POST /api/miniapps/{id}/publish，body 为空对象', async () => {
    const { api, post } = makeApi();
    await publishMiniApp(api, 'app-6');
    expect(post).toHaveBeenCalledWith('/api/miniapps/app-6/publish', {});
  });

  it('unpublishMiniApp 走 POST /api/miniapps/{id}/unpublish，body 为空对象', async () => {
    const { api, post } = makeApi();
    await unpublishMiniApp(api, 'app-7');
    expect(post).toHaveBeenCalledWith('/api/miniapps/app-7/unpublish', {});
  });

  it('stopContainer 走 POST /api/miniapps/{id}/stop，body 为空对象', async () => {
    const { api, post } = makeApi();
    await stopContainer(api, 'app-8');
    expect(post).toHaveBeenCalledWith('/api/miniapps/app-8/stop', {});
  });

  it('restartContainer 走 POST /api/miniapps/{id}/restart，body 为空对象', async () => {
    const { api, post } = makeApi();
    await restartContainer(api, 'app-9');
    expect(post).toHaveBeenCalledWith('/api/miniapps/app-9/restart', {});
  });

  it('getContainerInfo 走 GET /api/miniapps/{id}/container，返回值透传', async () => {
    const { api, get } = makeApi();
    const container = {
      miniapp_id: 'app-10',
      name: 'demo',
      status: 'running',
      container_id: 'c-1',
      ssh: { ssh_port: 2222, ssh_user: 'dev', ssh_password: 'pw' },
    };
    get.mockResolvedValue(container);
    const out = await getContainerInfo(api, 'app-10');
    expect(get).toHaveBeenCalledWith('/api/miniapps/app-10/container');
    expect(out).toEqual(container);
  });

  // ---- 异常路径：薄封装不 try/catch，api 抛错原样向上抛 ----

  const ERROR_CASES: Array<{ name: string; call: (api: ApiClient) => Promise<unknown> }> = [
    { name: 'listPublishedMiniApps', call: (api) => listPublishedMiniApps(api) },
    { name: 'listMyMiniApps', call: (api) => listMyMiniApps(api) },
    { name: 'updateMiniApp', call: (api) => updateMiniApp(api, 'app-e', { display_name: 'x' }) },
    { name: 'publishMiniApp', call: (api) => publishMiniApp(api, 'app-e') },
    { name: 'unpublishMiniApp', call: (api) => unpublishMiniApp(api, 'app-e') },
    { name: 'stopContainer', call: (api) => stopContainer(api, 'app-e') },
    { name: 'restartContainer', call: (api) => restartContainer(api, 'app-e') },
    { name: 'getContainerInfo', call: (api) => getContainerInfo(api, 'app-e') },
  ];

  it.each(ERROR_CASES)('$name 异常：api 抛错时原样向上抛', async ({ name, call }) => {
    const { api, get, post, put } = makeApi();
    const err = new Error(`${name}-fail`);
    get.mockRejectedValue(err);
    post.mockRejectedValue(err);
    put.mockRejectedValue(err);
    await expect(call(api)).rejects.toThrow(`${name}-fail`);
  });
});
