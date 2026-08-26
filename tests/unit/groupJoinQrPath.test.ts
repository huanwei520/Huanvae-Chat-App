/**
 * 扫码加群（qr）这条路的客户端一侧 —— 解析 + 出码 API。
 *
 * 契约真值源：`backend-docs/groups/群聊管理.md`「获取群二维码」
 * （`payload` = `huanvae://group/join?id=<uuid>`）与「申请入群」（`source='qr'`）。
 *
 * ## 每条用例防的是哪一种写错法
 *
 * | 用例 | 防的写错法 |
 * |------|-----------|
 * | payload 形态与后端 `qr_payload()` 逐字同形 | 客户端自己另造一套 scheme ⇒ 后端出的码 App 扫不动，而两边各自看都"对" |
 * | 非 UUID 的 id 一律拒 | 不校验 ⇒ 任意串被当群 ID 拼进 URL，"群不存在"的 404 与"我给了垃圾串"同形 |
 * | `group/join` 与另两个 kind 互不串台 | 白名单臂写错顺序/条件 ⇒ 扫码落到 http/request 上（那条会真的发请求） |
 * | `getGroupQr` 打 `/qr` 且 id 被 encode | 写成本地拼串 ⇒ 把 `qr_show_scope` 整道门绕过去 |
 * | 403/404 分档文案 | 合成一句「获取失败」⇒ 用户分不清"找群主调权限"和"群没了" |
 */

import { describe, it, expect, vi } from 'vitest';
import { parseAction, summarizeAction } from '../../src/nfc/parser';
import { describeGroupQrError } from '../../src/chat/shared/menu/GroupQrView';
import { getGroupQr } from '../../src/api/groups';
import { parseGroupJoinQuery } from '../../src/components/search/globalSearchTabs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ApiClient } from '../../src/api/client';

/** 后端 `qr_payload()` 的输出形态（其单测 `payload_carries_group_id_in_app_scheme` 里的原样值） */
const GID = '11111111-2222-3333-4444-555555555555';
const PAYLOAD = `huanvae://group/join?id=${GID}`;

describe('parseAction — group/join', () => {
  it('后端 payload 逐字解析出 groupId（两侧形态必须同形，否则出的码扫不动）', () => {
    expect(parseAction(PAYLOAD)).toEqual({ kind: 'group/join', groupId: GID });
  });

  it('大写 UUID 也收（第三方扫码器转手时大写化过的样本存在）', () => {
    const upper = GID.toUpperCase();
    expect(parseAction(`huanvae://group/join?id=${upper}`)).toEqual({
      kind: 'group/join',
      groupId: upper,
    });
  });

  it.each([
    ['缺 id', 'huanvae://group/join'],
    ['id 为空', 'huanvae://group/join?id='],
    ['不是 UUID', 'huanvae://group/join?id=not-a-uuid'],
    ['UUID 少一段', 'huanvae://group/join?id=11111111-2222-3333-4444'],
    ['UUID 混进非法字符', 'huanvae://group/join?id=1111111g-2222-3333-4444-555555555555'],
    ['路径写错', 'huanvae://group/joins?id=' + GID],
    ['非本 scheme', `https://evil.example.com/group/join?id=${GID}`],
  ])('%s ⇒ 拒（返 null）', (_name, uri) => {
    expect(parseAction(uri)).toBeNull();
  });

  it('🔴 与另两个 kind 互不串台：三条各自解析成各自的 kind', () => {
    expect(parseAction(PAYLOAD)?.kind).toBe('group/join');
    expect(parseAction('huanvae://miniapp/open?id=app-1')?.kind).toBe('miniapp/open');
    expect(parseAction('huanvae://http/request?url=https%3A%2F%2Fa.example.com')?.kind)
      .toBe('http/request');
  });

  it('摘要只说"打开群聊"，不说"加入" —— 这一步不加任何群', () => {
    const action = parseAction(PAYLOAD);
    expect(action).not.toBeNull();
    const text = summarizeAction(action!);
    expect(text).toContain(GID);
    expect(text).toContain('打开群聊');
    expect(text).not.toContain('加入');
  });
});

