/**
 * 入群策略 API 封装单元测试（`src/api/groups.ts` 的 join-policy 三件套）
 *
 * 覆盖本次新增：`getGroupDetail` / `updateJoinPolicy` / `JOIN_POLICY_DEFAULTS`。
 *
 * ## 每条用例防的是哪一种写错法
 *
 * | 用例 | 防的写错法 |
 * |------|-----------|
 * | body 只含被改的那一个键（**反向断言**其余四键不在） | 把整个 policy 对象当 body 发出去 ⇒ 后端把五个字段全当"要更新"，用户只改了一项却把另外四项一起重置成 UI 上的当前显示值（而那些值可能来自本地默认回落、并非服务端真值） |
 * | `false` / `owner_only` 也必须进 body | 过滤条件写成 `if (patch.x)` 而不是 `!== undefined` ⇒ **关开关永远关不掉**（`false` 被当"没传"丢掉），而开开关是好的 ⇒ 症状只在一半方向出现，极难联想到过滤条件 |
 * | 空 patch ⇒ body 为 `{}` | 用 `patch` 本身当 body ⇒ `undefined` 键被 `JSON.stringify` 丢掉这件事变成隐式依赖 |
 * | URL 是 `/api/groups/{id}` 而**不是** `/public` | 把 `getGroupDetail` 写成 `getPublicGroupInfo` 的别名 ⇒ 群设置面板拿的是无成员门控的公开信息，非成员也能读到设置面板数据 |
 * | `JOIN_POLICY_DEFAULTS` 五值逐字 | 默认值写反（如审核默认 false）⇒ 后端未返回该字段时面板显示的是与契约相反的状态 |
 * | api 抛错原样上抛 | 薄封装里偷偷 try/catch 兜底 ⇒ 403/404 被吞成"成功"，UI 无从分档 |
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ApiClient } from '../../src/api/client';
import {
  getGroupDetail,
  updateJoinPolicy,
  JOIN_POLICY_DEFAULTS,
  type GroupScope,
  type SearchScope,
  type JoinPolicy,
  type JoinPolicyPatch,
} from '../../src/api/groups';

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
  } as unknown as ApiClient & {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };
}

type Api = ReturnType<typeof makeApi>;

/** `PUT /join-policy` 的完整响应（契约承诺回吐更新之后的五值） */
const FULL_POLICY: JoinPolicy = {
  join_approval_required: false,
  admin_can_approve: false,
  card_share_scope: 'admins',
  qr_show_scope: 'owner_only',
  search_scope: 'admins',
};

/** 取 api.put 实际收到的 body（第二个参数） */
function putBody(api: Api): Record<string, unknown> {
  const call = api.put.mock.calls[0];
  expect(call).toBeDefined();
  return call[1] as Record<string, unknown>;
}

const ALL_FIVE_KEYS = [
  'join_approval_required',
  'admin_can_approve',
  'card_share_scope',
  'qr_show_scope',
  'search_scope',
] as const;

// ---------------- 三列取值集合的静态读取（防"全局替换" ----------------

/**
 * `src/api/groups.ts` 原文 —— 三列**取值集合**只在类型层存在，运行时被 TS 擦除，
 * 想断言"这一列的合法取值里有没有某个字面量"就只能读源码。
 *
 * 用 `__dirname` 而非 `import.meta.url`：vitest 下后者不是标准 `file://` scheme，
 * `fileURLToPath` 会抛 `TypeError` 让整个文件加载失败（`.claude/rules/frontend-test.md`）。
 */
const GROUPS_SRC = readFileSync(resolve(__dirname, '../../src/api/groups.ts'), 'utf-8');

