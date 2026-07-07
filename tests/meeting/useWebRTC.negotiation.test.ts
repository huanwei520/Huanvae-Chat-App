/**
 * Perfect-negotiation 极性 / 冲突判定单元测试（src/meeting/webrtcCore.ts）
 *
 * 覆盖：
 * - computePolarity：每对 peer 恰一极（id 大者 polite）
 * - shouldIgnoreOffer：polite 从不 ignore；impolite 仅在 collision 时 ignore
 */

import { describe, it, expect } from 'vitest';
import { computePolarity, shouldIgnoreOffer } from '../../src/meeting/webrtcCore';

describe('computePolarity', () => {
  it('id 大者 polite、小者 impolite', () => {
    // p_aaa < p_bbb（字典序）
    expect(computePolarity('p_aaa', 'p_bbb')).toEqual({ polite: false }); // 小者 impolite
    expect(computePolarity('p_bbb', 'p_aaa')).toEqual({ polite: true }); // 大者 polite
  });

  it('每对 (A,B) 恰好一方 polite 一方 impolite', () => {
    const a = 'p_111';
    const b = 'p_999';
    const aPolite = computePolarity(a, b).polite;
    const bPolite = computePolarity(b, a).polite;
    // 恰一极：布尔求和必为 1
    expect(Number(aPolite) + Number(bPolite)).toBe(1);
    // 具体方向
    expect(aPolite).toBe(false);
    expect(bPolite).toBe(true);
  });
});

describe('shouldIgnoreOffer', () => {
  it('polite 侧从不 ignore（无论是否冲突）', () => {
    expect(shouldIgnoreOffer(true, true, 'have-local-offer', false)).toBe(false);
    expect(shouldIgnoreOffer(true, false, 'stable', false)).toBe(false);
    expect(shouldIgnoreOffer(true, true, 'have-remote-offer', false)).toBe(false);
  });

  it('impolite 侧无冲突（stable 且未在协商）时不 ignore', () => {
    expect(shouldIgnoreOffer(false, false, 'stable', false)).toBe(false);
  });

  it('impolite 侧正在发 offer（makingOffer）时 ignore', () => {
    expect(shouldIgnoreOffer(false, true, 'stable', false)).toBe(true);
  });

  it('impolite 侧非 stable 且未在 setRemoteAnswer 时 ignore', () => {
    expect(shouldIgnoreOffer(false, false, 'have-local-offer', false)).toBe(true);
  });

  it('impolite 侧正在 setRemoteAnswer（视为 ready）时不 ignore', () => {
    // isSettingRemoteAnswerPending=true → readyForOffer 成立 → 不 ignore
    expect(shouldIgnoreOffer(false, false, 'have-local-offer', true)).toBe(false);
  });
});