describe('getGroupQr', () => {
  function makeApi() {
    return {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      patch: vi.fn(),
      getBaseUrl: vi.fn(() => 'https://api.example.cn'),
      getAccessToken: vi.fn(() => 'tok-1'),
      refreshAccessToken: vi.fn(),
    } as unknown as ApiClient & { get: ReturnType<typeof vi.fn> };
  }

  it('打 /api/groups/{id}/qr（不是本地拼串 —— 本地拼会绕过 qr_show_scope 那道门）', async () => {
    const api = makeApi();
    api.get.mockResolvedValue({ group_id: GID, payload: PAYLOAD, group_name: 'g', group_avatar_url: null, member_count: 1 });
    await getGroupQr(api, GID);
    expect(api.get).toHaveBeenCalledWith(`/api/groups/${GID}/qr`);
  });

  it('groupId 经 encodeURIComponent', async () => {
    const api = makeApi();
    api.get.mockResolvedValue({ group_id: 'x', payload: PAYLOAD, group_name: 'g', group_avatar_url: null, member_count: 1 });
    await getGroupQr(api, 'a b/c');
    expect(api.get).toHaveBeenCalledWith('/api/groups/a%20b%2Fc/qr');
  });

  it('原样上抛错误（薄封装不许兜底成"成功"）', async () => {
    const api = makeApi();
    api.get.mockRejectedValue(new Error('boom'));
    await expect(getGroupQr(api, GID)).rejects.toThrow('boom');
  });
});

describe('describeGroupQrError — 403 与 404 必须分档', () => {
  it('403 指向"角色不够"，404 指向"群没了"，两句话不同', () => {
    const forbidden = describeGroupQrError(403, 'fallback');
    const notFound = describeGroupQrError(404, 'fallback');
    expect(forbidden).not.toBe(notFound);
    expect(forbidden).toContain('二维码');
    expect(notFound).toContain('解散');
  });

  it('拿不到状态码（网络层失败）⇒ 回落原始文案，不猜成两档里的任何一档', () => {
    expect(describeGroupQrError(null, '网络连接失败')).toBe('网络连接失败');
    expect(describeGroupQrError(500, '服务器开小差')).toBe('服务器开小差');
  });
});


// ---------------- 搜索框里粘一张群二维码的内容 ----------------

describe('parseGroupJoinQuery — 搜索框识别群二维码内容', () => {
  it('粘进整串 payload ⇒ 认出群 ID（前后空白也吃掉）', () => {
    expect(parseGroupJoinQuery(PAYLOAD)).toBe(GID);
    expect(parseGroupJoinQuery(`  ${PAYLOAD}  `)).toBe(GID);
  });

  it.each([
    ['普通群名', '技术交流群'],
    ['裸群 ID（不是 payload 形态）', GID],
    ['另一个 kind 的 payload', 'huanvae://miniapp/open?id=app-1'],
    ['空串', ''],
    ['垃圾 id', 'huanvae://group/join?id=not-a-uuid'],
  ])('%s ⇒ null（不短路，照常走搜索）', (_n, q) => {
    expect(parseGroupJoinQuery(q)).toBeNull();
  });
});

/**
 * 🔴 静态扫描：组件**必须**在识别出 payload 时短路两条取数通路。
 *
 * 运行时测不到这一条的代价：不短路时 `/api/discovery/search` 会拿一整串 URI 去做完全匹配、
 * 必然零命中 ⇒ 用户看到「没搜到」，而这与"这个群不存在"完全同形 —— 没有任何地方会红。
 * 断言落在源码上，因为这是"有没有把某个值传进去"的接线，不是可观测的输出。
 */
describe('GlobalMessageSearchResults 短路接线（静态扫描）', () => {
  const SRC = readFileSync(
    resolve(__dirname, '../../src/components/search/GlobalMessageSearchResults.tsx'),
    'utf-8',
  );

  it('判据自证：这个文件确实是被测那一个（正对照）', () => {
    expect(SRC).toContain('parseGroupJoinQuery');
    // 负对照：当场现编的串不该出现（证明不是"读到什么都算命中"）
    expect(SRC).not.toContain('u7q-nope-marker-3391');
  });

  it('本地消息搜索被 joinPayload 短路（传空串 ⇒ hook 内整条链路不发 DB 调用）', () => {
    expect(SRC).toMatch(/useGlobalMessageSearch\(\s*onMessageTab\s*&&\s*!joinPayload\s*\?\s*query\s*:\s*''/);
  });

  it('发现搜索被 joinPayload 短路（传空串 ⇒ 不打 /api/discovery/search）', () => {
    expect(SRC).toMatch(/useDiscoverySearch\(\s*joinPayload\s*\?\s*''\s*:\s*query\s*\)/);
  });

  it('落地时 source 写死 qr（不是从别处传进来的变量）', () => {
    expect(SRC).toMatch(/openGroupDetail\(\s*groupId\s*,\s*'qr'\s*\)/);
  });
});
