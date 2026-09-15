/**
 * 假失败「为何不自愈」的结构性判别测试 —— sync 合并无法认领失败乐观条
 *
 * ## 这是一个独立的、可判别的缺陷（不是「改个标记位」）
 *
 * 链路事实（均有代码与运行证据）：
 *   1) 发送方本设备被实时推送**排除**（后端 `send_to_other_devices` 的
 *      `if conn.device_id != exclude_device_id`）⇒ 发送方自己发失败时，**没有**实时回显可用。
 *   2) 增量同步 `POST /api/messages/sync` 的 SQL 是 `seq > 游标` 取增量，
 *      `sender-id = 我` 的行**有资格**被返回（并非「sync 不含自己消息」）。
 *   3) 但客户端合并 `mergeMessageList` 是**按 `message_uuid` 对齐**的；而失败乐观条的
 *      `message_uuid` 用的是本地 `clientId`（见 useLocalFriendMessages.ts:608 `const tempUuid = clientId`），
 *      服务端真实 uuid 与它**永不相等** ⇒ 即便 sync 把这条带回来了，它也只会作为**新气泡**追加，
 *      `sendStatus: 'failed'` 的乐观条**不会被认领/清除**。
 *
 *   结论：靠「等 sync」清不掉失败标记 —— 这正是实测（置 failed 后连续 sync 与点横幅重试，
 *   27 秒内状态不变）的结构性解释。
 *
 * 判别口径：
 *   - 臂1（只依赖 sync 合并）：失败条保持 failed；
 *   - 臂2（本块修复：按正文+类型+发送者+时间下界做历史对账）：同一条恢复为 sent；
 *   - 断言两臂结果**不相等**（否则本组用例没有判别力）。
 */

import { describe, it, expect, vi } from 'vitest';
import { mergeMessageList, type MergeableMessage } from '../../src/chat/shared/mergeMessageList';
import { probeSentText } from '../../src/chat/shared/sendFailureReconcile';
import type { ApiClient } from '../../src/api/client';

vi.mock('../../src/db', () => ({
  saveMessage: vi.fn().mockResolvedValue(undefined),
}));

const NOW = Date.parse('2026-09-14T14:01:15.000Z');
const CLIENT_ID = 'client_1757858475000_ab12cd';

/** 合并入参的显式类型（避免 TS 从字面量把泛型 T 收窄成 clientId: string 的固定形状） */
type Row = MergeableMessage;

/** 内存里那条发送失败的乐观消息（uuid = clientId，与后端真实 uuid 不等） */
const failedOptimistic: Row = {
  message_uuid: CLIENT_ID,
  send_time: new Date(NOW).toISOString(),
  clientId: CLIENT_ID,
  sendStatus: 'failed' as const,
};

/** 服务端返回的历史行（真实 uuid + seq） */
function serverRow(overrides: Record<string, unknown> = {}) {
  return {
    message_uuid: '6d374bf3-1e7d-4520-8fc2-a5957a1b2c3d',
    sender_id: 'fwa2k01',
    message_content: 'SAMEACCT30-1401',
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    reply_to: null,
    media_group_id: null,
    media_group_index: null,
    media_group_count: null,
    seq: 10,
    send_time: new Date(NOW + 300).toISOString(),
    is_recalled: false,
    ...overrides,
  };
}

function fakeApi(history: unknown[]): ApiClient {
  return { get: vi.fn().mockResolvedValue({ messages: history }) } as unknown as ApiClient;
}

describe('假失败不自愈的结构性原因：sync 合并按 uuid 对齐，认领不了 clientId 乐观条', () => {
  it('臂1：把服务端那条并进来（模拟 sync 带回），失败条仍保持 failed（且并存一条新气泡）', () => {
    const prev: Row[] = [failedOptimistic];
    // sync 从 db 读出的这一段就是服务端真实行
    const incoming: Row[] = [
      {
        message_uuid: '6d374bf3-1e7d-4520-8fc2-a5957a1b2c3d',
        send_time: new Date(NOW + 300).toISOString(),
        sendStatus: 'sent',
      },
    ];
    const merged = mergeMessageList([...prev], [...incoming]);
    const stillThere = merged.find((m) => m.clientId === CLIENT_ID);
    // 失败标记没有被清掉
    expect(stillThere?.sendStatus).toBe('failed');
    // 而且服务端那条是**并列追加**（同一个客户端列表里出现两条），证明「没认领」
    expect(merged.length).toBe(2);
  });

  it('臂2：本块修复（历史对账 probeSentText）能认领这一条 → 恢复为 sent', async () => {
    const api = fakeApi([serverRow()]);
    const hit = await probeSentText(api, {
      conversationType: 'friend',
      targetId: 'fwb2k01',
      content: 'SAMEACCT30-1401',
      messageType: 'text',
      sendTimeIso: failedOptimistic.send_time,
      userId: 'fwa2k01',
    });
    expect(hit).not.toBeNull();
    expect(hit?.message_uuid).toBe('6d374bf3-1e7d-4520-8fc2-a5957a1b2c3d');
  });

  it('判别性：两臂结果必须不同（臂1 仍 failed / 臂2 命中真实行）', async () => {
    const prev: Row[] = [failedOptimistic];
    const incoming: Row[] = [{
      message_uuid: '6d374bf3-1e7d-4520-8fc2-a5957a1b2c3d',
      send_time: new Date(NOW + 300).toISOString(),
      sendStatus: 'sent',
    }];
    const merged = mergeMessageList([...prev], [...incoming]);
    const armSync = { sendStatus: merged.find((m) => m.clientId === CLIENT_ID)?.sendStatus, claimed: merged.length === 1 };

    const api = fakeApi([serverRow()]);
    const hit = await probeSentText(api, {
      conversationType: 'friend', targetId: 'fwb2k01', content: 'SAMEACCT30-1401',
      messageType: 'text', sendTimeIso: failedOptimistic.send_time, userId: 'fwa2k01',
    });
    const armReconcile = { sendStatus: hit ? 'sent' : 'failed', claimed: !!hit };

    expect(armSync).not.toEqual(armReconcile);
    expect(armSync.claimed).toBe(false);
    expect(armReconcile.claimed).toBe(true);
  });
});
