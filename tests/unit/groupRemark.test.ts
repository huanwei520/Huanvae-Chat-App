/**
 * groupMemberDisplayName 单测（D7 群内私有备注显示名优先级）
 */

import { describe, it, expect } from 'vitest';
import { groupMemberDisplayName } from '../../src/utils/groupRemark';

describe('groupMemberDisplayName', () => {
  it('有备注时优先用备注', () => {
    expect(groupMemberDisplayName('备注名', '群昵称')).toBe('备注名');
  });

  it('无备注时回退到 fallback', () => {
    expect(groupMemberDisplayName(undefined, '群昵称')).toBe('群昵称');
  });

  it('空串/纯空白备注按无备注处理', () => {
    expect(groupMemberDisplayName('', '群昵称')).toBe('群昵称');
    expect(groupMemberDisplayName('   ', '群昵称')).toBe('群昵称');
  });

  it('备注两端空白被裁剪', () => {
    expect(groupMemberDisplayName('  小王  ', '群昵称')).toBe('小王');
  });
});
