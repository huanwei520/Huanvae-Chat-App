/**
 * 单项上传态覆盖层：四种状态的渲染 + 重试 / 取消回调
 *
 * 这是「进度从输入框上方搬进气泡内部」的那一层（spec §三）。
 * done 必须**什么都不画** —— 真实消息此刻已经在列表里，多留一帧就是肉眼可见的重复渲染。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SendingMediaOverlay } from '../../src/chat/shared/SendingMediaOverlay';
import { useSendingMediaStore, type SendingMediaSeed } from '../../src/stores/sendingMediaStore';

const KEY = 'friend:u1';

function seed(clientId: string): SendingMediaSeed {
  return {
    clientId,
    file: new File(['x'], 'a.png', { type: 'image/png' }),
    conversationKey: KEY,
    conversationType: 'friend',
    targetId: 'u1',
    shape: { kind: 'single', groupId: null, index: null, count: null },
    // previewUrl 不在 seed 里：那把 object URL 归 sendingMediaStore 自己造 / 自己释放
    preview: { name: 'a.png', kind: 'image', size: 1, localPath: '', width: null, height: null },
    sendTime: '2026-08-13T00:00:00.000Z',
  };
}

beforeEach(() => {
  useSendingMediaStore.setState({ entries: {}, orderByConversation: {} });
});

describe('SendingMediaOverlay', () => {
  it('没有在途条目 ⇒ 不渲染（普通历史消息上不该多出一层遮罩）', () => {
    const { container } = render(
      <SendingMediaOverlay clientId="client_none" onRetry={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('clientId 为 undefined（真实消息没有 clientId）⇒ 不渲染', () => {
    const { container } = render(
      <SendingMediaOverlay clientId={undefined} onRetry={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('pending ⇒ 画不确定态转圈，不显示百分比', () => {
    useSendingMediaStore.getState().enqueue([seed('client_a')]);
    render(<SendingMediaOverlay clientId="client_a" onRetry={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId('sending-media-overlay')).toHaveAttribute('data-status', 'pending');
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it('uploading ⇒ 显示百分比，环形进度的 dashoffset 随之推进', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a')]);
    st.markUploading('client_a', 40);
    const { container } = render(
      <SendingMediaOverlay clientId="client_a" onRetry={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByTestId('sending-media-overlay')).toHaveAttribute('data-status', 'uploading');
    expect(screen.getByText('40%')).toBeInTheDocument();

    const ring = container.querySelector('.sending-media-ring-value') as SVGCircleElement;
    const circumference = 2 * Math.PI * 18;
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * 0.6, 5);
  });

  it('uploading ⇒ 点圆环即取消，回传自己的 clientId', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a')]);
    st.markUploading('client_a', 10);
    const onCancel = vi.fn();
    render(<SendingMediaOverlay clientId="client_a" onRetry={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByLabelText('取消上传'));
    expect(onCancel).toHaveBeenLastCalledWith('client_a');
  });

  it('failed ⇒ 只给这一项的重试 / 取消（不整条重发，spec §四）', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a')]);
    st.markFailed('client_a', 'HTTP 502');
    const onRetry = vi.fn();
    const onCancel = vi.fn();
    render(<SendingMediaOverlay clientId="client_a" onRetry={onRetry} onCancel={onCancel} />);

    expect(screen.getByTestId('sending-media-overlay')).toHaveAttribute('data-status', 'failed');
    expect(screen.getByLabelText('发送失败：HTTP 502')).toBeInTheDocument();
    fireEvent.click(screen.getByText('重试'));
    expect(onRetry).toHaveBeenLastCalledWith('client_a');
    fireEvent.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenLastCalledWith('client_a');
  });

  it('🔴 done ⇒ 什么都不画（真实消息已就位，留着会闪一下双重渲染）', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a')]);
    st.markSent('client_a', 'real-a');
    const { container } = render(
      <SendingMediaOverlay clientId="client_a" onRetry={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
