/**
 * JWT 工具函数
 *
 * 解码 JWT payload 提取过期时间，用于主动刷新机制：
 * 在 Token 过期前 5 分钟自动触发刷新，避免因 Token 过期导致请求失败。
 */

/**
 * 从 JWT Token 中提取过期时间戳
 *
 * @param token - JWT access_token（格式：header.payload.signature）
 * @returns 过期时间的毫秒级时间戳，解析失败返回 null
 */
export function getTokenExpiresAt(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) { return null; }

    const payload = JSON.parse(atob(parts[1]));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * 计算 Token 距离过期还剩多少毫秒
 *
 * @param token - JWT access_token
 * @returns 剩余毫秒数，已过期返回 0，解析失败返回 null
 */
export function getTokenRemainingMs(token: string): number | null {
  const expiresAt = getTokenExpiresAt(token);
  if (expiresAt === null) { return null; }
  return Math.max(0, expiresAt - Date.now());
}
