/**
 * ProfileCoverActions 测试（封面交互层：更改 / 恢复默认 / 上传进度 / 完成提示）
 *
 * 覆盖重设计后的真实条件逻辑（非静态字面量）：
 *   - 空闲态：显示「更改背景图片」，无进度条；hasBackground=false 时无「恢复默认」
 *   - hasBackground && !saving：出现「恢复默认」，点击触发 onReset
 *   - saving：换图按钮 disabled、文案变「上传中 NN%」、进度条 width=NN%、隐藏「恢复默认」
 *   - notice 非空：浮出「✓ …」提示，2s 后经 onClearNotice 自动清除（fake timers）
 *   - 选文件触发 onSelect(file)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ProfileCoverActions } from '../../src/components/profile/ProfileCoverActions';

function setup(overrides: Partial<React.ComponentProps<typeof ProfileCoverActions>> = {}) {
  const props = {
    hasBackground: false,
    saving: false,
    progress: 0,
    notice: null,
    onSelect: vi.fn(),
    onReset: vi.fn(),
    onClearNotice: vi.fn(),
    ...overrides,
  };
  const view = render(<ProfileCoverActions {...props} />);
  return { props, view };
}

describe('ProfileCoverActions 封面交互层', () => {
  beforeEach(() => cleanup());

  it('空闲态：显示「更改背景图片」，无进度条，hasBackground=false 无「恢复默认」', () => {
    setup();
    expect(screen.getByRole('button', { name: '更改背景图片' })).toBeTruthy();
    expect(screen.getByText('更改背景图片')).toBeTruthy();
    expect(screen.queryByText('恢复默认')).toBeNull();
    expect(document.querySelector('.cover-progress')).toBeNull();
  });

  it('hasBackground && !saving：出现「恢复默认」，点击触发 onReset', () => {
    const { props } = setup({ hasBackground: true });
    const reset = screen.getByRole('button', { name: '恢复默认封面' });
    fireEvent.click(reset);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('saving：换图按钮 disabled + 文案「上传中 42%」+ 进度条 width=42% + 隐藏「恢复默认」', () => {
    setup({ saving: true, progress: 42, hasBackground: true });
    const changeBtn = screen.getByRole('button', { name: '更改背景图片' });
    expect((changeBtn as HTMLButtonElement).disabled).toBe(true);
    expect(changeBtn.className).toContain('is-saving');
    expect(screen.getByText('上传中 42%')).toBeTruthy();
    // saving 时不显示「恢复默认」
    expect(screen.queryByText('恢复默认')).toBeNull();
    // 进度条宽度反映 progress
    const bar = document.querySelector('.cover-progress-bar') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.width).toBe('42%');
  });

  it('进度四舍五入显示（progress=66.6 → 上传中 67%）', () => {
    setup({ saving: true, progress: 66.6 });
    expect(screen.getByText('上传中 67%')).toBeTruthy();
  });

  it('notice 非空：浮出「✓ 背景已更新」，2s 后调用 onClearNotice', () => {
    vi.useFakeTimers();
    try {
      const { props } = setup({ notice: '背景图已更新' });
      expect(screen.getByText('✓ 背景图已更新')).toBeTruthy();
      expect(props.onClearNotice).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(props.onClearNotice).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('notice 为 null：不渲染提示，不启动定时器', () => {
    const { props } = setup({ notice: null });
    expect(screen.queryByText(/✓/)).toBeNull();
    expect(props.onClearNotice).not.toHaveBeenCalled();
  });

  it('选文件触发 onSelect(file)', () => {
    const { props } = setup();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File(['x'], 'cover.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith(file);
  });

  afterEach(() => cleanup());
});
