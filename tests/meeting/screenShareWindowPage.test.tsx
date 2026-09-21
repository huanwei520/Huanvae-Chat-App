/**
 * 独立分享窗口页面事件契约回归（块 pvmk3dxq：分享框独立窗口化）
 *
 * 验收口径（会议窗 ⇄ 分享窗事件/状态通道）：
 * - 点「开始共享」→ emit CONFIRM 载荷={resolution,frameRate}，期间确认钮禁用；
 * - RESULT started → 自关窗口（「开始共享后窗口关闭」）；
 * - RESULT failed → 留窗显示原因、恢复可重试；
 * - STATE sharing=true → 自关（状态同步兜底）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ScreenShareWindowPage } from '../../src/meeting/ScreenShareWindowPage';
import {
  SCREEN_SHARE_EV_CONFIRM,
  SCREEN_SHARE_EV_RESULT,
  SCREEN_SHARE_EV_STATE,
} from '../../src/meeting/screenShareWindow';

const mocks = vi.hoisted(() => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: mocks.emit,
  listen: mocks.listen,
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ close: mocks.close }),
  WebviewWindow: { getByLabel: vi.fn().mockResolvedValue(null) },
}));

/** 取出 ScreenShareWindowPage 挂上的事件监听器 */
function listenerOf(event: string): (e: { payload: unknown }) => void {
  const call = mocks.listen.mock.calls.find(([name]) => name === event);
  expect(call, `缺少 ${event} 的 listen`).toBeTruthy();
  return call![1] as (e: { payload: unknown }) => void;
}

describe('ScreenShareWindowPage 事件契约', () => {
  beforeEach(() => {
    mocks.emit.mockClear();
    mocks.listen.mockClear();
    mocks.close.mockClear();
    // jsdom 无 screen 真值，兜底成 4K 屏让三档全可用
    Object.defineProperty(window.screen, 'width', { value: 3840, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: 2160, configurable: true });
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
  });

  it('渲染共用面板并挂 CONFIRM-result/STATE 两个监听', () => {
    render(<ScreenShareWindowPage />);
    expect(screen.getByText('屏幕共享设置')).toBeTruthy();
    expect(screen.getByText('开始共享')).toBeTruthy();
    const names = mocks.listen.mock.calls.map(([name]) => name);
    expect(names).toContain(SCREEN_SHARE_EV_RESULT);
    expect(names).toContain(SCREEN_SHARE_EV_STATE);
  });

  it('点开始共享 → emit CONFIRM 载荷=所选设置，且确认钮禁用', () => {
    render(<ScreenShareWindowPage />);
    fireEvent.click(screen.getByText('2K (2560×1440)'));
    fireEvent.click(screen.getByText('120 FPS'));
    fireEvent.click(screen.getByText('开始共享'));
    expect(mocks.emit).toHaveBeenCalledTimes(1);
    const [ev, payload] = mocks.emit.mock.calls[0];
    expect(ev).toBe(SCREEN_SHARE_EV_CONFIRM);
    expect(payload).toEqual({ resolution: '2k', frameRate: 120 });
    const confirm = screen.getByText('开始共享').closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('RESULT started → 自关窗口', async () => {
    render(<ScreenShareWindowPage />);
    fireEvent.click(screen.getByText('开始共享'));
    await act(async () => {
      listenerOf(SCREEN_SHARE_EV_RESULT)({ payload: { status: 'started' } });
    });
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('RESULT failed → 留窗显示原因并恢复可重试', async () => {
    render(<ScreenShareWindowPage />);
    fireEvent.click(screen.getByText('开始共享'));
    await act(async () => {
      listenerOf(SCREEN_SHARE_EV_RESULT)({
        payload: { status: 'failed', message: '屏幕采集被拒绝' },
      });
    });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(screen.getByText('屏幕采集被拒绝')).toBeTruthy();
    const confirm = screen.getByText('开始共享').closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
  });

  it('STATE sharing=true → 自关（状态同步兜底）', async () => {
    render(<ScreenShareWindowPage />);
    await act(async () => {
      listenerOf(SCREEN_SHARE_EV_STATE)({ payload: { sharing: true } });
    });
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
