/**
 * friendDisplayName 纯函数单元测试
 *
 * 私聊好友显示名优先级：备注 > 昵称 > friend_id（空白视为未设置）
 */

import { describe, it, expect } from 'vitest';
import { friendDisplayName } from '../../src/utils/friendName';

describe('friendDisplayName', () => {
  it('有备注时优先用备注', () => {
    expect(friendDisplayName({ friend_id: 'u1', friend_nickname: '阿强', friend_remark: '老王' })).toBe('老王');
  });

  it('备注为纯空白时回退到昵称', () => {
    expect(friendDisplayName({ friend_id: 'u1', friend_nickname: '阿强', friend_remark: '   ' })).toBe('阿强');
  });

  it('无备注（null）时用昵称', () => {
    expect(friendDisplayName({ friend_id: 'u1', friend_nickname: '阿强', friend_remark: null })).toBe('阿强');
  });

  it('无备注无昵称时回退到 friend_id', () => {
    expect(friendDisplayName({ friend_id: 'u1', friend_nickname: null, friend_remark: null })).toBe('u1');
  });

  it('昵称为纯空白也回退到 friend_id', () => {
    expect(friendDisplayName({ friend_id: 'u1', friend_nickname: '  ', friend_remark: null })).toBe('u1');
  });

  it('备注两端空白被裁剪', () => {
    expect(friendDisplayName({ friend_id: 'u1', friend_nickname: '阿强', friend_remark: '  老王  ' })).toBe('老王');
  });
});