/** 取 `export type <Name> = 'a' | 'b' | 'c';` 声明里的字面量集合 */
function unionMembers(typeName: string): string[] {
  const decl = new RegExp(`export type ${typeName} =([^;]*);`).exec(GROUPS_SRC);
  // 先断言"找得到"，否则类型改名会让下面的集合断言在空数组上恒真（0 命中与真结论同形）
  expect(decl, `源码里找不到 export type ${typeName}`).not.toBeNull();
  const members = [...decl![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  expect(members.length, `${typeName} 的取值集合解析为空`).toBeGreaterThan(0);
  return members;
}

/**
 * 取 `export interface JoinPolicy` 里某个字段**声明的类型名**。
 *
 * 🔴 必须逐列各走一次，不能假设"card 和 qr 用的是同一个类型" —— 那个假设正是本组要防的
 * 事故（谁把 `qr_show_scope` 挪到 `SearchScope` 上，只断言 `GroupScope` 的测试照样绿）。
 */
function joinPolicyFieldType(field: string): string {
  const block = /export interface JoinPolicy \{([^}]*)\}/.exec(GROUPS_SRC);
  expect(block, '源码里找不到 export interface JoinPolicy').not.toBeNull();
  const line = new RegExp(`\\n\\s*${field}\\??:\\s*([A-Za-z0-9_]+);`).exec(block![1]);
  expect(line, `JoinPolicy 里找不到字段 ${field}`).not.toBeNull();
  return line![1];
}

describe('入群策略 API (api/groups join-policy)', () => {
  let api: Api;

  beforeEach(() => {
    api = makeApi();
  });

  // ---------------- getGroupDetail ----------------

  describe('getGroupDetail', () => {
    it('打的是 /api/groups/{id} 本体，不是 /public', async () => {
      api.get.mockResolvedValue({ group_id: 'g1' });
      const out = await getGroupDetail(api, 'g1');

      expect(api.get).toHaveBeenCalledWith('/api/groups/g1');
      // 反向断言：走错端点（/public 无成员门控）时下面这条会红
      expect(api.get).not.toHaveBeenCalledWith('/api/groups/g1/public');
      expect(String(api.get.mock.calls[0][0])).not.toContain('/public');
      expect(out).toEqual({ group_id: 'g1' });
    });

    it('groupId 经 encodeURIComponent（含斜杠的 id 不会撑破路径）', async () => {
      api.get.mockResolvedValue({});
      await getGroupDetail(api, 'a/b?c');
      expect(api.get).toHaveBeenCalledWith('/api/groups/a%2Fb%3Fc');
    });

    it('五个入群策略字段缺失时原样透传 undefined（不在 API 层兜默认值）', async () => {
      // 回落是显示层的事（JOIN_POLICY_DEFAULTS + applyJoinPolicyDefaults），
      // API 层若偷偷补默认值，调用方就再也分不清"后端没这字段"和"后端说是默认值"。
      api.get.mockResolvedValue({ group_id: 'g1', group_name: '群一' });
      const out = await getGroupDetail(api, 'g1');
      expect(out.card_share_scope).toBeUndefined();
      expect(out.join_approval_required).toBeUndefined();
    });

    it('api 抛错时原样向上抛', async () => {
      api.get.mockRejectedValue(new Error('boom'));
      await expect(getGroupDetail(api, 'g1')).rejects.toThrow('boom');
    });
  });

  // ---------------- updateJoinPolicy：URL / 返回 ----------------

  describe('updateJoinPolicy — URL 与返回', () => {
    it('PUT /api/groups/{id}/join-policy，返回值原样透传', async () => {
      api.put.mockResolvedValue(FULL_POLICY);
      const out = await updateJoinPolicy(api, 'g1', { search_scope: 'admins' });

      expect(api.put).toHaveBeenCalledWith('/api/groups/g1/join-policy', {
        search_scope: 'admins',
      });
      expect(out).toEqual(FULL_POLICY);
    });

    it('端点名是连字符 join-policy（不是已删除的下划线 join_mode 端点）', async () => {
      api.put.mockResolvedValue(FULL_POLICY);
      await updateJoinPolicy(api, 'g1', { admin_can_approve: true });
      const url = String(api.put.mock.calls[0][0]);
      expect(url).toBe('/api/groups/g1/join-policy');
      expect(url).not.toContain('join_mode');
      expect(url).not.toContain('join_policy');
    });

    it('groupId 经 encodeURIComponent', async () => {
      api.put.mockResolvedValue(FULL_POLICY);
      await updateJoinPolicy(api, 'a b/c', { admin_can_approve: false });
      expect(String(api.put.mock.calls[0][0])).toBe('/api/groups/a%20b%2Fc/join-policy');
    });

    it('api 抛错时原样向上抛', async () => {
      api.put.mockRejectedValue(new Error('boom'));
      await expect(updateJoinPolicy(api, 'g1', { qr_show_scope: 'admins' })).rejects.toThrow('boom');
    });
  });

  // ---------------- updateJoinPolicy：部分更新（本单核心） ----------------

  describe('updateJoinPolicy — 只发被改的键', () => {
    const SINGLE_KEY_CASES: ReadonlyArray<[string, JoinPolicyPatch, unknown]> = [
      ['join_approval_required=true', { join_approval_required: true }, true],
      ['join_approval_required=false', { join_approval_required: false }, false],
      ['admin_can_approve=true', { admin_can_approve: true }, true],
      ['admin_can_approve=false', { admin_can_approve: false }, false],
      ['card_share_scope=admins', { card_share_scope: 'admins' }, 'admins'],
      ['qr_show_scope=owner_only', { qr_show_scope: 'owner_only' }, 'owner_only'],
      ['search_scope=everyone', { search_scope: 'everyone' }, 'everyone'],
    ];

    it.each(SINGLE_KEY_CASES)(
      '只传 %s ⇒ body 恰好只有那一个键，其余四键均不出现',
      async (_name, patch, expectedValue) => {
        api.put.mockResolvedValue(FULL_POLICY);
        await updateJoinPolicy(api, 'g1', patch);

        const body = putBody(api);
        const [targetKey] = Object.keys(patch) as Array<keyof JoinPolicyPatch>;

        // 正向：目标键在，且值逐字相等（含 false —— 这才是 `if (x)` 式过滤会漏的那一半）
        expect(body[targetKey]).toBe(expectedValue);
        // 反向 ①：键集合恰好只有一个（多发任何一个键都会红）
        expect(Object.keys(body)).toEqual([targetKey]);
        // 反向 ②：逐个点名其余四键不存在（不是只断言"含目标键"）
        for (const key of ALL_FIVE_KEYS) {
          if (key !== targetKey) {
            expect(body).not.toHaveProperty(key);
          }
        }
      },
    );

    it('显式传 undefined 的键不进 body（不依赖 JSON.stringify 丢 undefined 这个巧合）', async () => {
      api.put.mockResolvedValue(FULL_POLICY);
      await updateJoinPolicy(api, 'g1', {
        card_share_scope: 'admins',
        qr_show_scope: undefined,
        join_approval_required: undefined,
      });

      const body = putBody(api);
      expect(Object.keys(body)).toEqual(['card_share_scope']);
      // 键"存在但值为 undefined"同样算违规：JSON.stringify 会丢它，但那是序列化层行为，
      // 不该成为「只发被改的键」这条契约的依据。
      expect('qr_show_scope' in body).toBe(false);
      expect('join_approval_required' in body).toBe(false);
    });

    it('多键一起传时都在 body 里（部分更新不等于只能改一个）', async () => {
      api.put.mockResolvedValue(FULL_POLICY);
      await updateJoinPolicy(api, 'g1', {
        join_approval_required: false,
        admin_can_approve: false,
      });

      const body = putBody(api);
      expect(body).toEqual({ join_approval_required: false, admin_can_approve: false });
      expect(Object.keys(body).sort()).toEqual(['admin_can_approve', 'join_approval_required']);
    });

    it('空 patch ⇒ body 为空对象（不发任何字段，后端据契约保持原值）', async () => {
      api.put.mockResolvedValue(FULL_POLICY);
      await updateJoinPolicy(api, 'g1', {});
      expect(putBody(api)).toEqual({});
    });

    it('body 是新建对象，不是把调用方的 patch 直接透传出去', async () => {
      api.put.mockResolvedValue(FULL_POLICY);
      const patch: JoinPolicyPatch = { search_scope: 'owner_only' };
      await updateJoinPolicy(api, 'g1', patch);
      // 透传的话下游任何改写都会打到调用方的对象上
      expect(putBody(api)).not.toBe(patch);
      expect(putBody(api)).toEqual(patch);
    });
  });

  // ---------------- JOIN_POLICY_DEFAULTS ----------------

  describe('JOIN_POLICY_DEFAULTS', () => {
    it('五值逐字等于契约默认值', () => {
      expect(JOIN_POLICY_DEFAULTS).toEqual({
        join_approval_required: true,
        admin_can_approve: true,
        card_share_scope: 'all_members',
        qr_show_scope: 'all_members',
        search_scope: 'everyone',
      });
    });

    it('键集合恰好是契约那五个（多一个/少一个都红）', () => {
      expect(Object.keys(JOIN_POLICY_DEFAULTS).sort()).toEqual([...ALL_FIVE_KEYS].sort());
    });

    it('三档取值落在各自的白名单内（两个白名单不是同一个）', () => {
      const memberAllowed: ReadonlyArray<GroupScope> = ['all_members', 'admins', 'owner_only'];
      const searchAllowed: ReadonlyArray<SearchScope> = ['everyone', 'admins', 'owner_only'];
      expect(memberAllowed).toContain(JOIN_POLICY_DEFAULTS.card_share_scope);
      expect(memberAllowed).toContain(JOIN_POLICY_DEFAULTS.qr_show_scope);
      expect(searchAllowed).toContain(JOIN_POLICY_DEFAULTS.search_scope);
    });
  });

  // ---------------- search_scope 改名的双向对账（防"全局替换误伤"） ----------------

  /**
   * 🔴 只验「`search_scope` 用上 `everyone` 了」是**不够**的：
   * "改对了" 与 "把三列一起全局替换了" 在那种单向断言下输出**完全同形**。
   * 所以三列**各自一条**（刻意不合并）：一条红就直接指名是哪一列被动了 ——
   * 合成一条的话，`card` 与 `qr` 谁被替换掉都只报同一条失败，还得回头二分。
   *
   * 每条断的是**取值集合**（源码里那个联合类型的字面量集合）+ 该列的默认值，
   * 两个层面都要 —— 只断默认值挡不住"联合里偷偷多了一个档"，
   * 只断联合挡不住"默认值被改到另一档"。
   */
  describe('search_scope 改名：三列各自对账（防全局替换误伤）', () => {
    it('列① card_share_scope：取值集合仍含 all_members、不含 everyone', () => {
      const members = unionMembers(joinPolicyFieldType('card_share_scope'));
      expect(members).toContain('all_members');
      expect(members).not.toContain('everyone');
      expect(JOIN_POLICY_DEFAULTS.card_share_scope).toBe('all_members');
    });

    it('列② qr_show_scope：取值集合仍含 all_members、不含 everyone', () => {
      const members = unionMembers(joinPolicyFieldType('qr_show_scope'));
      expect(members).toContain('all_members');
      expect(members).not.toContain('everyone');
      expect(JOIN_POLICY_DEFAULTS.qr_show_scope).toBe('all_members');
    });

    it('列③ search_scope：取值集合含 everyone、不含 all_members', () => {
      const members = unionMembers(joinPolicyFieldType('search_scope'));
      expect(members).toContain('everyone');
      expect(members).not.toContain('all_members');
      expect(JOIN_POLICY_DEFAULTS.search_scope).toBe('everyone');
    });

    /**
     * 类型层的双向钉死 —— 联合类型在运行时被擦除，只能靠 `tsc` 守。
     * 这四行任何一行的编译结果反转（含 `@ts-expect-error` 变成"没有错误"）都会让
     * `pnpm typecheck` 直接红，所以它们不是装饰。
     */
    it('类型层：两个联合互不接受对方的最松档（由 tsc 强制，本用例只是承载）', () => {
      const memberWidest: GroupScope = 'all_members';
      const searchWidest: SearchScope = 'everyone';
      // @ts-expect-error search_scope 的联合里【不许】再有 all_members（同名反义就是这么来的）
      const searchRejectsAllMembers: SearchScope = 'all_members';
      // @ts-expect-error card/qr 两列的联合里【不许】混进 everyone
      const memberRejectsEveryone: GroupScope = 'everyone';

      expect(memberWidest).toBe('all_members');
      expect(searchWidest).toBe('everyone');
      // 运行时值仍是字面量本身；这两条只为让变量被用到（lint 不允许未使用变量）
      expect(searchRejectsAllMembers as string).toBe('all_members');
      expect(memberRejectsEveryone as string).toBe('everyone');
    });
  });
});
