/**
 * ReadReceiptLabel 组件测试
 *
 * 已读回执小标签，纯展示：渲染传入的文本（私聊"已读/未读"、群聊"N 人已读"）。
 * 空文案时仍渲染回执位并用 minHeight 预留行高——群聊侧"无条件渲染回执位、文案异步填充"
 * 依赖此行为：迟到的真实文案只换字不换高，避免内容回流（修复打开群聊回执迟到致内容上移）。
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

  it('空文案时仍渲染回执位并用 minHeight 预留行高（首帧即定、迟到文案不改高 → 零回流）', () => {
    const { container } = render(<ReadReceiptLabel text="" />);
    const label = container.querySelector('.read-receipt-label') as HTMLElement | null;
    // 即便文案为空，回执位也必须存在（与好友侧一致的无条件渲染契约）
    expect(label).not.toBeNull();
    // 零回流的高度恒等不变量：minHeight 必须 == fontSize × lineHeight，且单行（nowrap）——
    // 三者任一被改动而破坏不变量时此断言失败（防止 fontSize 改了 minHeight 没跟、或换行致 2 行）
    expect(label?.style.fontSize).toBe('11px');
    expect(label?.style.lineHeight).toBe('1');
    expect(label?.style.minHeight).toBe('11px');
    expect(label?.style.whiteSpace).toBe('nowrap');
  });
});
