/**
 * 发送者昵称统一解析 helper 单测（D4 昵称混显收口）
 *
 * 覆盖 src/utils/senderName.ts 的三条契约：
 * - resolveSenderName（写入侧）：服务端昵称优先 → 本地资料昵称回退 → 空值；
 *   三条消息写入路径（historyService / syncService / wsHandlers）一律经它落库。
 * - profileDisplayName：本地资料折显示名，备注 → 昵称，**绝不回退 ID**。
 * - displaySenderName（显示侧）：落库昵称 → 资料昵称 → 兜底「未知用户」；
 *   永不返回空串、永不返回 sender_id（存量空 sender_name 行的读取层收口）。
 */

import { describe, it, expect } from 'vitest';
import {
  UNKNOWN_SENDER_NAME,
  resolveSenderName,
  profileDisplayName,
  displaySenderName,
} from '../../src/utils/senderName';

describe('resolveSenderName（写入侧唯一收口）', () => {
  it('服务端昵称非空 → 原样采用，资料不覆盖', () => {
    expect(resolveSenderName('张三', '李四')).toBe('张三');
    expect(resolveSenderName('张三', null)).toBe('张三');
    expect(resolveSenderName('张三', undefined)).toBe('张三');
  });

  it('服务端昵称缺失/空串/纯空白 → 回退资料昵称', () => {
    expect(resolveSenderName(null, '李四')).toBe('李四');
    expect(resolveSenderName(undefined, '李四')).toBe('李四');
    expect(resolveSenderName('', '李四')).toBe('李四');
    expect(resolveSenderName('   ', '李四')).toBe('李四');
  });

  it('两路都缺席 → null（与既有「回退空值」行为一致，显示层再兜底）', () => {
    expect(resolveSenderName(null, null)).toBeNull();
    expect(resolveSenderName('', undefined)).toBeNull();
    expect(resolveSenderName('   ', '   ')).toBeNull();
  });

  it('两端都 trim：昵称带首尾空白时落库为 trim 后的值', () => {
    expect(resolveSenderName(' 张三 ', null)).toBe('张三');
    expect(resolveSenderName(null, ' 李四 ')).toBe('李四');
  });
});

describe('profileDisplayName（资料折显示名，绝不回退 ID）', () => {
  it('备注优先于昵称', () => {
    expect(profileDisplayName('老李', '李四')).toBe('老李');
  });

  it('无备注 → 昵称；空白备注视为未设置', () => {
    expect(profileDisplayName(null, '李四')).toBe('李四');
    expect(profileDisplayName('   ', '李四')).toBe('李四');
  });

  it('都缺席 → null（ID 兜底交由 displaySenderName 的「未知用户」终点）', () => {
    expect(profileDisplayName(null, null)).toBeNull();
    expect(profileDisplayName('', '   ')).toBeNull();
  });
});

describe('displaySenderName（显示侧唯一收口）', () => {
  it('落库名非空 → 原样展示', () => {
    expect(displaySenderName('张三')).toBe('张三');
    expect(displaySenderName('张三', '李四')).toBe('张三');
  });

  it('落库名为空 → 资料昵称回退', () => {
    expect(displaySenderName(null, '李四')).toBe('李四');
    expect(displaySenderName('', ' 李四 ')).toBe('李四');
  });

  it('都缺席 → 兜底文案「未知用户」，绝不裸露 sender_id', () => {
    expect(displaySenderName(null, null)).toBe(UNKNOWN_SENDER_NAME);
    expect(displaySenderName('', undefined)).toBe(UNKNOWN_SENDER_NAME);
    expect(UNKNOWN_SENDER_NAME).toBe('未知用户');
  });
});
