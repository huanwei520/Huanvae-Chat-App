/**
 * 契约守门：群文件预签名请求体必须真的带上 `related_id`
 *
 * ## 守的是什么
 *
 * 后端 2026-08-13 起把 `related_id`（= 发起本次访问的群 ID）列为群文件预签名两个端点的
 * **必填**字段，缺失或非 UUID 形态一律 400、**不做兼容**
 * （backend-docs/storage/文件存储管理.md「群文件预签名 URL」；真值源
 * Huanvae-Chat-Rust/src/storage/models/request.rs 的 `PresignedUrlRequest.related_id`）。
 * App 不跟进 ⇒ 群图片 / 群视频 / 群文件预览**全面 400**。
 *
 * ## 🔴 为什么钉在「请求体字面量」而不是 interface
 *
 * 本仓两个 API 出口都是**逐键显式构造 body**：
 * 类型上加了字段、`api.post(...)` / `JSON.stringify(...)` 的字面量里不加 ⇒ **字段被静默丢掉，
 * TS 也不报错**（工作区 CLAUDE.md 契约链注意事项，2026-08-10 media_group 实证）。
 * 所以断言必须落在「真的发出去了什么」这一层：
 *
 * - `services/fileCache.getPresignedUrl` —— **行为断言**：mock 掉 ApiClient，
 *   直接看 `api.post` 第二个实参（= 请求体对象本身）。
 * - `media/MediaPreviewPage` 的同名内部函数 —— 它不导出、且整页依赖 secureHttp / 独立窗口
 *   handoff，行为断言成本远高于收益 ⇒ **块内有界的静态扫描**（同 tests/group-file-endpoint-routing.test.ts
 *   的手法）。这条明确只守「字面量里写没写」，守不住「写了但值是错的」。
 *
 * ## 反向断言（非群路径逐字节不变）
 *
 * 用 `toEqual({ operation: 'preview' })` 整体比对而不是 `not.toHaveProperty`：
 * 前者能同时挡住「给 friend / user 也塞了 related_id」和「顺手多塞了别的键」。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// fileCache.ts 顶层 import 了 @tauri-apps/api/event（setup.ts 未 mock 它），
// 且 invoke 走真实 Tauri 会炸 —— 与 tests/unit/fileCacheProgressListener.test.ts 同款隔离。
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (s: string) => s,
}));

import { getPresignedUrl } from '../src/services/fileCache';
import { useChatStore } from '../src/stores/chatStore';
import { useFileCacheStore } from '../src/stores/fileCacheStore';
import type { ApiClient } from '../src/api/client';
import type { Group, Friend } from '../src/types/chat';

// ============================================
// 行为断言：services/fileCache.getPresignedUrl
// ============================================

/** 真实群 ID 形态（UUID 文本）—— 后端对非 UUID 形态同样 400 */
const GROUP_ID = '3f1c1c8a-9d1e-4a52-8f2b-6c2a0d5e7b31';

function makeGroup(groupId: string): Group {
  return {
    group_id: groupId,
    group_name: '测试群',
    group_avatar_url: '',
    role: 'member',
    unread_count: null,
    last_message_content: null,
    last_message_time: null,
  };
}

function makeFriend(friendId: string): Friend {
  return {
    friend_id: friendId,
    friend_nickname: '好友',
    friend_avatar_url: null,
    add_time: '2026-01-01T00:00:00Z',
    approve_reason: null,
    friend_remark: null,
    is_blacklisted: false,
    is_special_care: false,
  };
}

/** 极简 ApiClient 替身：只实现 getPresignedUrl 真正用到的三个方法 */
function makeApi() {
  const post = vi.fn().mockResolvedValue({
    presigned_url: 'group-file/g/x.jpg?X-Amz-Signature=deadbeef',
    expires_at: '2099-01-01T00:00:00+00:00',
  });
  return {
    api: {
      post,
      getBaseUrl: () => 'https://example.invalid',
      getAccessToken: () => 'token',
    } as unknown as ApiClient,
    post,
  };
}

/** 每个用例换一个 fileUuid + 清空 URL 缓存：命中缓存会直接 return，根本不发请求（假绿） */
let uuidSeq = 0;
function nextUuid(): string {
  uuidSeq += 1;
  return `file-uuid-${uuidSeq}`;
}

