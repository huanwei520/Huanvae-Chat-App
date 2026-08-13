/**
 * 发送态状态机 + 乐观插入合并
 *
 * 覆盖 spec §五 的第 2 / 3 / 5 问：
 * - 第 2 问：临时 id ⇒ 真 id 替换，同一 uuid 只存在一条（不重、不闪）
 * - 第 3 问：失败重试时它**还在原来的位置**，不跳到列表底部
 * - 第 5 问：相册形态发送前定死，**中途删除 / 失败都不改变它**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useSendingMediaStore,
  pickSendingEntries,
  mergeSendingIntoMessages,
  type SendingMediaSeed,
  type SendingMediaEntry,
} from '../../src/stores/sendingMediaStore';

const KEY = 'friend:u1';

function seed(clientId: string, index: number, count: number, groupId = 'G1'): SendingMediaSeed {
  return {
    clientId,
    file: new File(['x'], `${clientId}.png`, { type: 'image/png' }),
    conversationKey: KEY,
    conversationType: 'friend',
    targetId: 'u1',
    shape: { kind: 'album', groupId, index, count },
    preview: { name: `${clientId}.png`, kind: 'image', size: 1, localPath: '', previewUrl: null },
    sendTime: '2026-08-13T00:00:00.000Z',
  };
}

function entriesOf(): SendingMediaEntry[] {
  const s = useSendingMediaStore.getState();
  return pickSendingEntries(s.entries, s.orderByConversation, KEY);
}

beforeEach(() => {
  useSendingMediaStore.setState({ entries: {}, orderByConversation: {} });
});

describe('状态迁移 pending → uploading → done / failed → retry', () => {
  it('入队即 pending、percent=0', () => {
    useSendingMediaStore.getState().enqueue([seed('client_a', 0, 2), seed('client_b', 1, 2)]);
    expect(entriesOf().map((e) => [e.clientId, e.status, e.percent]))
      .toEqual([['client_a', 'pending', 0], ['client_b', 'pending', 0]]);
  });

  it('markUploading 写百分比并清掉上一次的错误', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0, 2)]);
    st.markFailed('client_a', '网络错误');
    st.markUploading('client_a', 37);
    const e = entriesOf()[0];
    expect(e.status).toBe('uploading');
    expect(e.percent).toBe(37);
    expect(e.error).toBeUndefined();
  });

  it('markSent 写真 uuid、percent 归 100', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0, 2)]);
    st.markSent('client_a', 'real-uuid-1');
    const e = entriesOf()[0];
    expect(e.status).toBe('done');
    expect(e.percent).toBe(100);
    expect(e.realUuid).toBe('real-uuid-1');
  });

  it('markFailed 记下错误原文（UI 要能把"取消"和"真失败"分开）', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0, 2)]);
    st.markFailed('client_a', 'HTTP 502');
    expect(entriesOf()[0].error).toBe('HTTP 502');
  });

  it('retry 只对 failed 生效：done / uploading 不会被打回 pending', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0, 2)]);
    st.markUploading('client_a', 50);
    st.retry('client_a');
    expect(entriesOf()[0].status).toBe('uploading');

    st.markFailed('client_a', 'x');
    st.retry('client_a');
    expect(entriesOf()[0].status).toBe('pending');
    expect(entriesOf()[0].percent).toBe(0);
  });
});

describe('🔴 spec §五 第 3 问：失败重试不改变位置', () => {
  it('三项里中间那项失败再重试，顺序仍是 a,b,c —— 不跳到队尾', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0, 3), seed('client_b', 1, 3), seed('client_c', 2, 3)]);
    st.markSent('client_a', 'r-a');
    st.markFailed('client_b', 'boom');
    st.retry('client_b');
    expect(entriesOf().map((e) => e.clientId)).toEqual(['client_a', 'client_b', 'client_c']);
  });
});

describe('🔴 spec §五 第 5 问：形态发送前定死，中途删除 / 失败都不改', () => {
  it('取消其中一项后，剩余项的 count 仍是 3（不退化成 2）', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0, 3), seed('client_b', 1, 3), seed('client_c', 2, 3)]);
    st.cancel('client_b');
    const rest = entriesOf();
    expect(rest.map((e) => e.clientId)).toEqual(['client_a', 'client_c']);
    expect(rest.map((e) => e.shape.count)).toEqual([3, 3]);
    // 位次也不重排：c 仍然是 index 2，绝不因为 b 没了就变成 1
    expect(rest.map((e) => e.shape.index)).toEqual([0, 2]);
    expect(rest.every((e) => e.shape.kind === 'album')).toBe(true);
  });

  it('取消到只剩一项时，它仍然是 album 形态（不会退化成 single）', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0, 2), seed('client_b', 1, 2)]);
    st.cancel('client_b');
    const only = entriesOf()[0];
    expect(only.shape.kind).toBe('album');
    expect(only.shape.count).toBe(2);
    expect(only.shape.groupId).toBe('G1');
  });

  it('失败 + 重试全程不动 shape', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0, 2)]);
    const before = entriesOf()[0].shape;
    st.markUploading('client_a', 10);
    st.markFailed('client_a', 'x');
    st.retry('client_a');
    expect(entriesOf()[0].shape).toEqual(before);
  });
});

describe('🔴 spec §五 第 2 问：临时 id ⇒ 真 id，同一条消息只出现一次', () => {
  interface Msg { message_uuid: string; clientId?: string }
  const toMessage = (e: SendingMediaEntry): Msg => ({ message_uuid: e.clientId, clientId: e.clientId });

  it('未确认时乐观条目排在最前（列表 index 0 = 最新）', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0, 2), seed('client_b', 1, 2)]);
    const merged = mergeSendingIntoMessages<Msg>([{ message_uuid: 'old' }], entriesOf(), toMessage);
    // 入队顺序 a,b ⇒ DESC 列表里 b 在更上面
    expect(merged.map((m) => m.message_uuid)).toEqual(['client_b', 'client_a', 'old']);
  });

  it('真实消息到位后，乐观条目不再被渲染 —— 同一 uuid 只存在一条', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0, 2)]);
    st.markSent('client_a', 'real-a');
    const merged = mergeSendingIntoMessages<Msg>([{ message_uuid: 'real-a' }], entriesOf(), toMessage);
    expect(merged.map((m) => m.message_uuid)).toEqual(['real-a']);
    expect(merged.filter((m) => m.message_uuid === 'real-a')).toHaveLength(1);
    // 交叉窗口里 store 里那条还在（先增后减），但画面上没有第二条
    expect(entriesOf()).toHaveLength(1);
  });

  it('真实消息还没到 ⇒ 乐观条目继续显示（不闪：中间没有"两条都不在"的空档）', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0, 2)]);
    st.markSent('client_a', 'real-a');
    const merged = mergeSendingIntoMessages<Msg>([{ message_uuid: 'other' }], entriesOf(), toMessage);
    expect(merged.map((m) => m.message_uuid)).toEqual(['client_a', 'other']);
  });

  it('列表里已存在同 clientId 的消息 ⇒ 不再并第二份', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0, 2)]);
    const merged = mergeSendingIntoMessages<Msg>(
      [{ message_uuid: 'real-a', clientId: 'client_a' }],
      entriesOf(),
      toMessage,
    );
    expect(merged).toHaveLength(1);
  });

  it('pruneConfirmed 只收掉真实消息确已到位的那些', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0, 2), seed('client_b', 1, 2)]);
    st.markSent('client_a', 'real-a');
    st.markSent('client_b', 'real-b');
    st.pruneConfirmed(KEY, new Set(['real-a']));
    expect(entriesOf().map((e) => e.clientId)).toEqual(['client_b']);
  });

  it('pruneConfirmed 不碰还没拿到真 uuid 的条目', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0, 2)]);
    st.pruneConfirmed(KEY, new Set(['whatever']));
    expect(entriesOf()).toHaveLength(1);
  });
});
