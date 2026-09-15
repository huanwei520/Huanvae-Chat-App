/**
 * 假阴性**判别性**回归（A/B 对照）—— #8「图片/消息显示发送失败但对方实收」
 *
 * @module tests/unit
 *
 * ## 为什么单独一个文件
 *
 * 既有的 `sendFailureReconcile.test.ts` / `wsEchoClaim.test.ts` 只断言**修复后**的行为，
 * 对「修复是否真的改变了结果」零判别力（正常链路修复前后表现相同）。本文件构造
 * **同一份假阴性输入**（服务端已受理、客户端响应回程丢失 ⇒ 条目 failed），
 * 对「修复前实现」与「修复后实现」分别求值，断言两者结果**必然不同**：
 *
 * | 路径 | 修复前（对照实现/无对账） | 修复后（本仓实现） |
 * |---|---|---|
 * | 文本（wsEchoClaim） | `-1`：回显认领落空 → 走「新消息」分支 → 红叹号失败条留存 | 命中 failed 索引 → 调用方回填 uuid/seq/sent |
 * | 媒体（sendFailureReconcile） | 条目保持 `failed`、不落库 | 服务端历史命中 → 落库 + `done` + realUuid |
 *
 * ## 触发条件对应的线上实测（同一条件，真实服务端 + 真机对端）
 *
 * `test-artifacts-block2/rig/edge-rig.mjs`（旁车，TLS 终止 → 生产 47.105.101.42:443）设
 * `dropResponsePaths: ["/api/messages"]` 时：
 * - 客户端 curl 收 `rc=52`（空响应/连接重置）＝「响应回程丢失」
 * - 旁车日志 `DROPPED_AFTER_SERVER_ACCEPT` 记下服务端真实响应
 *   `{"success":true,...,"message_uuid":"a981befa-…","seq":6}`
 * - 服务端历史 `GET /api/messages` 可查到该 uuid；对端模拟器同一秒收到该正文
 * 详见交付文档「判别性实验」一节（边车日志 + 设备截图）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  pickSendingEchoIndex,
  type ClaimableMessage,
  type EchoIdentity,
} from '../../src/chat/shared/wsEchoClaim';
import {
  reconcileFailedSendingEntry,
  type MediaProbe,
} from '../../src/chat/shared/sendFailureReconcile';
import { useSendingMediaStore, type SendingMediaEntry } from '../../src/stores/sendingMediaStore';
import type { ApiClient } from '../../src/api/client';

// db 是 Tauri invoke 后端 —— 单测里整体 mock
vi.mock('../../src/db', () => ({
  saveMessage: vi.fn().mockResolvedValue(undefined),
}));
import { saveMessage } from '../../src/db';

const NOW = Date.parse('2026-09-14T10:52:16.000Z');

/**
 * **修复前**的认领实现（逐字复刻本次改动前的两级逻辑：只有 sending 两级，没有 failed 精确修复）。
 * 作为 A/B 的「前」臂。改动前的真实代码见 wsEchoClaim.ts 文件头引用的历史实现。
 */
function pickEchoIndexPreFix<T extends ClaimableMessage>(
  list: readonly T[],
  echo: EchoIdentity,
): number {
  let fallback = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m.sendStatus !== 'sending') { continue; }
    if (fallback === -1) { fallback = i; }
    if (m.message_type === echo.message_type && m.message_content === echo.content) {
      return i;
    }
  }
  return fallback;
}

describe('#8-A 文本路径：响应丢失 + WS 回显（A/B 判别）', () => {
  // 假阴性输入：一条因响应回程丢失被标 failed 的乐观条目
  const failedList: ClaimableMessage[] = [
    { message_content: 'RIGDROP-105215', message_type: 'text', sendStatus: 'failed' },
    { message_content: '上一条历史', message_type: 'text', sendStatus: 'sent' },
  ];
  // 服务端受理后折返回来的回显（正文 + 类型与服务端落库一致）
  const echo: EchoIdentity = { content: 'RIGDROP-105215', message_type: 'text' };

  it('修复前：认领落空（-1）⇒ 回显走「新消息」分支，failed 条留存（假阴性可见）', () => {
    expect(pickEchoIndexPreFix(failedList, echo)).toBe(-1);
  });

  it('修复后：命中该 failed 条目索引 ⇒ 调用方可回填 uuid/seq 并清除失败标记', () => {
    expect(pickSendingEchoIndex(failedList, echo)).toBe(0);
  });

  it('判别性：同一输入两臂结果不同（-1 vs 0）', () => {
    expect(pickSendingEchoIndex(failedList, echo)).not.toBe(pickEchoIndexPreFix(failedList, echo));
  });

  it('安全边界：正文不等的 failed 条目两臂都不认领（真失败不被洗白）', () => {
    const otherEcho: EchoIdentity = { content: '另一条正文', message_type: 'text' };
    expect(pickEchoIndexPreFix(failedList, otherEcho)).toBe(-1);
    expect(pickSendingEchoIndex(failedList, otherEcho)).toBe(-1);
  });
});

