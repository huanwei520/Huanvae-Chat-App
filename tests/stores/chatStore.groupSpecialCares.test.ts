/**
 * chatStore M3 群内特别关心 action 单测
 *
 * 验证：
 * 1. setGroupSpecialCares 全量写入某群关心集 + 按群 key 隔离
 * 2. setGroupMemberSpecialCare(true) 增量加入（已存在不重复）
 * 3. setGroupMemberSpecialCare(false) 移除（不存在时是 no-op）
 * 4. 不同群互不影响
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../../src/stores/chatStore';

describe('chatStore M3 群内特别关心', () => {
  beforeEach(() => {
    useChatStore.setState({ groupSpecialCares: {} });
  });

  it('setGroupSpecialCares 全量写入并按群隔离', () => {
    useChatStore.getState().setGroupSpecialCares('g1', ['u1', 'u2']);
    useChatStore.getState().setGroupSpecialCares('g2', ['u3']);
    expect(useChatStore.getState().groupSpecialCares['g1']).toEqual(['u1', 'u2']);
    expect(useChatStore.getState().groupSpecialCares['g2']).toEqual(['u3']);
  });

  it('setGroupSpecialCares 再次写入同群覆盖旧集合', () => {
    useChatStore.getState().setGroupSpecialCares('g1', ['u1', 'u2']);
    useChatStore.getState().setGroupSpecialCares('g1', ['u9']);
    expect(useChatStore.getState().groupSpecialCares['g1']).toEqual(['u9']);
  });

  it('setGroupMemberSpecialCare(true) 把成员加入该群关心集', () => {
    useChatStore.getState().setGroupMemberSpecialCare('g1', 'u1', true);
    expect(useChatStore.getState().groupSpecialCares['g1']).toEqual(['u1']);
  });

  it('setGroupMemberSpecialCare(true) 对已关心成员幂等（不重复加入）', () => {
    useChatStore.getState().setGroupSpecialCares('g1', ['u1']);
    useChatStore.getState().setGroupMemberSpecialCare('g1', 'u1', true);
    expect(useChatStore.getState().groupSpecialCares['g1']).toEqual(['u1']);
  });

  it('setGroupMemberSpecialCare(false) 从关心集移除该成员', () => {
    useChatStore.getState().setGroupSpecialCares('g1', ['u1', 'u2']);
    useChatStore.getState().setGroupMemberSpecialCare('g1', 'u1', false);
    expect(useChatStore.getState().groupSpecialCares['g1']).toEqual(['u2']);
  });

  it('setGroupMemberSpecialCare(false) 对未关心成员是 no-op', () => {
    useChatStore.getState().setGroupSpecialCares('g1', ['u2']);
    useChatStore.getState().setGroupMemberSpecialCare('g1', 'u1', false);
    expect(useChatStore.getState().groupSpecialCares['g1']).toEqual(['u2']);
  });

  it('setGroupMemberSpecialCare 只影响目标群，其它群不变', () => {
    useChatStore.getState().setGroupSpecialCares('g1', ['u1']);
    useChatStore.getState().setGroupSpecialCares('g2', ['u1']);
    useChatStore.getState().setGroupMemberSpecialCare('g1', 'u1', false);
    expect(useChatStore.getState().groupSpecialCares['g1']).toEqual([]);
    expect(useChatStore.getState().groupSpecialCares['g2']).toEqual(['u1']);
  });
});
