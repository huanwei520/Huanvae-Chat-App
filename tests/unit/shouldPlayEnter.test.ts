/**
 * shouldPlayEnter 单元测试
 *
 * 决定消息是否播放"入场滑入"动画的纯函数（chat/shared/animations.ts）。
 * 契约：仅"挂载后新增"（不在挂载 key 快照内）且带 clientId（自己发 / WS 实时收到）的消息才演。
 * - 切换/打开会话时已有的历史（在快照内）→ 不演 → 整体走面板渐变、无逐条并拢；
 * - loadMore 拉来的 DB 历史（无 clientId）→ 不演；
 * - 聊天中实时到达的新消息（带 clientId、不在快照内）→ 演滑入。
 */

import { describe, it, expect } from 'vitest';
import { shouldPlayEnter } from '../../src/chat/shared/animations';

describe('shouldPlayEnter', () => {
  it('带 clientId 且不在挂载快照内（实时新消息）→ true', () => {
    const mounted = new Set(['client_old', 'uuid_a']);
    expect(shouldPlayEnter('client_new', 'client_new', mounted)).toBe(true);
    // WS 实时收到的（ws_<uuid>）同理
    expect(shouldPlayEnter('ws_xyz', 'ws_xyz', mounted)).toBe(true);
  });

  it('带 clientId 但在挂载快照内（打开/切换时已有的历史）→ false（不并拢）', () => {
    const mounted = new Set(['client_self_history', 'uuid_a']);
    expect(shouldPlayEnter('client_self_history', 'client_self_history', mounted)).toBe(false);
  });

  it('无 clientId（loadMore 拉来的 DB 历史）→ false', () => {
    const mounted = new Set(['uuid_a']);
    // 不在快照内但没有 clientId（DB 历史不带 clientId）→ 不演，避免向上翻历史时并拢
    expect(shouldPlayEnter(undefined, 'uuid_older', mounted)).toBe(false);
  });

  it('挂载快照尚未捕获（null）→ false（首帧/空帧不演）', () => {
    expect(shouldPlayEnter('client_new', 'client_new', null)).toBe(false);
  });

  it('clientId 为空串 → false（!!"" 为 false）', () => {
    const mounted = new Set(['uuid_a']);
    expect(shouldPlayEnter('', 'uuid_b', mounted)).toBe(false);
  });
});
