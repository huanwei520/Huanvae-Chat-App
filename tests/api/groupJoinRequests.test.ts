/**
 * 入群申请审批（群主 / 管理员侧）API 契约测试
 *
 * 这三个端点后端一直都在（`Huanvae-Chat-Rust/src/groups/handlers/routes.rs:85-87`），
 * 但客户端**从未接过** —— 后果是 `join_mode = approval_required` 的群，
 * 用户申请后群主在 App 里根本看不到，申请永久 pending。本文件守住接线本身。
 *
 * 断言的是**会不会写错**的地方：
 *  - 路径拼接（含 encodeURIComponent，群 id / request id 都来自服务端，含特殊字符即断链）
 *  - reject **必须带 body** —— 后端是 `Json<ProcessJoinRequestBody>` 提取器，
 *    不发 body 会被 axum 直接 400，而这种错在类型层看不出来
 * 不断言字面量类型定义（那种测试测的是自己写死的字符串，没有防回归价值）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getGroupJoinRequests,
  approveGroupJoinRequest,
  rejectGroupJoinRequest,
} from '../../src/api/groups';
import type { ApiClient } from '../../src/api/client';

function makeApi() {
  return {
    get: vi.fn().mockResolvedValue({ requests: [] }),
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  };
}

describe('入群申请审批 API', () => {
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
  });

  it('拉取待审批列表：GET /api/groups/{id}/requests', async () => {
    await getGroupJoinRequests(api as unknown as ApiClient, 'g-1');
    expect(api.get).toHaveBeenCalledWith('/api/groups/g-1/requests');
  });

  it('通过：POST /api/groups/{id}/requests/{rid}/approve', async () => {
    await approveGroupJoinRequest(api as unknown as ApiClient, 'g-1', 'r-9');
    expect(api.post).toHaveBeenCalledWith('/api/groups/g-1/requests/r-9/approve');
  });

  /**
   * 后端 reject 的签名是 `Json(req): Json<ProcessJoinRequestBody>`
   * （`Huanvae-Chat-Rust/src/groups/handlers/join_requests.rs:358`）——
   * axum 的 `Json<T>` 提取器**缺 body 直接 400**。所以即使不填理由也必须发一个对象。
   */
  it('拒绝：必须带 body（不填理由也要发 { reason: null }）', async () => {
    await rejectGroupJoinRequest(api as unknown as ApiClient, 'g-1', 'r-9');
    expect(api.post).toHaveBeenCalledWith('/api/groups/g-1/requests/r-9/reject', {
      reason: null,
    });
    // 反向断言：不许退化成「不传第二个参数」
    expect(api.post.mock.calls[0]).toHaveLength(2);
  });

  it('拒绝：带理由时原样透传', async () => {
    await rejectGroupJoinRequest(api as unknown as ApiClient, 'g-1', 'r-9', '不符合入群要求');
    expect(api.post).toHaveBeenCalledWith('/api/groups/g-1/requests/r-9/reject', {
      reason: '不符合入群要求',
    });
  });

  /**
   * 群 id 是 UUID、request id 也是服务端下发的，理论上不含特殊字符；
   * 但路径拼接一旦漏了转义，任何一天后端换成含 `/` 或 `#` 的标识就会**静默断链**
   *（请求打到别的路由上，前端只看到 404）。这条钉住转义。
   */
  it('路径段做 encodeURIComponent（含特殊字符也不会断链）', async () => {
    await getGroupJoinRequests(api as unknown as ApiClient, 'a/b');
    expect(api.get).toHaveBeenCalledWith('/api/groups/a%2Fb/requests');

    await approveGroupJoinRequest(api as unknown as ApiClient, 'a b', 'r#1');
    expect(api.post).toHaveBeenCalledWith('/api/groups/a%20b/requests/r%231/approve');
  });
});
