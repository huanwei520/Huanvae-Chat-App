/**
 * LocalBadge 组件测试
 *
 * 覆盖：装饰态渲染（✓ 对勾 SVG + 不可点击 + a11y 属性）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LocalBadge } from '../../src/chat/shared/DocumentDownloadAction';

describe('LocalBadge', () => {
  beforeEach(() => {
    cleanup();
  });

  it('渲染为 <span> 装饰态，含 title/aria-label 与对勾 SVG', () => {
    const { container } = render(<LocalBadge />);
    const badge = screen.getByLabelText('已保存到本地');
    expect(badge.tagName).toBe('SPAN');
    expect(badge.getAttribute('title')).toBe('已保存到本地');
    expect(badge).not.toHaveClass('clickable');
    // SVG 对勾（polyline）渲染存在
    const polyline = container.querySelector('svg polyline');
    expect(polyline).not.toBeNull();
  });
});
