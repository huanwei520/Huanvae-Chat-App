/**
 * chatStore D6 群内屏蔽 action 单测
 *
 * 验证：
 * 1. setGroupMessageBlocks 全量写入某群屏蔽集 + 按群 key 隔离
 * 2. setGroupMemberBlocked(true) 增量加入（已存在不重复）
 * 3. setGroupMemberBlocked(false) 移除（不存在时是 no-op）
 * 4. 不同群互不影响
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../../src/stores/chatStore';

describe('chatStore D6 群内屏蔽', () => {
  beforeEach(() => {
    // 重置屏蔽集，隔离测试
    useChatStore.setState({ groupMessageBlocks: {} });
  });

  it('setGroupMessageBlocks 全量写入并按群隔离', () => {
    useChatStore.getState().setGroupMessageBlocks('g1', ['u1', 'u2']);
    useChatStore.getState().setGroupMessageBlocks('g2', ['u3']);
    expect(useChatStore.getState().groupMessageBlocks['g1']).toEqual(['u1', 'u2']);
    expect(useChatStore.getState().groupMessageBlocks['g2']).toEqual(['u3']);
  });

  it('setGroupMessageBlocks 再次写入同群覆盖旧集合', () => {
    useChatStore.getState().setGroupMessageBlocks('g1', ['u1', 'u2']);
    useChatStore.getState().setGroupMessageBlocks('g1', ['u9']);
    expect(useChatStore.getState().groupMessageBlocks['g1']).toEqual(['u9']);
  });

  it('setGroupMemberBlocked(true) 把成员加入该群屏蔽集', () => {
    useChatStore.getState().setGroupMemberBlocked('g1', 'u1', true);
    expect(useChatStore.getState().groupMessageBlocks['g1']).toEqual(['u1']);
  });

  it('setGroupMemberBlocked(true) 对已屏蔽成员幂等（不重复加入）', () => {
    useChatStore.getState().setGroupMessageBlocks('g1', ['u1']);
    useChatStore.getState().setGroupMemberBlocked('g1', 'u1', true);
    expect(useChatStore.getState().groupMessageBlocks['g1']).toEqual(['u1']);
  });

  it('setGroupMemberBlocked(false) 从屏蔽集移除该成员', () => {
    useChatStore.getState().setGroupMessageBlocks('g1', ['u1', 'u2']);
    useChatStore.getState().setGroupMemberBlocked('g1', 'u1', false);
    expect(useChatStore.getState().groupMessageBlocks['g1']).toEqual(['u2']);
  });

  it('setGroupMemberBlocked(false) 对未屏蔽成员是 no-op', () => {
    useChatStore.getState().setGroupMessageBlocks('g1', ['u2']);
    useChatStore.getState().setGroupMemberBlocked('g1', 'u1', false);
    expect(useChatStore.getState().groupMessageBlocks['g1']).toEqual(['u2']);
  });

  it('setGroupMemberBlocked 只影响目标群，其它群不变', () => {
    useChatStore.getState().setGroupMessageBlocks('g1', ['u1']);
    useChatStore.getState().setGroupMessageBlocks('g2', ['u1']);
    useChatStore.getState().setGroupMemberBlocked('g1', 'u1', false);
    expect(useChatStore.getState().groupMessageBlocks['g1']).toEqual([]);
    expect(useChatStore.getState().groupMessageBlocks['g2']).toEqual(['u1']);
  });
});
