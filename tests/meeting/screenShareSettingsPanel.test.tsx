/**
 * 屏幕共享设置共用面板回归（块 pvmk3dxq：分享框独立窗口化）
 *
 * 验收口径：窗内兜底弹窗与独立分享窗口共用同一 ScreenShareSettingsPanel——
 * 面板渲染三档分辨率（超屏档位禁用+提示）、两档帧率、取消/开始共享回调接线。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScreenShareSettingsPanel } from '../../src/meeting/components/ScreenShareSettingsPanel';
import type { ScreenShareResolution } from '../../src/meeting/screenShareSettings';

function setup(overrides: Partial<Parameters<typeof ScreenShareSettingsPanel>[0]> = {}) {
  const props = {
    resolution: '1080p' as ScreenShareResolution,
    frameRate: 60 as const,
    availableResolutions: ['1080p', '2k', '4k'] as ScreenShareResolution[],
    onResolutionChange: vi.fn(),
    onFrameRateChange: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<ScreenShareSettingsPanel {...props} />);
  return props;
}

describe('ScreenShareSettingsPanel', () => {
  it('渲染标题+三档分辨率+两档帧率+动作区', () => {
    setup();
    expect(screen.getByText('屏幕共享设置')).toBeTruthy();
    expect(screen.getByText('1080p (1920×1080)')).toBeTruthy();
    expect(screen.getByText('2K (2560×1440)')).toBeTruthy();
    expect(screen.getByText('4K (3840×2160)')).toBeTruthy();
    expect(screen.getByText('60 FPS')).toBeTruthy();
    expect(screen.getByText('120 FPS')).toBeTruthy();
    expect(screen.getByText('取消')).toBeTruthy();
    expect(screen.getByText('开始共享')).toBeTruthy();
  });

  it('点击档位/帧率回调带值', () => {
    const props = setup();
    fireEvent.click(screen.getByText('2K (2560×1440)'));
    expect(props.onResolutionChange).toHaveBeenCalledWith('2k');
    fireEvent.click(screen.getByText('120 FPS'));
    expect(props.onFrameRateChange).toHaveBeenCalledWith(120);
  });

  it('超出显示器能力的档位禁用并带不可用提示', () => {
    setup({ availableResolutions: ['1080p'] });
    const fourK = screen.getByText('4K (3840×2160)').closest('button') as HTMLButtonElement;
    expect(fourK.disabled).toBe(true);
    expect(screen.getAllByText('不可用').length).toBe(2);
    const p1080 = screen.getByText('1080p (1920×1080)').closest('button') as HTMLButtonElement;
    expect(p1080.disabled).toBe(false);
  });

  it('取消/开始共享回调接线；confirmDisabled 时确认钮禁用', () => {
    const props = setup({ confirmDisabled: true });
    const confirm = screen.getByText('开始共享').closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(props.onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('取消'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('statusNote 非空时渲染状态提示', () => {
    setup({ statusNote: '正在发起共享…' });
    expect(screen.getByText('正在发起共享…')).toBeTruthy();
  });
});
