/**
 * LoadingSpinner 组件测试
 *
 * 测试加载动画组件的渲染
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '../utils/test-utils';
import { LoadingSpinner } from '../../src/components/common/LoadingSpinner';

describe('LoadingSpinner', () => {
  it('渲染加载动画符号', () => {
    render(<LoadingSpinner />);

    // 检查旋转符号渲染
    expect(screen.getByText('⟳')).toBeInTheDocument();
  });

  it('渲染为 span 元素', () => {
    const { container } = render(<LoadingSpinner />);

    const span = container.querySelector('span');
    expect(span).toBeInTheDocument();
  });

  it('应用内联样式', () => {
    const { container } = render(<LoadingSpinner />);

    const span = container.querySelector('span');
    expect(span).toHaveStyle({ display: 'inline-block' });
  });
});
