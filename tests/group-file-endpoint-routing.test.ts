/**
 * 契约守门：群聊文件/图片取件必须走后端【群专用】端点
 * POST /api/storage/group_file/{uuid}/presigned_url，不得回退到通用 /api/storage/file/{uuid}/presigned_url。
 *
 * 为什么（客户端可观测行为）：
 * - 群专用端点：退群后即失去取件权限、新入群成员可取历史群图。
 * - 通用端点做不到这两点：退群成员仍能取件（越权）、新成员看不到入群前的历史群图（403）。
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