describe('群文件预签名：请求体必须带 related_id（fileCache 行为断言）', () => {
  beforeEach(() => {
    useFileCacheStore.setState({ urlCache: {} });
    useChatStore.setState({ chatTarget: null });
  });

  it('group：请求体 = { operation, related_id }，related_id 取当前群的 group_id', async () => {
    useChatStore.setState({ chatTarget: { type: 'group', data: makeGroup(GROUP_ID) } });
    const { api, post } = makeApi();
    const fileUuid = nextUuid();

    await getPresignedUrl(api, fileUuid, 'group');

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe(`/api/storage/group_file/${fileUuid}/presigned_url`);
    // 整体比对：既证明 related_id 在字面量里，也证明它不是空串 / 占位 / null
    expect(post.mock.calls[0][1]).toEqual({ operation: 'preview', related_id: GROUP_ID });
  });

  it('friend：请求体逐字节不变（仍是 { operation: "preview" }，不含 related_id）', async () => {
    useChatStore.setState({ chatTarget: { type: 'friend', data: makeFriend('bob') } });
    const { api, post } = makeApi();
    const fileUuid = nextUuid();

    await getPresignedUrl(api, fileUuid, 'friend');

    expect(post.mock.calls[0][0]).toBe(`/api/storage/friends_file/${fileUuid}/presigned_url`);
    expect(post.mock.calls[0][1]).toEqual({ operation: 'preview' });
  });

  it('user：请求体逐字节不变（即使当前正开着某个群会话）', async () => {
    // 「我的文件」在群会话打开时也能用 —— 这条同时证明群 ID 不会泄进个人文件请求
    useChatStore.setState({ chatTarget: { type: 'group', data: makeGroup(GROUP_ID) } });
    const { api, post } = makeApi();
    const fileUuid = nextUuid();

    await getPresignedUrl(api, fileUuid, 'user');

    expect(post.mock.calls[0][0]).toBe(`/api/storage/file/${fileUuid}/presigned_url`);
    expect(post.mock.calls[0][1]).toEqual({ operation: 'preview' });
  });

  it('group 但当前会话不是群：就地抛错，不发一个注定 400 的请求', async () => {
    useChatStore.setState({ chatTarget: { type: 'friend', data: makeFriend('bob') } });
    const { api, post } = makeApi();

    await expect(getPresignedUrl(api, nextUuid(), 'group')).rejects.toThrow('related_id');
    expect(post).not.toHaveBeenCalled();
  });
});

// ============================================
// 静态扫描：media/MediaPreviewPage 的 body 字面量
// ============================================

const MEDIA_PREVIEW = readFileSync(
  resolve(__dirname, '..', 'src/media/MediaPreviewPage.tsx'),
  'utf-8',
);

describe('群文件预签名：独立预览窗的 body 字面量（静态扫描）', () => {
  it('body 里 group 分支写了 related_id，且值取自 handoff 递来的 groupId', () => {
    // 块内有界：从 `body: JSON.stringify(` 起，只到该调用的结尾 `),` 为止，
    // 不允许 [\s\S]*? 一路吞到文件下游别的 related_id（那会变成恒 PASS 的假测试）
    const start = MEDIA_PREVIEW.indexOf('body: JSON.stringify(');
    expect(start).toBeGreaterThanOrEqual(0);
    const bodyLiteral = MEDIA_PREVIEW.slice(start, MEDIA_PREVIEW.indexOf('),', start));

    expect(bodyLiteral).toMatch(/urlType === 'group'/);
    expect(bodyLiteral).toMatch(/related_id:\s*groupId/);
    // 非群分支必须仍是光秃秃的 { operation: 'preview' }
    expect(bodyLiteral).toMatch(/:\s*\{\s*operation:\s*'preview'\s*\}/);
  });

  it('handoff 载荷把 groupId 递进了这次请求（不是读了个恒 undefined 的字段）', () => {
    // getPresignedUrl(...) 调用点必须真的把 state.groupId 传进去
    const start = MEDIA_PREVIEW.indexOf('const url = await getPresignedUrl(');
    expect(start).toBeGreaterThanOrEqual(0);
    const callSite = MEDIA_PREVIEW.slice(start, MEDIA_PREVIEW.indexOf(');', start));
    expect(callSite).toContain('state.groupId');
  });

  it('群文件缺 related_id 时就地抛错（不把它变成一句看不懂的 400）', () => {
    expect(MEDIA_PREVIEW).toMatch(/if \(urlType === 'group' && !groupId\) \{[^}]*throw new Error\([^}]*\}/);
  });
});

// ============================================
// 静态扫描：主窗口 handoff 侧真的解析并写入了 groupId
// ============================================

const MEDIA_API = readFileSync(resolve(__dirname, '..', 'src/media/api.ts'), 'utf-8');

describe('群文件预签名：跨窗 handoff 写入 groupId', () => {
  it('openMediaWindow 的 saveMediaDataInternal 载荷里含 groupId，且由 resolveGroupFileRelatedId 解析', () => {
    const start = MEDIA_API.indexOf('saveMediaDataInternal({');
    expect(start).toBeGreaterThanOrEqual(0);
    const payload = MEDIA_API.slice(start, MEDIA_API.indexOf('});', start));

    expect(payload).toMatch(/groupId:\s*data\.urlType === 'group' \? resolveGroupFileRelatedId\(\) : null/);
  });
});
