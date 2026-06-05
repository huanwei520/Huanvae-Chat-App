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
