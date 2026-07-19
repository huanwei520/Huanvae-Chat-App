/**
 * AIAvatar 组件测试
 *
 * 验证：
 * - 正确渲染 "AI" 文字
 * - 使用白色背景和蓝色渐变文字（颜色引用 --ai-avatar-* 静态 token）
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '../utils/test-utils';
import { AIAvatar } from '../../src/components/common/AIAvatar';

describe('AIAvatar', () => {
  it('渲染 "AI" 文字', () => {
    render(<AIAvatar />);
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('外层容器为白色圆形（背景引用 --ai-avatar-bg token）', () => {
    const { container } = render(<AIAvatar />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveStyle({ borderRadius: '50%' });
    expect(wrapper.style.background).toContain('var(--ai-avatar-bg)');
  });

  it('文字使用渐变样式', () => {
    render(<AIAvatar />);
    const text = screen.getByText('AI');
    expect(text).toHaveStyle({ fontWeight: 800 });
  });
});
