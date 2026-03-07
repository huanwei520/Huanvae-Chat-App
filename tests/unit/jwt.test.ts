/**
 * JWT 工具函数单元测试
 *
 * 测试 src/utils/jwt.ts 中的 getTokenExpiresAt / getTokenRemainingMs
 *
 * 包含测试：
 * - 有效 JWT：正确提取 exp 并转为毫秒级时间戳
 * - 无 exp 字段：返回 null
 * - 格式无效：不足 3 段、非 base64、非 JSON 均返回 null
 * - 空字符串：返回 null
 * - getTokenRemainingMs：未过期返回正数，已过期返回 0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTokenExpiresAt, getTokenRemainingMs } from '../../src/utils/jwt';

/**
 * 构造一个模拟 JWT（仅含 payload，header/signature 为占位）
 */
function createMockJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const signature = 'mock-signature';
  return `${header}.${body}.${signature}`;
}

describe('JWT 工具函数 (utils/jwt)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================
  // getTokenExpiresAt
  // ============================================

  describe('getTokenExpiresAt', () => {
    it('应从有效 JWT 中提取 exp 并返回毫秒级时间戳', () => {
      const expSeconds = 1700000000;
      const token = createMockJwt({ exp: expSeconds, sub: 'user-1' });

      expect(getTokenExpiresAt(token)).toBe(expSeconds * 1000);
    });

    it('exp 为 0 时应返回 0（作为有效时间戳）', () => {
      const token = createMockJwt({ exp: 0 });
      expect(getTokenExpiresAt(token)).toBe(0);
    });

    it('无 exp 字段应返回 null', () => {
      const token = createMockJwt({ sub: 'user-1', iat: 1700000000 });
      expect(getTokenExpiresAt(token)).toBeNull();
    });

    it('exp 为字符串应返回 null', () => {
      const token = createMockJwt({ exp: '1700000000' });
      expect(getTokenExpiresAt(token)).toBeNull();
    });

    it('格式不足 3 段应返回 null', () => {
      expect(getTokenExpiresAt('only-two.parts')).toBeNull();
      expect(getTokenExpiresAt('single')).toBeNull();
    });

    it('payload 非有效 base64 应返回 null', () => {
      expect(getTokenExpiresAt('header.!!!invalid!!!.signature')).toBeNull();
    });

    it('payload 非有效 JSON 应返回 null', () => {
      const notJson = btoa('this is not json');
      expect(getTokenExpiresAt(`header.${notJson}.signature`)).toBeNull();
    });

    it('空字符串应返回 null', () => {
      expect(getTokenExpiresAt('')).toBeNull();
    });
  });

  // ============================================
  // getTokenRemainingMs
  // ============================================

  describe('getTokenRemainingMs', () => {
    it('Token 未过期时应返回正数', () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 小时后
      const token = createMockJwt({ exp: futureExp });

      const remaining = getTokenRemainingMs(token);
      expect(remaining).not.toBeNull();
      expect(remaining!).toBeGreaterThan(0);
      expect(remaining!).toBeLessThanOrEqual(3600 * 1000);
    });

    it('Token 已过期应返回 0', () => {
      const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 小时前
      const token = createMockJwt({ exp: pastExp });

      expect(getTokenRemainingMs(token)).toBe(0);
    });

    it('无效 Token 应返回 null', () => {
      expect(getTokenRemainingMs('invalid')).toBeNull();
    });

    it('剩余时间精度在合理范围内（±2 秒）', () => {
      const secondsFromNow = 600; // 10 分钟后
      const futureExp = Math.floor(Date.now() / 1000) + secondsFromNow;
      const token = createMockJwt({ exp: futureExp });

      const remaining = getTokenRemainingMs(token)!;
      const expectedMs = secondsFromNow * 1000;

      expect(Math.abs(remaining - expectedMs)).toBeLessThan(2000);
    });
  });
});
