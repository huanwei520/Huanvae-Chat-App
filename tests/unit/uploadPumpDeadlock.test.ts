/**
 * 待发区上传泵：切会话后不再死锁（外部审计 idx=92 回归）
 *
 * 病灶（本轮修复前）：
 *   `pumpingRef` 是**单个 hook 实例**的串行闸，而泵只捞**当前会话**的 pending。
 *   桌面端 `ChatPanel` 带 `key={chatKey}` 会整棵重挂、ref 归零，掩盖了这个洞；
 *   移动端 `MobileChatView` 是常量 `key="chat-view"`、`ChatInputArea` 也没有 key
 *   ⇒ 切会话时 hook 实例存活、`pumpingRef` 保持 true：
 *     A 排队上传（泵在跑）→ 切到 B → 在 B 排队 → pendingCount 0→N 触发 effect
 *     → pump() 撞上 pumpingRef=true 直接 return → A 跑完把 ref 置回 false，
 *     但 B 的 pendingCount 不再变化、pump 引用也没变 ⇒ effect 不重跑
 *     ⇒ B 的媒体永远停在 pending，既不完成也不失败，也没有任何超时或错误态。
 *
 * ① 行为测试：真调 `pickNextPendingUpload` / `countPendingUploads`（跨会话语义本身）。
 * ② 接线扫描：泵必须用它们、必须有 rerun 闸、且不得再按 conversationKey 捞。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  pickNextPendingUpload,
  countPendingUploads,
  type SendingMediaEntry,
} from '../../src/stores/sendingMediaStore';

const OUTBOX_SRC = readFileSync(
  resolve(__dirname, '../../src/chat/shared/useComposerTrayOutbox.ts'),
  'utf-8',
);

function entry(
  clientId: string,
  conversationKey: string,
  status: SendingMediaEntry['status'],
): SendingMediaEntry {
  return {
    clientId,
    conversationKey,
    conversationType: 'friend',
    targetId: 'friend-1',
    file: new File(['x'], `${clientId}.png`, { type: 'image/png' }),
    shape: { kind: 'single', groupId: null, index: null, count: null },
    preview: {
      name: `${clientId}.png`,
      kind: 'image',
      size: 1,
      localPath: null,
      width: null,
      height: null,
      previewUrl: null,
    },
    caption: undefined,
    replyTo: undefined,
    sendTime: '2026-01-01T00:00:00Z',
    status,
    percent: 0,
    error: undefined,
    realUuid: null,
  } as unknown as SendingMediaEntry;
}

function stateOf(...rows: Array<[string, string, SendingMediaEntry['status']]>) {
  const entries: Record<string, SendingMediaEntry> = {};
  const orderByConversation: Record<string, string[]> = {};
  for (const [id, key, status] of rows) {
    entries[id] = entry(id, key, status);
    orderByConversation[key] = [...(orderByConversation[key] ?? []), id];
  }
  return { entries, orderByConversation };
}

describe('① 跨会话取件语义', () => {
  it('🔴 会话 A 全部传完后，泵仍能捞到会话 B 的 pending（修前 B 永远停在 pending）', () => {
    const state = stateOf(
      ['a1', 'friend:A', 'done'],
      ['b1', 'friend:B', 'pending'],
    );
    expect(pickNextPendingUpload(state)?.clientId).toBe('b1');
  });

  it('同一会话内按入队顺序取（先入先出）', () => {
    const state = stateOf(
      ['a1', 'friend:A', 'pending'],
      ['a2', 'friend:A', 'pending'],
    );
    expect(pickNextPendingUpload(state)?.clientId).toBe('a1');
  });

  it('跨会话时按会话插入序取（确定性，不看当前打开的是哪个会话）', () => {
    const state = stateOf(
      ['a1', 'friend:A', 'pending'],
      ['b1', 'friend:B', 'pending'],
    );
    expect(pickNextPendingUpload(state)?.clientId).toBe('a1');
  });

  it('只认 pending：uploading / failed / done 一律跳过', () => {
    const state = stateOf(
      ['a1', 'friend:A', 'uploading'],
      ['a2', 'friend:A', 'failed'],
      ['a3', 'friend:A', 'done'],
    );
    expect(pickNextPendingUpload(state)).toBeNull();
  });

  it('全空 ⇒ null', () => {
    expect(pickNextPendingUpload({ entries: {}, orderByConversation: {} })).toBeNull();
  });

  it('countPendingUploads 也跨会话计数（唤醒信号必须跟取件面一致）', () => {
    const state = stateOf(
      ['a1', 'friend:A', 'pending'],
      ['b1', 'friend:B', 'pending'],
      ['b2', 'friend:B', 'uploading'],
    );
    expect(countPendingUploads(state)).toBe(2);
  });
});

describe('② 泵的接线（静态扫描）', () => {
  it('泵用全局取件 + 全局计数，不再按 conversationKey 捞', () => {
    expect(OUTBOX_SRC).toMatch(/pickNextPendingUpload\(useSendingMediaStore\.getState\(\)\)/);
    expect(OUTBOX_SRC).toMatch(/useSendingMediaStore\(countPendingUploads\)/);
    // 修前的形态：从 orderByConversation[conversationKey] 里挑
    expect(OUTBOX_SRC).not.toMatch(/state\.orderByConversation\[conversationKey\]/);
    expect(OUTBOX_SRC).not.toMatch(/s\.orderByConversation\[conversationKey\]/);
  });

  it('pump 不依赖 conversationKey（依赖了就会在切会话时重建引用，掩盖问题）', () => {
    const block = OUTBOX_SRC.match(/const pump = useCallback[\s\S]*?\}, \[[^\]]*\]\);/);
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/\}, \[uploadOne\]\);/);
  });

  it('有 rerun 闸：泵运行期间被唤醒会记一笔，跑完再扫一轮', () => {
    expect(OUTBOX_SRC).toMatch(/rerunRef\.current = true;/);
    expect(OUTBOX_SRC).toMatch(/\} while \(rerunRef\.current\);/);
  });
});
