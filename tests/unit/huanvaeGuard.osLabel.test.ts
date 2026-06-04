/**
 * osLabel 纯函数测试
 *
 * 输入：@tauri-apps/plugin-os 的 platform() 原子值
 * 输出：设备注册上报用的 os 展示名（'Windows' / 'macOS' / 'Linux' / 原值 / 'Unknown'）
 */

import { describe, it, expect } from 'vitest';
import { osLabel } from '../../src/huanvaeGuard/format';

describe('osLabel', () => {
  it('maps known desktop platforms to display names', () => {
    expect(osLabel('windows')).toBe('Windows');
    expect(osLabel('macos')).toBe('macOS');
    expect(osLabel('linux')).toBe('Linux');
  });

  it('passes through an unknown non-empty platform verbatim', () => {
    expect(osLabel('android')).toBe('android');
    expect(osLabel('ios')).toBe('ios');
  });

  it('returns "Unknown" for an empty platform (init / platform() 取值失败)', () => {
    expect(osLabel('')).toBe('Unknown');
  });
});
