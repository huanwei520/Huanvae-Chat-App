/**
 * 群名片（group_card）内容编解码的纯函数测试
 *
 * 被测对象是**封闭 schema 的唯一出入口**（src/chat/shared/groupCard.ts）。
 * 契约真值源：backend-docs/groups/群聊管理.md §八 + 后端
 * `friends_messages/services/card_schema.rs` 的 validate_group_card_content。
 *
 * 🔴 本文件最要紧的一条是**反向断言**：产出的 JSON **只能有 group_id 一个键**。
 * 正向断言（「含 group_id」）挡不住「多塞一个 group_name」——那正是后端会 400 的形态，
 * 而多出来的键在 TS 里毫无痕迹（对象字面量宽松、JSON.stringify 不挑）。
 */

import { describe, it, expect } from 'vitest';
import {
  GROUP_CARD_PREVIEW_TEXT,
  buildGroupCardContent,
  describeShareGroupCardError,
  parseGroupCardContent,
} from '../../src/chat/shared/groupCard';

const GID = '550e8400-e29b-41d4-a716-446655440000';

describe('buildGroupCardContent —— 封闭 schema', () => {
  it('正向：产出可被解析回同一个 group_id 的 JSON', () => {
    const content = buildGroupCardContent(GID);
    expect(JSON.parse(content)).toEqual({ group_id: GID });
    expect(parseGroupCardContent(content)).toBe(GID);
  });

  it('🔴 反向断言：产出的对象【有且仅有】group_id 一个键（多一个键后端就是 400）', () => {
    const parsed = JSON.parse(buildGroupCardContent(GID)) as Record<string, unknown>;

    // 只数「有几个键」还不够——键数对了也可能是把 group_id 换成了别的名字，
    // 所以同时钉死键名集合本身。
    expect(Object.keys(parsed)).toEqual(['group_id']);
    expect(Object.keys(parsed)).toHaveLength(1);

    // 逐条点名那些「看着有用、塞进去就 400」的展示字段：一个都不许出现
    for (const forbidden of ['group_name', 'group_avatar_url', 'member_count', 'group_description', 'join_approval_required']) {
      expect(parsed).not.toHaveProperty(forbidden);
    }
  });

  it('反向断言（字符串层）：序列化结果里不出现任何第二个键的冒号分隔', () => {
    const content = buildGroupCardContent(GID);
    // `{"group_id":"…"}` 只有一个 `":` 结构；多一个键必然多一个 `,"`
    expect(content.includes(',"')).toBe(false);
    expect(content).toBe(`{"group_id":"${GID}"}`);
  });
});

describe('parseGroupCardContent —— 任何不合形态一律 null（调用方据此走失效态）', () => {
  it('合法形态解出 group_id', () => {
    expect(parseGroupCardContent(`{"group_id":"${GID}"}`)).toBe(GID);
  });

  it('多余键不影响解析（后端会 400，但客户端收到了就尽量渲染出来，不把已有的卡片弄丢）', () => {
    expect(parseGroupCardContent(`{"group_id":"${GID}","group_name":"伪造的名字"}`)).toBe(GID);
  });

  it.each([
    ['非法 JSON', '这不是 json'],
    ['空串', ''],
    ['根是数组', '[]'],
    ['根是 null', 'null'],
    ['根是数字', '42'],
    ['根是字符串', '"group_id"'],
    ['缺 group_id', '{"gid":"x"}'],
    ['group_id 不是字符串', '{"group_id":123}'],
    ['group_id 是 null', '{"group_id":null}'],
    ['group_id 是空白串', '{"group_id":"   "}'],
  ])('不合形态返回 null：%s', (_label, content) => {
    expect(parseGroupCardContent(content)).toBeNull();
  });

  it('解析失败不抛异常（气泡不许因为一条坏消息整条崩掉）', () => {
    expect(() => parseGroupCardContent('{')).not.toThrow();
    expect(() => parseGroupCardContent('undefined')).not.toThrow();
  });
});

describe('describeShareGroupCardError —— 三态必须是三种不同的东西', () => {
  const fallback = '原始错误文案';

  it('403 说清是「那个群的权限」，不是网络错误', () => {
    const msg = describeShareGroupCardError(403, fallback);
    expect(msg).toContain('权限');
    expect(msg).not.toContain('网络');
    expect(msg).not.toBe(fallback);
  });

  it('404 说清是群不存在 / 已解散', () => {
    const msg = describeShareGroupCardError(404, fallback);
    expect(msg).toContain('解散');
    expect(msg).not.toBe(fallback);
  });

  it('400 说清是内容不被接受（客户端问题），不冒充权限或不存在', () => {
    const msg = describeShareGroupCardError(400, fallback);
    expect(msg).not.toContain('权限');
    expect(msg).not.toContain('解散');
    expect(msg).not.toBe(fallback);
  });

  it('三态两两不同（同形就等于没分三态）', () => {
    const texts = [400, 403, 404].map((s) => describeShareGroupCardError(s, fallback));
    expect(new Set(texts).size).toBe(3);
  });

  it('拿不到状态码时回落到原文，不猜成三态里的任何一个', () => {
    expect(describeShareGroupCardError(null, fallback)).toBe(fallback);
    expect(describeShareGroupCardError(500, fallback)).toBe(fallback);
  });
});

describe('GROUP_CARD_PREVIEW_TEXT', () => {
  it('是一个可辨识的标签，不是空串（会话列表/通知/引用块共用它顶掉裸 JSON）', () => {
    expect(GROUP_CARD_PREVIEW_TEXT).toBe('[群名片]');
  });
});