function friendRow(overrides: Record<string, unknown>) {
  return {
    message_uuid: 'a981befa-9115-4819-81d5-7001dd307f3d',
    sender_id: 'user-self',
    message_content: '[图片] r.png',
    message_type: 'image',
    file_uuid: 'fu-1',
    file_url: 'https://files.example/fu-1',
    file_size: 12345,
    image_width: 800,
    image_height: 600,
    reply_to: null,
    media_group_id: null,
    media_group_index: null,
    media_group_count: null,
    seq: 6,
    send_time: '2026-09-14T10:52:16.066Z',
    is_recalled: false,
    ...overrides,
  };
}

function fakeApi(history: unknown[]): ApiClient {
  return { get: vi.fn().mockResolvedValue({ messages: history }) } as unknown as ApiClient;
}

function entry(): SendingMediaEntry {
  return {
    clientId: 'client_diff-1',
    file: new File(['bytes'], 'r.png', { type: 'image/png' }),
    conversationKey: 'friend:user-self:friend-1',
    conversationType: 'friend',
    targetId: 'friend-1',
    status: 'failed',
    percent: 0,
    shape: { kind: 'single', groupId: null, index: null, count: null },
    preview: {
      name: 'r.png',
      kind: 'image',
      size: 12345,
      localPath: '',
      width: 800,
      height: 600,
      previewUrl: null,
    },
    caption: undefined,
    realUuid: null,
    sendTime: new Date(NOW - 60_000).toISOString(),
  };
}

/** 把一条 failed 条目放进真实 store（对账的前置状态：上传 confirm 响应回程丢失） */
function seedFailedEntry(e: SendingMediaEntry) {
  const s = useSendingMediaStore.getState();
  s.enqueue([{
    clientId: e.clientId,
    file: e.file,
    conversationKey: e.conversationKey,
    conversationType: e.conversationType,
    targetId: e.targetId,
    shape: e.shape,
    preview: {
      name: e.preview.name,
      kind: e.preview.kind,
      size: e.preview.size,
      localPath: e.preview.localPath,
      width: e.preview.width,
      height: e.preview.height,
    },
    caption: e.caption,
    replyTo: e.replyTo,
    sendTime: e.sendTime,
  }]);
  useSendingMediaStore.getState().markFailed(e.clientId, '网络错误（响应回程丢失）');
}

beforeEach(() => {
  vi.clearAllMocks();
  useSendingMediaStore.setState({
    entries: {},
    orderByConversation: { 'friend:user-self:friend-1': ['client_diff-1'] },
  });
});

describe('#8-B 媒体路径：confirm 响应丢失（A/B 判别）', () => {
  const probe: MediaProbe = {
    conversationType: 'friend',
    targetId: 'friend-1',
    kind: 'image',
    caption: undefined,
    filename: 'r.png',
    sendTimeIso: new Date(NOW - 60_000).toISOString(),
    userId: 'user-self',
  };

  it('修复前（无对账）：条目停在 failed、不落库 —— 即线上「显示发送失败」的那一态', () => {
    const e = entry();
    seedFailedEntry(e);
    // 修复前行为：catch 里只 markFailed，没有服务端对账
    expect(useSendingMediaStore.getState().entries[e.clientId]?.status).toBe('failed');
    expect(saveMessage).not.toHaveBeenCalled();
  });

  it('修复后（有对账）：服务端历史命中 ⇒ 落库 + done + realUuid（实收不再标失败）', async () => {
    const e = entry();
    seedFailedEntry(e);
    await reconcileFailedSendingEntry(fakeApi([friendRow({})]), e, {
      userId: 'user-self',
      profile: { user_nickname: '测试者', user_avatar_url: null },
    });
    const after = useSendingMediaStore.getState().entries[e.clientId];
    expect(after?.status).toBe('done');
    expect(after?.realUuid).toBe('a981befa-9115-4819-81d5-7001dd307f3d');
    expect(saveMessage).toHaveBeenCalledTimes(1);
    expect(probe.filename).toBe(e.preview.name);
  });

  it('判别性：同一 failed 前置状态下，无对账=failed / 有对账=done', async () => {
    const pre = entry();
    seedFailedEntry(pre);
    const preFixStatus = useSendingMediaStore.getState().entries[pre.clientId]?.status;

    useSendingMediaStore.setState({
      entries: {},
      orderByConversation: { 'friend:user-self:friend-1': ['client_diff-2'] },
    });
    const post = { ...entry(), clientId: 'client_diff-2' };
    seedFailedEntry(post);
    await reconcileFailedSendingEntry(fakeApi([friendRow({})]), post, {
      userId: 'user-self',
      profile: { user_nickname: '测试者', user_avatar_url: null },
    });
    const postFixStatus = useSendingMediaStore.getState().entries[post.clientId]?.status;

    expect(preFixStatus).toBe('failed');
    expect(postFixStatus).toBe('done');
    expect(preFixStatus).not.toBe(postFixStatus);
  });

  it('安全边界：服务端历史无此消息（真失败）⇒ 对账后仍 failed，绝不洗白', async () => {
    const e = entry();
    seedFailedEntry(e);
    await reconcileFailedSendingEntry(fakeApi([]), e, {
      userId: 'user-self',
      profile: { user_nickname: '测试者', user_avatar_url: null },
    });
    expect(useSendingMediaStore.getState().entries[e.clientId]?.status).toBe('failed');
    expect(saveMessage).not.toHaveBeenCalled();
  });
});
