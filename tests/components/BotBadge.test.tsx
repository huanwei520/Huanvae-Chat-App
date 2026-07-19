/**
 * BotBadge 统一 Bot 徽章测试
 *
 * 覆盖：
 * - 渲染文本 "Bot" + className .bot-badge
 * - 颜色引用 variables.css 静态 token（--bot-badge-bg / --bot-badge-text），
 *   防止回退成硬编码 rgba/hex（token 是本次统一改造的核心契约）
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BotBadge } from '../../src/components/common/BotBadge';

describe('BotBadge', () => {
  it('渲染 "Bot" 文本与 .bot-badge className', () => {
    const { container } = render(<BotBadge />);
    const badge = container.querySelector('.bot-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('Bot');
  });

  it('颜色引用 --bot-badge-* token（非硬编码色值）', () => {
    const { container } = render(<BotBadge />);
    const badge = container.querySelector('.bot-badge') as HTMLSpanElement;
    expect(badge.style.background).toContain('var(--bot-badge-bg)');
    expect(badge.style.color).toBe('var(--bot-badge-text)');
    // 尺寸字段与原内联实现一致（观感不变契约）
    expect(badge.style.fontSize).toBe('10px');
    expect(badge.style.padding).toBe('1px 4px');
  });
});
