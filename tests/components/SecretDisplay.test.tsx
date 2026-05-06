/**
 * SecretDisplay 通用凭据展示组件测试
 *
 * 测试范围：
 * 1. 渲染 title + warningText + 多个 fields
 * 2. 复制按钮触发 clipboard.writeText
 * 3. 关闭按钮触发 onClose
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SecretDisplay } from '../../src/components/common/SecretDisplay';

describe('SecretDisplay', () => {
  beforeEach(() => {
    cleanup();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders title, warning text and all fields', () => {
    render(
      <SecretDisplay
        title="Test Credentials"
        warningText="Save it now"
        fields={[
          { label: 'Client ID', value: 'cid-123' },
          { label: 'Client Secret', value: 'sec-xyz' },
          { label: 'SSH Password', value: 'p@ss' },
        ]}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('Test Credentials')).toBeInTheDocument();
    expect(screen.getByText('Save it now')).toBeInTheDocument();
    expect(screen.getByText('Client ID')).toBeInTheDocument();
    expect(screen.getByText('cid-123')).toBeInTheDocument();
    expect(screen.getByText('Client Secret')).toBeInTheDocument();
    expect(screen.getByText('sec-xyz')).toBeInTheDocument();
    expect(screen.getByText('SSH Password')).toBeInTheDocument();
    expect(screen.getByText('p@ss')).toBeInTheDocument();
  });

  it('does not render warning block when warningText is omitted', () => {
    render(
      <SecretDisplay
        title="No Warning"
        fields={[{ label: 'K', value: 'v' }]}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByText('Save it now')).not.toBeInTheDocument();
    expect(screen.getByText('No Warning')).toBeInTheDocument();
  });

  it('copies the field value when its copy button is clicked', () => {
    render(
      <SecretDisplay
        title="T"
        fields={[
          { label: 'Field A', value: 'value-a' },
          { label: 'Field B', value: 'value-b' },
        ]}
        onClose={() => {}}
      />,
    );

    const copyBtns = screen.getAllByText('复制');
    expect(copyBtns).toHaveLength(2);
    fireEvent.click(copyBtns[0]!);
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('value-a');
    fireEvent.click(copyBtns[1]!);
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('value-b');
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <SecretDisplay
        title="T"
        fields={[{ label: 'K', value: 'v' }]}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText('已保存，关闭'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses custom closeLabel when provided', () => {
    render(
      <SecretDisplay
        title="T"
        fields={[{ label: 'K', value: 'v' }]}
        closeLabel="Got it"
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('Got it')).toBeInTheDocument();
    expect(screen.queryByText('已保存，关闭')).not.toBeInTheDocument();
  });

  it('calls onClose when overlay is clicked (outside dialog)', () => {
    const onClose = vi.fn();
    const { container } = render(
      <SecretDisplay
        title="T"
        fields={[{ label: 'K', value: 'v' }]}
        onClose={onClose}
      />,
    );

    const overlay = container.querySelector('.oauth-create-overlay');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalled();
  });
});
