/**
 * chatStore D7 群内私有备注 action 单测
 *
 * 验证：
 * 1. setGroupMemberRemarks 从列表建映射 + 按群隔离
 * 2. setGroupMemberRemark 设置/更新（upsert）单条
 * 3. setGroupMemberRemark 空串/null 清除单条
 * 4. trim 处理（两端空白裁剪；纯空白视为清除）
 * 5. 不同群互不影响
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../../src/stores/chatStore';

describe('chatStore D7 群内私有备注', () => {
  beforeEach(() => {
    useChatStore.setState({ groupMemberRemarks: {} });
  });

  it('setGroupMemberRemarks 从列表建映射并按群隔离', () => {
    useChatStore.getState().setGroupMemberRemarks('g1', [
      { user_id: 'u1', remark: '小王' },
      { user_id: 'u2', remark: '老李' },
    ]);
    useChatStore.getState().setGroupMemberRemarks('g2', [{ user_id: 'u1', remark: '群2备注' }]);
    expect(useChatStore.getState().groupMemberRemarks['g1']).toEqual({ u1: '小王', u2: '老李' });
    expect(useChatStore.getState().groupMemberRemarks['g2']).toEqual({ u1: '群2备注' });
  });

  it('setGroupMemberRemark 设置 + upsert 更新', () => {
    useChatStore.getState().setGroupMemberRemark('g1', 'u1', '小王');
    expect(useChatStore.getState().groupMemberRemarks['g1']).toEqual({ u1: '小王' });
    useChatStore.getState().setGroupMemberRemark('g1', 'u1', '老王');
    expect(useChatStore.getState().groupMemberRemarks['g1']).toEqual({ u1: '老王' });
  });

  it('setGroupMemberRemark 空串/null 清除该成员备注', () => {
    useChatStore.getState().setGroupMemberRemarks('g1', [
      { user_id: 'u1', remark: '小王' },
      { user_id: 'u2', remark: '老李' },
    ]);
    useChatStore.getState().setGroupMemberRemark('g1', 'u1', '');
    expect(useChatStore.getState().groupMemberRemarks['g1']).toEqual({ u2: '老李' });
    useChatStore.getState().setGroupMemberRemark('g1', 'u2', null);
    expect(useChatStore.getState().groupMemberRemarks['g1']).toEqual({});
  });

  it('setGroupMemberRemark 裁剪两端空白；纯空白视为清除', () => {
    useChatStore.getState().setGroupMemberRemark('g1', 'u1', '  小王  ');
    expect(useChatStore.getState().groupMemberRemarks['g1']).toEqual({ u1: '小王' });
    useChatStore.getState().setGroupMemberRemark('g1', 'u1', '   ');
    expect(useChatStore.getState().groupMemberRemarks['g1']).toEqual({});
  });

  it('setGroupMemberRemark 只影响目标群', () => {
    useChatStore.getState().setGroupMemberRemark('g1', 'u1', 'A');
    useChatStore.getState().setGroupMemberRemark('g2', 'u1', 'B');
    useChatStore.getState().setGroupMemberRemark('g1', 'u1', null);
    expect(useChatStore.getState().groupMemberRemarks['g1']).toEqual({});
    expect(useChatStore.getState().groupMemberRemarks['g2']).toEqual({ u1: 'B' });
  });
});
