/**
 * ReadReceiptLabel 组件测试
 *
 * 已读回执小标签，纯展示：渲染传入的文本（私聊"已读/未读"、群聊"N 人已读"）。
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReadReceiptLabel } from '../../src/chat/shared/ReadReceiptLabel';

describe('ReadReceiptLabel', () => {
  it('渲染"已读"文本', () => {
    render(<ReadReceiptLabel text="已读" />);
    expect(screen.getByText('已读')).toBeInTheDocument();
  });

  it('渲染"未读"文本', () => {
    render(<ReadReceiptLabel text="未读" />);
    expect(screen.getByText('未读')).toBeInTheDocument();
  });

  it('渲染群聊"N 人已读"文本', () => {
    render(<ReadReceiptLabel text="3 人已读" />);
    expect(screen.getByText('3 人已读')).toBeInTheDocument();
  });

  it('带 read-receipt-label 类名', () => {
    const { container } = render(<ReadReceiptLabel text="已读" />);
    expect(container.querySelector('.read-receipt-label')).not.toBeNull();
  });
});
