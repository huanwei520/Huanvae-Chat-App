/**
 * 契约守门：群聊文件/图片取件必须走后端【群专用】端点
 * POST /api/storage/group_file/{uuid}/presigned_url，不得回退到通用 /api/storage/file/{uuid}/presigned_url。
 *
 * 为什么（后端权限模型，见审计 High 项）：
 * - 群专用端点每次取件实时校验请求者仍是活跃群成员（verify_active_member）：
 *   退群即时失效（不再能取件）、新入群即时可取历史群图。
 * - 通用端点只查上传当刻的静态授权快照（file-access-permissions，退群不撤销）：
 *   → 退群成员仍可越权取件；新成员对入群前上传的历史群图无授权行 → 403 看不到。
 *
 * 手法：vitest/jsdom 不发真请求，端点选择只能【静态锁】。把 group 分支改回通用 /file/ → 本测试 FAIL。
 * 变异验证（node）：群分支端点还原成 /api/storage/file/ 时首条断言从 PASS 翻 FAIL。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string): string => readFileSync(resolve(__dirname, '..', p), 'utf-8');
const FILE_CACHE = read('src/services/fileCache.ts');
const MEDIA_PREVIEW = read('src/media/MediaPreviewPage.tsx');

/** 抽出 switch 里 `case 'group':` 分支正文（到下一个 `break;`），块内有界，不跨到别的 case。 */
function groupCaseBody(src: string): string {
  const start = src.indexOf("case 'group':");
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = src.slice(start);
  const end = rest.indexOf('break;');
  expect(end).toBeGreaterThan(0);
  return rest.slice(0, end);
}

describe('群文件取件端点：必走 group_file 专用端点（实时活跃成员校验）', () => {
  it('fileCache.ts 群分支用 /api/storage/group_file/，不用通用 /file/', () => {
    const body = groupCaseBody(FILE_CACHE);
    expect(body).toContain('/api/storage/group_file/${fileUuid}/presigned_url');
    // 回退守卫：group_file 端点不含子串 "/api/storage/file/"，故回退到通用端点即会命中此断言 → FAIL
    expect(body).not.toContain('/api/storage/file/${fileUuid}/presigned_url');
  });

  it('MediaPreviewPage.tsx 群分支用 /api/storage/group_file/，不用通用 /file/', () => {
    const body = groupCaseBody(MEDIA_PREVIEW);
    expect(body).toContain('/api/storage/group_file/${fileUuid}/presigned_url');
    expect(body).not.toContain('/api/storage/file/${fileUuid}/presigned_url');
  });

  it('friend 分支仍走 friends_file 专用端点（不被误改）', () => {
    expect(FILE_CACHE).toContain('/api/storage/friends_file/${fileUuid}/presigned_url');
    expect(MEDIA_PREVIEW).toContain('/api/storage/friends_file/${fileUuid}/presigned_url');
  });
});
