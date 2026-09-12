/**
 * fileCacheStore urlCache 过期语义 —— 客户端对 presigned `expires_at` 的**唯一**校验面。
 *
 * 定层位证据（win-restart-filechain ③ 系统时钟偏移）：客户端没有任何「本机时钟 ↔ 服务器时钟」
 * 对账点（全仓 grep 仅 utils/jwt.ts getTokenRemainingMs 拿本机 Date.now() 比对 token exp，用于
 * 刷新调度）。presigned URL 缓存的存废判定 = 本机 `Date.now()` 与服务器下发的 `expires_at` 之差
 * （fileCacheStore.getUrlCache，5 分钟提前失效缓冲）。本块把该语义钉死：
 * - 到期判定完全依赖本机时钟：本机落后 ⇒ 已过服务器有效期的 URL 在客户端侧仍命中缓存（签名失效
 *   403 只能靠 <img> onError → retryWithNewUrl 兜）；
 * - 本机超前 ⇒ 提前失效重取（偏安全方向，多发一次 presigned 请求）。
 * 若未来给 urlCache 加服务器时钟对账（如用 secure_http 响应 Date 头校准），落后场景的断言即反转，
 * 本测试随之改写 —— 它钉的就是「当前无对账」这个事实。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useFileCacheStore } from '../../src/stores/fileCacheStore';

describe('fileCacheStore urlCache 过期语义（本机时钟口径，无服务器时钟对账）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useFileCacheStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('未到期（距 expiresAt > 5min 缓冲）→ 返回缓存', () => {
    vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));
    useFileCacheStore.getState().setUrlCache('u1', 'http://signed/a.jpg?sig=1', '2026-09-01T12:20:00Z');
    expect(useFileCacheStore.getState().getUrlCache('u1')).toMatchObject({
      url: 'http://signed/a.jpg?sig=1',
    });
  });

  it('距 expiresAt ≤ 5min 提前失效并从缓存清除', () => {
    vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));
    useFileCacheStore.getState().setUrlCache('u1', 'http://signed/a.jpg', '2026-09-01T12:20:00Z');
    // 12:16：距到期 4min < 5min 缓冲
    vi.setSystemTime(new Date('2026-09-01T12:16:00Z'));
    expect(useFileCacheStore.getState().getUrlCache('u1')).toBeNull();
    // 且条目已被清掉（非每次现算）
    expect(useFileCacheStore.getState().urlCache['u1']).toBeUndefined();
  });

  it('本机时钟落后：服务器有效期已过的 URL 在客户端侧仍命中缓存（偏移敏感面，无对账）', () => {
    // 本机时钟停在 1970-01-01T00:00:00Z（极端落后）；expires_at 按服务器口径 10 分钟后到期。
    // 真实世界里该 URL 早已失效，但本机时钟没追上 ⇒ 判定仍"有效"。这就是时钟偏移假设里
    // 「客户端唯一 expires_at 校验面完全信任本机时钟」的机器可验证表达。
    vi.setSystemTime(0);
    useFileCacheStore.getState().setUrlCache('u1', 'http://signed/a.jpg', '1970-01-01T00:10:00Z');
    expect(useFileCacheStore.getState().getUrlCache('u1')).not.toBeNull();
  });

  it('本机时钟超前：未到服务器有效期的 URL 被提前判废（偏安全方向，代价是多取一次 presigned）', () => {
    vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));
    useFileCacheStore.getState().setUrlCache('u1', 'http://signed/a.jpg', '2026-09-01T12:30:00Z');
    // 本机跳前 30min（重启后 RTC 漂移/手动改时），远超 expires_at + 缓冲
    vi.setSystemTime(new Date('2026-09-01T12:30:01Z'));
    expect(useFileCacheStore.getState().getUrlCache('u1')).toBeNull();
  });
});
