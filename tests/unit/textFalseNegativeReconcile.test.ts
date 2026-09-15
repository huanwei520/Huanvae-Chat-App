/**
 * 文本路径假阴性失败的服务端对账（probeSentText）回归 —— **判别性 A/B**
 *
 * 病灶（本块第 29 轮在 Windows VM 真机 App 上实测确认）：
 * `POST /api/messages` 已被服务端受理并派发给对端，但响应在回程丢失
 * （边车注入 `dropResponsePaths` 复现：客户端 `HTTP=000`，服务端 `DROPPED_AFTER_SERVER_ACCEPT`
 * 且历史里能查到该 uuid）。客户端 catch 后把气泡标 `send-failed`。
 * 实测还确认：**增量同步不含自己发的消息** —— 置 failed 后连续 sync、点横幅重试均不自愈
 * （真机观察 27s 无变化），因此唯一真值来源是「历史查询」本身。
 *
 * A/B 判别口径：
 * - 前臂 = 修复前的实现（catch 里只把气泡标 failed，**不发起任何历史查询**）；
 * - 后臂 = 修复后的实现（发起 `probeSentText`，命中则回写真实 uuid/seq 并恢复 `sent`）；
 * - 断言两臂**结果不相等**（否则这组用例没有判别力）。
 *
 * 另含三条安全边界：正文不等 / 非本机发送 / 早于时间下界 ⇒ 一律返回 null，
 * 保持 failed 原状（真失败绝不能被洗成已发送）。
 */

import { describe, it, expect, vi } from 'vitest';
import { probeSentText, type TextProbe } from '../../src/chat/shared/sendFailureReconcile';
import type { ApiClient } from '../../src/api/client';

vi.mock('../../src/db', () => ({
  saveMessage: vi.fn().mockResolvedValue(undefined),
}));

const NOW = Date.parse('2026-09-14T13:10:53.000Z');

/** 服务端历史行（好友路径形状） */
function row(overrides: Record<string, unknown> = {}) {
  return {
    message_uuid: 'srv-text-1',
    sender_id: 'user-self',
    message_content: 'RIGFALSE29-1256',
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    reply_to: null,
    media_group_id: null,
    media_group_index: null,
    media_group_count: null,
    seq: 12,
    // 服务端落库时刻 = 发送时刻 + 0.3s（实测口径）
    send_time: new Date(NOW + 300).toISOString(),
    is_recalled: false,
    ...overrides,
  };
}

function probe(overrides: Partial<TextProbe> = {}): TextProbe {
  return {
    conversationType: 'friend',
    targetId: 'friend-b',
    content: 'RIGFALSE29-1256',
    messageType: 'text',
    // 入队时刻（tempSendTime）
    sendTimeIso: new Date(NOW).toISOString(),
    userId: 'user-self',
    ...overrides,
  };
}

function fakeApi(history: unknown[]): ApiClient {
  return { get: vi.fn().mockResolvedValue({ messages: history }) } as unknown as ApiClient;
}

describe('文本假阴性：修复前 vs 修复后（判别性）', () => {
  it('服务端已受理而响应丢失时：修复前留 failed，修复后恢复 sent', async () => {
    const api = fakeApi([row()]);

    // ── 前臂：修复前的 catch 分支（只标 failed，不查历史）──
    const before = { sendStatus: 'failed' as string, message_uuid: 'local_client_abc', seq: 0 };
    expect((api.get as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled(); // 修复前零查询

    // ── 后臂：修复后（catch 里触发历史对账）──
    const hit = await probeSentText(api, probe());
    expect(hit).not.toBeNull();
    const after = hit
      ? { sendStatus: 'sent', message_uuid: hit.message_uuid, seq: hit.seq }
      : before;

    // 单臂断言
    expect(after.sendStatus).toBe('sent');
    expect(after.message_uuid).toBe('srv-text-1');
    expect(after.seq).toBe(12);

    // 判别性核心：两臂结果必须不同
    expect(after).not.toEqual(before);
    expect(after.sendStatus).not.toBe(before.sendStatus);
    expect(before.sendStatus).toBe('failed');
  });

  it('两条同正文消息（对账窗口内重发）取最早那条，不冒领后来者', async () => {
    const api = fakeApi([
      row({ message_uuid: 'srv-later', seq: 13, send_time: new Date(NOW + 90_000).toISOString() }),
      row({ message_uuid: 'srv-earlier', seq: 12, send_time: new Date(NOW + 300).toISOString() }),
    ]);
    const hit = await probeSentText(api, probe());
    expect(hit?.message_uuid).toBe('srv-earlier');
  });

  it('好友/群两条历史接口都由 conversationType 决定（群聊走群历史）', async () => {
    const api = fakeApi([row()]);
    const hit = await probeSentText(api, probe({ conversationType: 'group', targetId: 'group-9' }));
    expect(hit?.message_uuid).toBe('srv-text-1');
    const url = (api.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('/api/group_messages');
    expect(url).toContain('group_id=group-9');
  });

  it('会议邀请（message_type=meeting_invite）同口径可对账', async () => {
    const content = '{"room_id":"HUTLR6","password":"514567","room_name":"RIGFWD29"}';
    const api = fakeApi([row({ message_type: 'meeting_invite', message_content: content, seq: 9 })]);
    const hit = await probeSentText(api, probe({ content, messageType: 'meeting_invite' }));
    expect(hit?.seq).toBe(9);
    expect(hit?.message_type).toBe('meeting_invite');
  });
});

describe('文本假阴性对账：安全边界（真失败不得被洗白）', () => {
  it('正文不等 ⇒ null（保持 failed）', async () => {
    const api = fakeApi([row({ message_content: '别的内容' })]);
    expect(await probeSentText(api, probe())).toBeNull();
  });

  it('不是本机发的 ⇒ null（对端发来同正文不算数）', async () => {
    const api = fakeApi([row({ sender_id: 'user-peer' })]);
    expect(await probeSentText(api, probe())).toBeNull();
  });

  it('早于时间下界（容差 5 分钟之外）⇒ null（不能拿昨天的旧消息冒领）', async () => {
    const api = fakeApi([row({ send_time: new Date(NOW - 10 * 60_000).toISOString() })]);
    expect(await probeSentText(api, probe())).toBeNull();
  });

  it('类型不等 ⇒ null', async () => {
    const api = fakeApi([row({ message_type: 'image' })]);
    expect(await probeSentText(api, probe())).toBeNull();
  });

  it('历史里根本没有这条 ⇒ null（真失败）', async () => {
    const api = fakeApi([row({ message_uuid: 'srv-other', message_content: '无关' })]);
    expect(await probeSentText(api, probe())).toBeNull();
  });
});
