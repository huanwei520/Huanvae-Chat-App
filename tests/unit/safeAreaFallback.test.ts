/**
 * safeAreaFallback.resolveSafeAreaFallback 纯决策单测
 *
 * 规则：仅当「移动端 且 env 上下安全区同时为 0」（= 老旧 WebView 不报安全区）才注入固定值；
 * 手机 env 生效(上/下非 0)、桌面非移动端 → 不注入(返回 null)。
 */
import { describe, it, expect } from 'vitest';
import {
  resolveSafeAreaFallback,
  FALLBACK_INSET_TOP,
  FALLBACK_INSET_BOTTOM,
} from '../../src/utils/safeAreaFallback';

describe('resolveSafeAreaFallback', () => {
  it('移动端 + 上下同时为 0(破 WebView) → 注入固定值', () => {
    expect(resolveSafeAreaFallback(0, 0, true)).toEqual({
      top: FALLBACK_INSET_TOP,
      bottom: FALLBACK_INSET_BOTTOM,
    });
  });

  it('非移动端(桌面)即使上下为 0 → 不注入', () => {
    expect(resolveSafeAreaFallback(0, 0, false)).toBeNull();
  });

  it('移动端但 env 生效(上下非 0,如手机) → 不注入,沿用 env', () => {
    expect(resolveSafeAreaFallback(44, 34, true)).toBeNull();
  });

  it('仅其一为 0(非"同时为 0") → 不注入', () => {
    expect(resolveSafeAreaFallback(44, 0, true)).toBeNull();
    expect(resolveSafeAreaFallback(0, 48, true)).toBeNull();
  });
});
